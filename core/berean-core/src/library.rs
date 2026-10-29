//! Library: plans publication downloads, verifies, unpacks and records the
//! publication files provided to it, and tracks what is installed.
//!
//! # Downloads
//!
//! The core never does networking. To download a publication the caller
//! asks [`Library::download_request`] for a pub-media request, which is
//! built from the publication's catalog row and the language table, fetches
//! it, and hands the reply to [`Library::plan_download`]. That picks the
//! `.jwpub` the reply lists and checks it against the catalog; the caller
//! downloads the plan's file and passes it to [`Library::install`].
//!
//! # Store
//!
//! Each installed publication is unpacked into its own directory under
//! `publications/` in the data dir: the `.jwpub`'s `contents` entries (the
//! database and images) plus its `manifest.json`. A directory is named after
//! the publication's key plus a unique suffix, so a reinstall never touches
//! the directory the current record points at. The `installed_publication`
//! row is the commit point: an install unpacks into `publications/.staging/`,
//! moves the finished directory into `publications/`, then switches the row
//! to it, and its search index rows to the new copy's, in one transaction;
//! only then is the replaced directory moved to
//! `publications/.trash/` and deleted. Opening the core empties `.staging`
//! and `.trash` and deletes any directory no row points at, so a crash at any
//! point leaves either the old or the new publication installed, never a
//! partial one.
//!
//! A publication's key is `{symbol}:{meps_language}:{issue_tag}`, e.g.
//! `w26:0:20260800` or `ll:0:0`, taken from its own `Publication` row.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use tempfile::TempDir;

use crate::catalog::{Catalog, CatalogEntry};
use crate::jwpub::{Container, Publication, PublicationMeta};
use crate::languages;
use crate::search::{self, IndexRow, INDEX_STEPS};
use crate::{CancelToken, CoreError, Inner, ProgressSink};

const STORE: &str = "publications";
const STAGING: &str = ".staging";
const TRASH: &str = ".trash";
const PUB_MEDIA: &str = "https://b.jw-cdn.org/apis/pub-media/GETPUBMEDIALINKS";
/// How many open publications [`Library::with_publication`] keeps.
pub(crate) const OPEN_PUBLICATIONS: usize = 8;

/// The broad kind of a publication, from its `PublicationType`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PubKind {
    Bible,
    Book,
    Brochure,
    Watchtower,
    Awake,
    Index,
    MeetingWorkbook,
    Other,
}

impl PubKind {
    pub(crate) fn from_publication_type(t: &str) -> Self {
        match t {
            "Bible" => PubKind::Bible,
            "Book" => PubKind::Book,
            "Brochure" => PubKind::Brochure,
            "Watchtower" => PubKind::Watchtower,
            "Awake" | "Awake!" => PubKind::Awake,
            "Index" => PubKind::Index,
            "Meeting Workbook" => PubKind::MeetingWorkbook,
            _ => PubKind::Other,
        }
    }
}

/// One installed publication.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicationSummary {
    pub pub_key: String,
    pub symbol: String,
    pub meps_language: u32,
    pub issue_tag: u32,
    pub year: u32,
    pub title: String,
    pub kind: PubKind,
}

/// An HTTP GET for the caller to make and return the reply body of.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpRequest {
    pub url: String,
}

/// Where to download a publication's `.jwpub`, and what to expect.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DownloadPlan {
    pub url: String,
    /// File size in bytes, as the catalog lists it.
    pub size: u64,
    /// SHA-1 of the file, hex, as the catalog lists it. (Pub-media gives only
    /// an MD5; the catalog's SHA-1 is the stronger check.)
    pub checksum: String,
}

/// The parts of a pub-media `GETPUBMEDIALINKS` reply the core reads:
/// `{"files": {"<code>": {"JWPUB": [{"file": {"url": …}, "filesize": …}]}}}`.
#[derive(Deserialize)]
struct PubMediaReply {
    files: std::collections::HashMap<String, PubMediaFormats>,
}

#[derive(Deserialize)]
struct PubMediaFormats {
    #[serde(rename = "JWPUB", default)]
    jwpub: Vec<PubMediaFile>,
}

#[derive(Deserialize)]
struct PubMediaFile {
    file: PubMediaLink,
    filesize: u64,
}

#[derive(Deserialize)]
struct PubMediaLink {
    url: String,
}

/// Handle to the publication store. Cheap to clone; shares the core's state.
#[derive(Clone)]
pub struct Library {
    inner: Arc<Inner>,
}

