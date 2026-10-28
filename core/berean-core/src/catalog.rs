//! Catalog: ingests the publication catalog file it is given and answers
//! which publications and languages exist.
//!
//! The catalog is JW Library's `catalog.db` (published gzipped as
//! `catalog.db.gz`); the platform shell downloads it, the core never touches
//! the network. [`Catalog::ingest_file`] accepts either form, copies it
//! (gunzipping if needed) into `catalog/.staging/`, checks that it is a
//! readable catalog, adds one index, and renames it over `catalog/catalog.db`.
//! Cancellation is checked, and progress reported, between those four steps.
//! The rename is the commit point: until it happens the previous catalog stays
//! in place and keeps answering; any failure deletes the staged copy, and
//! opening the core empties `.staging`. Queries open the stored file
//! read-only; its rows are never copied into the user DB.
//!
//! Before anything is ingested every listing is empty, [`Catalog::revision`]
//! is `None` and [`Catalog::asset`] is `NotFound`.
//!
//! Catalog languages are numeric MEPS ids; [`Catalog::languages`] names them
//! from the language table in [`crate::languages`].
//!
//! # Keys
//!
//! A catalog row's key is built from `Publication.Symbol` (the issue symbol,
//! e.g. `w26` — the same value as a `.jwpub`'s own `Publication.Symbol`),
//! `MepsLanguageId` and `IssueTagNumber`, with the same formatter the library
//! uses. The catalog's own unique key is on `KeySymbol` instead, so a few
//! rows share a key: in revision 2624030, 225 keys have two rows each (old
//! `km`/`w` issues catalogued twice under different `KeySymbol`s, e.g. `km10`
//! and `km`, or `wp` and `w`). A key resolves to exactly one row: the one
//! whose `PublicationAsset.LastModified` is latest, then the lowest
//! `Publication.Id`. Every listing and lookup applies that rule first and
//! filters after, so a key never appears twice. (`LastModified` is an
//! ISO-8601 UTC timestamp, so it orders as text.)

use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use rusqlite::{params_from_iter, Connection, OpenFlags, OptionalExtension};
use tempfile::TempDir;

use crate::languages::{self, Language};
use crate::library::{format_pub_key, parse_pub_key, remove_path, PubKind, PublicationSummary};
use crate::{CancelToken, CoreError, Inner, ProgressSink};

const DIR: &str = "catalog";
const STAGING: &str = ".staging";
const CURRENT: &str = "catalog.db";

/// The columns the core reads, by table. A file missing any of them is not a
/// catalog this build understands.
const REQUIRED: &[(&str, &[&str])] = &[
    ("Revision", &["Level", "Created"]),
    (
        "Publication",
        &[
            "Id",
            "Symbol",
            "KeySymbol",
            "MepsLanguageId",
            "IssueTagNumber",
            "PublicationTypeId",
            "Year",
            "Title",
        ],
    ),
    (
        "PublicationAsset",
        &[
            "PublicationId",
            "Signature",
            "Size",
            "SchemaVersion",
            "MinPlatformVersion",
            "LastModified",
        ],
    ),
];

/// `PublicationTypeId` => kind. Every other type id is `Other`.
const KINDS: &[(i64, PubKind)] = &[
    (1, PubKind::Bible),
    (2, PubKind::Book),
    (4, PubKind::Brochure),
    (6, PubKind::Index),
    (13, PubKind::Awake),
    (14, PubKind::Watchtower),
    (30, PubKind::MeetingWorkbook),
];

/// SQL condition: `a` (the `PublicationAsset` of `p`) belongs to the row its
/// key resolves to — no other row with the same key wins over it.
const RESOLVED: &str = "NOT EXISTS (
        SELECT 1 FROM Publication q JOIN PublicationAsset b ON b.PublicationId = q.Id
        WHERE q.MepsLanguageId = p.MepsLanguageId AND q.Symbol = p.Symbol
          AND q.IssueTagNumber = p.IssueTagNumber
          AND (b.LastModified > a.LastModified
               OR (b.LastModified = a.LastModified AND q.Id < p.Id)))";

