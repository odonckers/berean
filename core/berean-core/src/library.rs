//! Library: verifies, unpacks and records the publication files provided to
//! it, and tracks what is installed. Download planning arrives with the
//! catalog.
//!
//! Each installed publication is unpacked into its own directory under
//! `publications/` in the data dir: the `.jwpub`'s `contents` entries (the
//! database and images) plus its `manifest.json`. A directory is named after
//! the publication's key plus a unique suffix, so a reinstall never touches
//! the directory the current record points at. The `installed_publication`
//! row is the commit point: an install unpacks into `publications/.staging/`,
//! moves the finished directory into `publications/`, then switches the row
//! to it in one transaction; only then is the replaced directory moved to
//! `publications/.trash/` and deleted. Opening the core empties `.staging`
//! and `.trash` and deletes any directory no row points at, so a crash at any
//! point leaves either the old or the new publication installed, never a
//! partial one.
//!
//! A publication's key is `{symbol}:{meps_language}:{issue_tag}`, e.g.
//! `w26:0:20260800` or `ll:0:0`, taken from its own `Publication` row.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, OptionalExtension};
use tempfile::TempDir;

use crate::jwpub::{Container, Publication, PublicationMeta};
use crate::{CancelToken, CoreError, Inner, ProgressSink};

const STORE: &str = "publications";
const STAGING: &str = ".staging";
const TRASH: &str = ".trash";

/// The broad kind of a publication, from its `PublicationType`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PubKind {
    Bible,
    Book,
    Brochure,
    Watchtower,
    Awake,
    Index,
    Other,
}

impl PubKind {
    fn from_publication_type(t: &str) -> Self {
        match t {
            "Bible" => PubKind::Bible,
            "Book" => PubKind::Book,
            "Brochure" => PubKind::Brochure,
            "Watchtower" => PubKind::Watchtower,
            "Awake" | "Awake!" => PubKind::Awake,
            "Index" => PubKind::Index,
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

/// Where and how to download a publication.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DownloadPlan {
    pub url: String,
    pub size: u64,
    pub checksum: String,
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
    /// `pub_key` names, unpack it into the store and record it, replacing any
    /// installed copy. Progress counts opening and verifying the file, each
    /// unpacked entry, checking the unpacked copy, and committing.
    ///
    /// A malformed key, or a file that is a different publication =>
    /// `Invalid`; a damaged file => `Corrupt`; cancelled => `Cancelled`. On
    /// any error the store is unchanged.
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
        let total = entries + 3;
        progress.on_progress(1, total);

        container.write_manifest(&unpacked)?;
        for i in 0..container.len() {
            cancel.check()?;
            container.unpack_entry(i, &unpacked)?;
            progress.on_progress(2 + i as u64, total);
        }
        drop(container);

        cancel.check()?;
        let meta = Publication::open_dir(&unpacked)?.meta().clone();
        let key = pub_key_of(&meta);
        if key != pub_key {
            return Err(CoreError::Invalid(format!(
                "file is publication {key}, not {pub_key}"
            )));
        }
        progress.on_progress(entries + 2, total);

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

        let replaced = match self.record(pub_key, &meta, &dir) {
            Ok(replaced) => replaced,
            Err(e) => {
                // Not recorded: the new directory is an orphan; drop it.
                let _ = std::fs::remove_dir_all(&installed_dir);
                return Err(e);
            }
        };
        if let Some(old) = replaced {
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

    /// Uninstall a publication: drop its record and delete its directory.
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
            tx.commit()?;
            dir
        };
        self.discard(&dir);
        Ok(())
    }

    /// Where to download a publication. Not available until the catalog
    /// exists: always `NotFound` for a well-formed key.
    pub fn plan_download(&self, pub_key: &str) -> Result<DownloadPlan, CoreError> {
        dir_name(pub_key)?;
        Err(CoreError::NotFound)
    }

    /// Open an installed publication from the store. Malformed key =>
    /// `Invalid`; not installed => `NotFound`.
    pub fn publication(&self, pub_key: &str) -> Result<Publication, CoreError> {
        dir_name(pub_key)?;
        let dir: String = self.inner.conn().query_row(
            "SELECT dir FROM installed_publication WHERE pub_key = ?1",
            [pub_key],
            |r| r.get(0),
        )?;
        Publication::open_dir(self.store().join(dir))
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

    /// Insert or replace the record for `pub_key`, pointing at `dir`.
    /// Returns the directory the replaced record pointed at, if any.
    fn record(
        &self,
        pub_key: &str,
        meta: &PublicationMeta,
        dir: &str,
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
}

/// The key of the publication `meta` describes.
pub(crate) fn pub_key_of(meta: &PublicationMeta) -> String {
    format!("{}:{}:{}", meta.symbol, meta.meps_language, meta.issue_tag)
}

/// Validate a key and derive its store directory name: the symbol with every
/// byte outside `[a-z0-9-]` written as `^xx` (hex), then `_{language}_{issue}`.
/// The name is a single path component, never starts with `.`, and distinct
/// keys give names that differ even on case-insensitive file systems.
/// A malformed key => `Invalid`.
fn dir_name(pub_key: &str) -> Result<String, CoreError> {
    let invalid = || CoreError::Invalid(format!("malformed publication key {pub_key:?}"));
    // Numbers come off the right, so the symbol itself may contain `:`.
    let mut parts = pub_key.rsplitn(3, ':');
    let (Some(issue), Some(lang), Some(symbol)) = (parts.next(), parts.next(), parts.next()) else {
        return Err(invalid());
    };
    let canonical_u32 = |s: &str| s.parse::<u32>().is_ok_and(|n| n.to_string() == s);
    if symbol.is_empty() || !canonical_u32(lang) || !canonical_u32(issue) {
        return Err(invalid());
    }
    let mut name = String::new();
    for b in symbol.bytes() {
        match b {
            b'a'..=b'z' | b'0'..=b'9' | b'-' => name.push(b as char),
            _ => name.push_str(&format!("^{b:02x}")),
        }
    }
    Ok(format!("{name}_{lang}_{issue}"))
}

fn remove_path(path: &Path) -> std::io::Result<()> {
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
    fn pub_kinds() {
        assert_eq!(
            PubKind::from_publication_type("Watchtower"),
            PubKind::Watchtower
        );
        assert_eq!(PubKind::from_publication_type("Bible"), PubKind::Bible);
        assert_eq!(PubKind::from_publication_type("Awake!"), PubKind::Awake);
        assert_eq!(PubKind::from_publication_type("Tract"), PubKind::Other);
    }
}