impl Library {
    pub(crate) fn new(inner: Arc<Inner>) -> Self {
        Library { inner }
    }

    /// Verify the `.jwpub` at `file_path`, check it is the publication
    /// `pub_key` names, unpack it into the store, index it for search and
    /// record it, replacing any installed copy and its index rows. Progress
    /// counts opening and verifying the file, each unpacked entry, checking
    /// the unpacked copy, a fixed 100 steps for indexing it, and committing.
    ///
    /// A malformed key, or a file that is a different publication =>
    /// `Invalid`; a damaged file (including content the reader cannot read)
    /// => `Corrupt`; cancelled => `Cancelled`. On any error the store and
    /// the search index are unchanged.
    pub fn install(
        &self,
        pub_key: &str,
        file_path: impl AsRef<Path>,
        progress: &dyn ProgressSink,
        cancel: &CancelToken,
    ) -> Result<(), CoreError> {
        cancel.check()?;
        let dir_name = dir_name(pub_key)?;
        let store = self.store();

        // Dropping `staging` deletes whatever is left in it, on every path.
        let staging = TempDir::new_in(store.join(STAGING))?;
        let unpacked = staging.path().join("pub");
        std::fs::create_dir(&unpacked)?;

        let mut container = Container::open(file_path, staging.path())?;
        let entries = container.len() as u64;
        let total = entries + 3 + INDEX_STEPS;
        progress.on_progress(1, total);

        container.write_manifest(&unpacked)?;
        for i in 0..container.len() {
            cancel.check()?;
            container.unpack_entry(i, &unpacked)?;
            progress.on_progress(2 + i as u64, total);
        }
        drop(container);

        cancel.check()?;
        let publication = Publication::open_dir(&unpacked)?;
        let meta = publication.meta().clone();
        let key = meta.pub_key();
        if key != pub_key {
            return Err(CoreError::Invalid(format!(
                "file is publication {key}, not {pub_key}"
            )));
        }
        progress.on_progress(entries + 2, total);

        let rows = search::index_rows(&publication, progress, entries + 2, total, cancel)?;
        drop(publication);

        cancel.check()?;
        // `.tmpXXXXXX`: unique within `.staging`, and in practice in the store.
        let suffix = staging
            .path()
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| CoreError::Io("bad staging dir name".into()))?;
        let dir = format!("{dir_name}{suffix}");
        let installed_dir = store.join(&dir);
        std::fs::rename(&unpacked, &installed_dir)?;