/// Which catalog publications to list. Every field that is set must match.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CatalogFilter {
    pub meps_language: Option<u32>,
    pub kind: Option<PubKind>,
    /// The undated `KeySymbol`, e.g. `w` for every Watchtower study edition.
    pub key_symbol: Option<String>,
    /// Matches titles containing it, ignoring case.
    pub text: Option<String>,
    /// At most this many results.
    pub limit: Option<u32>,
}

/// Which catalog snapshot is ingested.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogRevision {
    pub level: u64,
    /// When the snapshot was built, ISO-8601, e.g. `2026-10-28T01:05:28+00:00`.
    pub created: String,
}

/// The `.jwpub` file the catalog lists for a publication.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogAsset {
    /// File size in bytes.
    pub size: u64,
    /// SHA-1 of the file, hex.
    pub sha1: String,
    pub schema_version: u32,
    pub min_platform_version: u32,
    /// ISO-8601, e.g. `2026-01-15T12:36:43+00:00`.
    pub last_modified: String,
}

/// What the core needs from a catalog row to download its publication.
pub(crate) struct CatalogEntry {
    /// The undated `KeySymbol`, e.g. `w`: pub-media's `pub`.
    pub key_symbol: String,
    pub meps_language: u32,
    pub issue_tag: u32,
    pub asset: CatalogAsset,
}

/// Handle to the catalog. Cheap to clone; shares the core's state.
#[derive(Clone)]
pub struct Catalog {
    inner: Arc<Inner>,
}

impl Catalog {
    pub(crate) fn new(inner: Arc<Inner>) -> Self {
        Catalog { inner }
    }

    /// Replace the catalog with the one at `file_path`: a `catalog.db.gz` or
    /// the `catalog.db` inside it. Progress counts copying the file,
    /// validating it, indexing it, and committing.
    ///
    /// Not a readable catalog => `Corrupt`; cancelled => `Cancelled`. On any
    /// error the previous catalog is unchanged.
    pub fn ingest_file(
        &self,
        file_path: impl AsRef<Path>,
        progress: &dyn ProgressSink,
        cancel: &CancelToken,
    ) -> Result<(), CoreError> {
        const TOTAL: u64 = 4;
        cancel.check()?;
        let mut source = File::open(file_path)?;
        let mut magic = [0u8; 2];
        let gzipped = source.read_exact(&mut magic).is_ok() && magic == [0x1f, 0x8b];
        source.seek(SeekFrom::Start(0))?;

        // Dropping `staging` deletes whatever is left in it, on every path.
        let staging = TempDir::new_in(self.dir().join(STAGING))?;
        let staged = staging.path().join(CURRENT);
        let mut out = File::create(&staged)?;
        if gzipped {
            gunzip(&mut source, &mut out)?;
        } else {
            std::io::copy(&mut source, &mut out)?;
        }
        out.sync_all()?;
        drop(out);
        progress.on_progress(1, TOTAL);

        cancel.check()?;
        let conn = Connection::open_with_flags(&staged, OpenFlags::SQLITE_OPEN_READ_WRITE)
            .map_err(|_| CoreError::Corrupt)?;
        validate(&conn).map_err(|_| CoreError::Corrupt)?;
        progress.on_progress(2, TOTAL);

        cancel.check()?;
        // A rollback journal, so the stored file reads alone; and the index
        // that resolving a key and filtering by language search on.
        conn.execute_batch(
            "PRAGMA journal_mode = DELETE;
             CREATE INDEX IF NOT EXISTS berean_publication_key \
             ON Publication (MepsLanguageId, Symbol, IssueTagNumber);",
        )?;
        conn.close().map_err(|(_, e)| e)?;
        progress.on_progress(3, TOTAL);

        cancel.check()?;
        std::fs::rename(&staged, self.dir().join(CURRENT))?;
        progress.on_progress(TOTAL, TOTAL);
        Ok(())
    }

    /// The ingested snapshot, or `None` before any.
    pub fn revision(&self) -> Result<Option<CatalogRevision>, CoreError> {
        let Some(conn) = self.open()? else {
            return Ok(None);
        };
        let rev = conn.query_row(
            "SELECT Level, Created FROM Revision ORDER BY Level DESC LIMIT 1",
            [],
            |r| {
                Ok(CatalogRevision {
                    level: get_u64(r, 0)?,
                    created: r.get(1)?,
                })
            },
        )?;
        Ok(Some(rev))
    }