        let replaced = match self.record(pub_key, &meta, &dir, &rows) {
            Ok(replaced) => replaced,
            Err(e) => {
                // Not recorded: the new directory is an orphan; drop it.
                let _ = std::fs::remove_dir_all(&installed_dir);
                return Err(e);
            }
        };
        if let Some(old) = replaced {
            self.evict(&old);
            self.discard(&old);
        }
        progress.on_progress(total, total);
        Ok(())
    }

    /// All installed publications, ordered by key.
    pub fn installed(&self) -> Result<Vec<PublicationSummary>, CoreError> {
        let conn = self.inner.conn();
        let mut stmt = conn.prepare(
            "SELECT pub_key, symbol, meps_language, issue_tag, year, title, publication_type \
             FROM installed_publication ORDER BY pub_key",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(PublicationSummary {
                pub_key: r.get(0)?,
                symbol: r.get(1)?,
                meps_language: r.get(2)?,
                issue_tag: r.get(3)?,
                year: r.get(4)?,
                title: r.get(5)?,
                kind: PubKind::from_publication_type(&r.get::<_, String>(6)?),
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Uninstall a publication: drop its record and search index rows, and
    /// delete its directory.
    /// Malformed key => `Invalid`; not installed => `NotFound`.
    pub fn remove(&self, pub_key: &str) -> Result<(), CoreError> {
        dir_name(pub_key)?;
        let dir = {
            let mut conn = self.inner.conn();
            let tx = conn.transaction()?;
            let dir: String = tx.query_row(
                "SELECT dir FROM installed_publication WHERE pub_key = ?1",
                [pub_key],
                |r| r.get(0),
            )?;
            tx.execute(
                "DELETE FROM installed_publication WHERE pub_key = ?1",
                [pub_key],
            )?;
            search::delete_rows(&tx, pub_key)?;
            tx.commit()?;
            dir
        };
        self.evict(&dir);
        self.discard(&dir);
        Ok(())
    }

    /// The pub-media request that lists `pub_key`'s `.jwpub`:
    /// `GETPUBMEDIALINKS?output=json&fileformat=JWPUB&pub=<KeySymbol>`
    /// `&langwritten=<code>`, plus an `&issue=` for a dated issue. pub-media
    /// matches the issue at the tag's own precision: a month-level tag
    /// (`IssueTagNumber` ending in `00`, e.g. `20260800`) is sent as `YYYYMM`
    /// (`202608`); a day-level tag (e.g. `20151215`) is sent whole, as
    /// `YYYYMMDD` (`issue=201512` lists nothing for it). An `IssueTagNumber`
    /// of 0 sends no issue. Malformed key => `Invalid`; not in the catalog
    /// (or no catalog), or a language the language table does not map =>
    /// `NotFound`.
    pub fn download_request(&self, pub_key: &str) -> Result<HttpRequest, CoreError> {
        let entry = self.catalog().entry(pub_key)?;
        let code = language_code(&entry)?;
        let mut url = format!(
            "{PUB_MEDIA}?output=json&fileformat=JWPUB&pub={}&langwritten={}",
            query_value(&entry.key_symbol),
            query_value(code)
        );
        match entry.issue_tag {
            0 => {}
            tag if tag % 100 == 0 => url.push_str(&format!("&issue={}", tag / 100)),
            tag => url.push_str(&format!("&issue={tag}")),
        }
        Ok(HttpRequest { url })
    }

    /// Where to download `pub_key`, from the reply to its
    /// [`download_request`](Self::download_request): the reply's `.jwpub`
    /// for the publication's language whose size is the catalog's. The plan
    /// carries the catalog's size and SHA-1.
    ///
    /// Malformed key => `Invalid`; not in the catalog, or the reply lists no
    /// `.jwpub` in its language => `NotFound`; an unreadable reply, or none
    /// of its files has the catalog's size => `Corrupt`.
    pub fn plan_download(&self, pub_key: &str, response: &[u8]) -> Result<DownloadPlan, CoreError> {
        let entry = self.catalog().entry(pub_key)?;
        let code = language_code(&entry)?;
        let reply: PubMediaReply =
            serde_json::from_slice(response).map_err(|_| CoreError::Corrupt)?;
        let files = reply
            .files
            .get(code)
            .map(|f| f.jwpub.as_slice())
            .unwrap_or_default();
        if files.is_empty() {
            return Err(CoreError::NotFound);
        }
        let file = files
            .iter()
            .find(|f| f.filesize == entry.asset.size)
            .ok_or(CoreError::Corrupt)?;
        Ok(DownloadPlan {
            url: file.file.url.clone(),
            size: entry.asset.size,
            checksum: entry.asset.sha1,
        })
    }

    /// Open an installed publication from the store. Malformed key =>
    /// `Invalid`; not installed => `NotFound`.
    pub fn publication(&self, pub_key: &str) -> Result<Publication, CoreError> {
        Ok(self.publication_and_dir(pub_key)?.1)
    }

    /// [`publication`](Self::publication), opened afresh (not from the
    /// cache), with the store directory it was opened from.
    pub(crate) fn publication_and_dir(
        &self,
        pub_key: &str,
    ) -> Result<(String, Publication), CoreError> {
        dir_name(pub_key)?;
        let dir: String = self.inner.conn().query_row(
            "SELECT dir FROM installed_publication WHERE pub_key = ?1",
            [pub_key],
            |r| r.get(0),
        )?;
        let publication = Publication::open_dir(self.store().join(&dir))?;
        Ok((dir, publication))
    }

    /// Run `f` on the installed publication `pub_key`. The publication is
    /// opened once and kept open (up to [`OPEN_PUBLICATIONS`], least
    /// recently used dropped first) until it is removed or replaced, so
    /// repeated reads skip reopening it. Calls on the same publication take
    /// turns. `f` must not call `with_publication` itself (see the lock order
    /// on `Inner`). Malformed key => `Invalid`; not installed => `NotFound`.
    pub(crate) fn with_publication<T>(
        &self,
        pub_key: &str,
        f: impl FnOnce(&Publication) -> Result<T, CoreError>,
    ) -> Result<T, CoreError> {
        let (_, publication) = self.open_cached(pub_key)?;
        let publication = publication.lock().unwrap_or_else(PoisonError::into_inner);
        f(&publication)
    }

    /// The cached publication `pub_key` and its store directory, opening and
    /// caching it if needed. The directory is looked up with the cache held,
    /// so a concurrent remove or reinstall (which evicts after committing)
    /// can never leave a stale entry behind.
    pub(crate) fn open_cached(
        &self,
        pub_key: &str,
    ) -> Result<(String, Arc<Mutex<Publication>>), CoreError> {
        dir_name(pub_key)?;
        let mut cache = self.inner.publications();
        let dir: String = self.inner.conn().query_row(
            "SELECT dir FROM installed_publication WHERE pub_key = ?1",
            [pub_key],
            |r| r.get(0),
        )?;
        let publication = lru_get(&mut cache, &dir, OPEN_PUBLICATIONS, || {
            Ok(Arc::new(Mutex::new(Publication::open_dir(
                self.store().join(&dir),
            )?)))
        })?;
        Ok((dir, publication))
    }

    /// The store directories of the open publications, least recently used
    /// first.
    #[cfg(test)]
    fn open_dirs(&self) -> Vec<String> {
        self.inner
            .publications()
            .iter()
            .map(|(d, _)| d.clone())
            .collect()
    }

    /// Drop the cached copy of the publication in store directory `dir`.
    fn evict(&self, dir: &str) {
        self.inner.publications().retain(|(d, _)| d != dir);
    }

    /// Create the store and clear out anything a crash or failed call left
    /// behind: the contents of `.staging` and `.trash`, and any directory no
    /// record points at.
    pub(crate) fn prepare_store(&self) -> Result<(), CoreError> {
        let store = self.store();
        for sub in [STAGING, TRASH] {
            let path = store.join(sub);
            std::fs::create_dir_all(&path)?;
            for entry in std::fs::read_dir(&path)? {
                remove_path(&entry?.path())?;
            }
        }

        let recorded: Vec<String> = {
            let conn = self.inner.conn();
            let mut stmt = conn.prepare("SELECT dir FROM installed_publication")?;
            let rows = stmt.query_map([], |r| r.get(0))?;
            rows.collect::<Result<_, _>>()?
        };
        for entry in std::fs::read_dir(&store)? {
            let entry = entry?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if !name.starts_with('.') && !recorded.iter().any(|d| *d == name) {
                remove_path(&entry.path())?;
            }
        }
        Ok(())
    }

    /// Insert or replace the record for `pub_key`, pointing at `dir`, and
    /// its search index rows with `rows`, in one transaction. Returns the
    /// directory the replaced record pointed at, if any.
    fn record(
        &self,
        pub_key: &str,
        meta: &PublicationMeta,
        dir: &str,
        rows: &[IndexRow],
    ) -> Result<Option<String>, CoreError> {
        let installed_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_secs() as i64);
        let mut conn = self.inner.conn();
        let tx = conn.transaction()?;
        let old: Option<String> = tx
            .query_row(
                "SELECT dir FROM installed_publication WHERE pub_key = ?1",
                [pub_key],
                |r| r.get(0),
            )
            .optional()?;
        tx.execute(
            "INSERT OR REPLACE INTO installed_publication \
             (pub_key, symbol, meps_language, issue_tag, year, title, publication_type, dir, \
              installed_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                pub_key,
                meta.symbol,
                meta.meps_language,
                meta.issue_tag,
                meta.year,
                meta.title,
                meta.publication_type,
                dir,
                installed_at,
            ],
        )?;
        search::replace_rows(&tx, pub_key, rows)?;
        tx.commit()?;
        Ok(old)
    }

    /// Delete a store directory that no record points at any more. It is
    /// first moved into `.trash`, so it vanishes from the store at once; if
    /// anything fails the leftovers are cleared on the next open.
    fn discard(&self, dir: &str) {
        let store = self.store();
        if let Ok(trash) = TempDir::new_in(store.join(TRASH)) {
            let _ = std::fs::rename(store.join(dir), trash.path().join("pub"));
        }
    }

    fn store(&self) -> PathBuf {
        self.inner.data_dir.join(STORE)
    }

    fn catalog(&self) -> Catalog {
        Catalog::new(self.inner.clone())
    }
}

/// The value cached under `key`, made most recently used; on a miss, `open`
/// makes it and it is added, dropping the least recently used entry if the
/// cache already holds `cap`.
fn lru_get<T: Clone>(
    cache: &mut Vec<(String, T)>,
    key: &str,
    cap: usize,
    open: impl FnOnce() -> Result<T, CoreError>,
) -> Result<T, CoreError> {
    let entry = match cache.iter().position(|(k, _)| k == key) {
        Some(i) => cache.remove(i),
        None => {
            let value = open()?;
            if cache.len() >= cap {
                cache.remove(0);
            }
            (key.to_string(), value)
        }
    };
    let value = entry.1.clone();
    cache.push(entry);
    Ok(value)
}

/// The JW code of a catalog row's language. Unmapped => `NotFound`.
fn language_code(entry: &CatalogEntry) -> Result<&'static str, CoreError> {
    languages::by_meps_id(entry.meps_language)
        .map(|l| l.code.as_str())
        .ok_or(CoreError::NotFound)
}