    /// The catalog publications `filter` matches, newest first: by year and
    /// issue descending, then title, symbol and language.
    pub fn publications(
        &self,
        filter: &CatalogFilter,
    ) -> Result<Vec<PublicationSummary>, CoreError> {
        let Some(conn) = self.open()? else {
            return Ok(Vec::new());
        };
        let mut conds = vec![RESOLVED.to_string()];
        let mut args: Vec<rusqlite::types::Value> = Vec::new();
        if let Some(lang) = filter.meps_language {
            conds.push("p.MepsLanguageId = ?".into());
            args.push(i64::from(lang).into());
        }
        if let Some(kind) = filter.kind {
            match KINDS.iter().find(|(_, k)| *k == kind) {
                Some((id, _)) => {
                    conds.push("p.PublicationTypeId = ?".into());
                    args.push((*id).into());
                }
                None => {
                    let ids: Vec<String> = KINDS.iter().map(|(id, _)| id.to_string()).collect();
                    conds.push(format!("p.PublicationTypeId NOT IN ({})", ids.join(",")));
                }
            }
        }
        if let Some(key_symbol) = &filter.key_symbol {
            conds.push("p.KeySymbol = ?".into());
            args.push(key_symbol.clone().into());
        }
        let sql = format!(
            "SELECT p.Symbol, p.MepsLanguageId, p.IssueTagNumber, p.Year, p.Title, \
                    p.PublicationTypeId \
             FROM Publication p JOIN PublicationAsset a ON a.PublicationId = p.Id \
             WHERE {} \
             ORDER BY p.Year DESC, p.IssueTagNumber DESC, p.Title, p.Symbol, p.MepsLanguageId",
            conds.join(" AND ")
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_from_iter(args), |r| {
            let symbol: String = r.get(0)?;
            let meps_language: u32 = r.get(1)?;
            let issue_tag: u32 = r.get(2)?;
            Ok(PublicationSummary {
                pub_key: format_pub_key(&symbol, meps_language, issue_tag),
                symbol,
                meps_language,
                issue_tag,
                year: r.get(3)?,
                title: r.get(4)?,
                kind: kind_of(r.get(5)?),
            })
        })?;

        // Unicode-aware case folding, which SQLite's `LIKE` lacks, so the
        // text filter and the limit are applied here, in order.
        let text = filter.text.as_ref().map(|t| t.to_lowercase());
        let limit = filter.limit.map_or(usize::MAX, |n| n as usize);
        let mut out = Vec::new();
        for row in rows {
            if out.len() >= limit {
                break;
            }
            let row = row?;
            if text
                .as_ref()
                .is_none_or(|t| row.title.to_lowercase().contains(t.as_str()))
            {
                out.push(row);
            }
        }
        Ok(out)
    }

    /// The languages with at least one publication, by MEPS id. A language
    /// the language table does not map has no code or name, so it is left
    /// out (its publications still list, by `meps_language`).
    pub fn languages(&self) -> Result<Vec<Language>, CoreError> {
        let Some(conn) = self.open()? else {
            return Ok(Vec::new());
        };
        let mut stmt =
            conn.prepare("SELECT DISTINCT MepsLanguageId FROM Publication ORDER BY 1")?;
        let ids = stmt.query_map([], |r| r.get::<_, u32>(0))?;
        let mut out = Vec::new();
        for id in ids {
            if let Some(language) = languages::by_meps_id(id?) {
                out.push(language.clone());
            }
        }
        Ok(out)
    }

    /// The `.jwpub` file the catalog lists for `pub_key`. Malformed key =>
    /// `Invalid`; not in the catalog (or no catalog) => `NotFound`.
    pub fn asset(&self, pub_key: &str) -> Result<CatalogAsset, CoreError> {
        Ok(self.entry(pub_key)?.asset)
    }