/// Percent-encode a URL query value: every byte outside the unreserved set.
fn query_value(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

impl PublicationMeta {
    /// This publication's key.
    pub fn pub_key(&self) -> String {
        format_pub_key(&self.symbol, self.meps_language, self.issue_tag)
    }
}

/// Build a publication key, `{symbol}:{meps_language}:{issue_tag}`. The only
/// place a key is formatted; [`parse_pub_key`] is the only place one is read.
pub(crate) fn format_pub_key(symbol: &str, meps_language: u32, issue_tag: u32) -> String {
    format!("{symbol}:{meps_language}:{issue_tag}")
}

/// Split a key into its symbol, MEPS language and issue tag. Both numbers
/// must be canonical decimal `u32`s, so every key has one spelling. A
/// malformed key => `Invalid`.
pub(crate) fn parse_pub_key(pub_key: &str) -> Result<(&str, u32, u32), CoreError> {
    let invalid = || CoreError::Invalid(format!("malformed publication key {pub_key:?}"));
    // Numbers come off the right, so the symbol itself may contain `:`.
    let mut parts = pub_key.rsplitn(3, ':');
    let (Some(issue), Some(lang), Some(symbol)) = (parts.next(), parts.next(), parts.next()) else {
        return Err(invalid());
    };
    let canonical_u32 = |s: &str| s.parse::<u32>().ok().filter(|n| n.to_string() == s);
    match (canonical_u32(lang), canonical_u32(issue)) {
        (Some(lang), Some(issue)) if !symbol.is_empty() => Ok((symbol, lang, issue)),
        _ => Err(invalid()),
    }
}

/// Validate a key and derive its store directory name: the symbol with every
/// byte outside `[a-z0-9-]` written as `^xx` (hex), then `_{language}_{issue}`.
/// The name is a single path component, never starts with `.`, and distinct
/// keys give names that differ even on case-insensitive file systems.
/// A malformed key => `Invalid`.
fn dir_name(pub_key: &str) -> Result<String, CoreError> {
    let (symbol, lang, issue) = parse_pub_key(pub_key)?;
    let mut name = String::new();
    for b in symbol.bytes() {
        match b {
            b'a'..=b'z' | b'0'..=b'9' | b'-' => name.push(b as char),
            _ => name.push_str(&format!("^{b:02x}")),
        }
    }
    Ok(format!("{name}_{lang}_{issue}"))
}

pub(crate) fn remove_path(path: &Path) -> std::io::Result<()> {
    if path.is_dir() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lru_drops_the_least_recently_used() {
        let mut cache = Vec::new();
        let opened = std::cell::Cell::new(0);
        let get = |cache: &mut Vec<(String, u32)>, key: &str| {
            lru_get(cache, key, 3, || {
                opened.set(opened.get() + 1);
                Ok(opened.get())
            })
            .unwrap()
        };
        assert_eq!(get(&mut cache, "a"), 1);
        assert_eq!(get(&mut cache, "b"), 2);
        assert_eq!(get(&mut cache, "c"), 3);
        // A hit does not reopen, and makes `a` the most recently used.
        assert_eq!(get(&mut cache, "a"), 1);
        assert_eq!(get(&mut cache, "d"), 4);
        let keys: Vec<&str> = cache.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(keys, ["c", "a", "d"]);
        assert_eq!(get(&mut cache, "b"), 5);
        assert_eq!(cache.len(), 3);
        // A failed open adds nothing.
        assert!(lru_get(&mut cache, "e", 3, || Err(CoreError::Corrupt)).is_err());
        assert_eq!(cache.len(), 3);
    }

    #[test]
    fn open_publications_follow_removes_and_reinstalls() {
        let fixture = |name: &str| {
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../fixtures")
                .join(name)
        };
        let tmp = tempfile::tempdir().unwrap();
        let core = crate::Core::open(tmp.path().join("data"), tmp.path().join("cache")).unwrap();
        let lib = core.library();
        let install = |key: &str, file: &str| {
            lib.install(key, fixture(file), &|_, _| {}, &CancelToken::new())
                .unwrap()
        };
        let dir = |key: &str| -> String {
            core.inner
                .conn()
                .query_row(
                    "SELECT dir FROM installed_publication WHERE pub_key = ?1",
                    [key],
                    |r| r.get(0),
                )
                .unwrap()
        };
        let read = |key: &str| lib.with_publication(key, |p| Ok(p.meta().pub_key()));
        let (w, ll) = ("w26:0:20260800", "ll:0:0");
        install(w, "w_E_202608.jwpub");
        install(ll, "ll_E.jwpub");
        assert!(lib.open_dirs().is_empty());
        assert_eq!(read(w).unwrap(), w);
        assert_eq!(read(ll).unwrap(), ll);
        assert_eq!(read(w).unwrap(), w);
        assert_eq!(lib.open_dirs(), [dir(ll), dir(w)]);

        // A reinstall drops the old copy; the next read opens the new one.
        let old = dir(w);
        install(w, "w_E_202608.jwpub");
        assert_ne!(dir(w), old);
        assert_eq!(lib.open_dirs(), [dir(ll)]);
        assert_eq!(read(w).unwrap(), w);
        assert_eq!(lib.open_dirs(), [dir(ll), dir(w)]);

        // A remove drops it, and it can no longer be read.
        let ll_dir = dir(ll);
        lib.remove(ll).unwrap();
        assert!(!lib.open_dirs().contains(&ll_dir));
        assert!(matches!(read(ll), Err(CoreError::NotFound)));
        assert!(matches!(read("ll"), Err(CoreError::Invalid(_))));
        assert_eq!(lib.open_dirs(), [dir(w)]);
    }

    #[test]
    fn dir_names() {
        assert_eq!(dir_name("w26:0:20260800").unwrap(), "w26_0_20260800");
        assert_eq!(dir_name("ll:0:0").unwrap(), "ll_0_0");
        assert_eq!(dir_name("S-38:1:0").unwrap(), "^53-38_1_0");
        assert_eq!(dir_name("a_b:0:0").unwrap(), "a^5fb_0_0");
        assert_eq!(dir_name("a:b:0:0").unwrap(), "a^3ab_0_0");
        assert_eq!(dir_name("..:0:0").unwrap(), "^2e^2e_0_0");
        assert_ne!(dir_name("W:0:0").unwrap(), dir_name("w:0:0").unwrap());
    }

    #[test]
    fn pub_keys_round_trip() {
        for (symbol, lang, issue) in [("w26", 0, 20260800), ("ll", 0, 0), ("a:b", 1, 2)] {
            let key = format_pub_key(symbol, lang, issue);
            assert_eq!(parse_pub_key(&key).unwrap(), (symbol, lang, issue));
        }
        assert_eq!(format_pub_key("w26", 0, 20260800), "w26:0:20260800");
    }

    #[test]
    fn malformed_keys_are_invalid() {
        for key in [
            "",
            "w26",
            "w26:0",
            ":0:0",
            "w26:x:0",
            "w26:0:",
            "w26:00:0",
            "w26:0:+1",
            "w26:-1:0",
            "w26:0:4294967296",
        ] {
            assert!(
                matches!(dir_name(key), Err(CoreError::Invalid(_))),
                "{key:?}"
            );
        }
    }

    #[test]
    fn query_values() {
        assert_eq!(query_value("w"), "w");
        assert_eq!(query_value("S-38"), "S-38");
        assert_eq!(query_value("a&b=c d"), "a%26b%3Dc%20d");
    }

    #[test]
    fn pub_kinds() {
        assert_eq!(
            PubKind::from_publication_type("Watchtower"),
            PubKind::Watchtower
        );
        assert_eq!(PubKind::from_publication_type("Bible"), PubKind::Bible);
        assert_eq!(PubKind::from_publication_type("Awake!"), PubKind::Awake);
        assert_eq!(
            PubKind::from_publication_type("Meeting Workbook"),
            PubKind::MeetingWorkbook
        );
        assert_eq!(PubKind::from_publication_type("Tract"), PubKind::Other);
    }
}