    /// The catalog row `pub_key` resolves to. Malformed key => `Invalid`; not
    /// in the catalog (or no catalog) => `NotFound`.
    pub(crate) fn entry(&self, pub_key: &str) -> Result<CatalogEntry, CoreError> {
        let (symbol, lang, issue) = parse_pub_key(pub_key)?;
        let Some(conn) = self.open()? else {
            return Err(CoreError::NotFound);
        };
        let entry = conn.query_row(
            "SELECT a.Size, a.Signature, a.SchemaVersion, a.MinPlatformVersion, a.LastModified, \
                    p.KeySymbol \
             FROM Publication p JOIN PublicationAsset a ON a.PublicationId = p.Id \
             WHERE p.MepsLanguageId = ?1 AND p.Symbol = ?2 AND p.IssueTagNumber = ?3 \
             ORDER BY a.LastModified DESC, p.Id LIMIT 1",
            rusqlite::params![lang, symbol, issue],
            |r| {
                Ok(CatalogEntry {
                    key_symbol: r.get(5)?,
                    meps_language: lang,
                    issue_tag: issue,
                    asset: CatalogAsset {
                        size: get_u64(r, 0)?,
                        sha1: r.get(1)?,
                        schema_version: r.get(2)?,
                        min_platform_version: r.get(3)?,
                        last_modified: r.get(4)?,
                    },
                })
            },
        )?;
        Ok(entry)
    }

    /// Create the catalog directory and empty `.staging`, which only ever
    /// holds what a crash or failed ingest left behind.
    pub(crate) fn prepare_dir(&self) -> Result<(), CoreError> {
        let staging = self.dir().join(STAGING);
        std::fs::create_dir_all(&staging)?;
        for entry in std::fs::read_dir(&staging)? {
            remove_path(&entry?.path())?;
        }
        Ok(())
    }

    /// The stored catalog opened read-only, or `None` before any ingest.
    fn open(&self) -> Result<Option<Connection>, CoreError> {
        let path = self.dir().join(CURRENT);
        if !path.is_file() {
            return Ok(None);
        }
        let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
        Ok(Some(Connection::open_with_flags(path, flags)?))
    }

    fn dir(&self) -> PathBuf {
        self.inner.data_dir.join(DIR)
    }
}

/// SQLite integers are `i64`; a negative one where a `u64` is expected is an
/// out-of-range error.
fn get_u64(r: &rusqlite::Row<'_>, i: usize) -> rusqlite::Result<u64> {
    let v: i64 = r.get(i)?;
    u64::try_from(v).map_err(|_| rusqlite::Error::IntegralValueOutOfRange(i, v))
}

fn kind_of(type_id: i64) -> PubKind {
    KINDS
        .iter()
        .find(|(id, _)| *id == type_id)
        .map_or(PubKind::Other, |(_, k)| *k)
}

/// Inflate `source` into `out`. A damaged or truncated stream => `Corrupt`;
/// a failed write => `Io`.
fn gunzip(source: &mut File, out: &mut File) -> Result<(), CoreError> {
    let mut gz = flate2::read::MultiGzDecoder::new(std::io::BufReader::new(source));
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = gz.read(&mut buf).map_err(|_| CoreError::Corrupt)?;
        if n == 0 {
            return Ok(());
        }
        out.write_all(&buf[..n])?;
    }
}

/// Check that `conn` is a catalog this build can read: a sound SQLite
/// database with every [`REQUIRED`] column and a `Revision` row.
fn validate(conn: &Connection) -> Result<(), CoreError> {
    let check: String = conn.query_row("PRAGMA quick_check(1)", [], |r| r.get(0))?;
    if check != "ok" {
        return Err(CoreError::Corrupt);
    }
    for (table, columns) in REQUIRED {
        let mut stmt = conn.prepare("SELECT name FROM pragma_table_info(?1)")?;
        let present: Vec<String> = stmt
            .query_map([table], |r| r.get(0))?
            .collect::<Result<_, _>>()?;
        if !columns.iter().all(|c| present.iter().any(|p| p == c)) {
            return Err(CoreError::Corrupt);
        }
    }
    conn.query_row("SELECT Level, Created FROM Revision LIMIT 1", [], |r| {
        Ok((get_u64(r, 0)?, r.get::<_, String>(1)?))
    })
    .optional()?
    .ok_or(CoreError::Corrupt)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds() {
        assert_eq!(kind_of(14), PubKind::Watchtower);
        assert_eq!(kind_of(13), PubKind::Awake);
        assert_eq!(kind_of(1), PubKind::Bible);
        assert_eq!(kind_of(30), PubKind::MeetingWorkbook);
        assert_eq!(kind_of(7), PubKind::Other);
    }
}
