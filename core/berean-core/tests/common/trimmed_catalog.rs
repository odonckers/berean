//! A small catalog cut from the pinned real one, so most catalog tests ingest
//! a few MB instead of ~230 MB.
//!
//! It has the real file's schema (every table created from its
//! `sqlite_master` SQL) and only the rows for MEPS languages 0 (English) and
//! 1 (Spanish), plus the rows of the other tables that belong to them. The
//! cut is deterministic: the same real file always gives the same rows. It is
//! built once into Cargo's per-target temp dir, named after the real file and
//! [`VERSION`], and rebuilt when missing; it is written to a temp file and
//! renamed into place, so concurrent test processes never see a partial one.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use rusqlite::Connection;

use crate::common::fixture;

/// The pinned real catalog (see `core/scripts/fixtures.txt`).
pub const FULL: &str = "catalog-v5-ffa78686.db.gz";

/// Bump when the cut below changes, so stale copies are not reused.
const VERSION: u32 = 1;

/// Every table of the real catalog and which of its rows to keep, in an order
/// where each filter only refers to tables already copied.
const TABLES: &[(&str, &str)] = &[
    ("Revision", ""),
    ("PublicationAttribute", ""),
    ("Publication", "WHERE MepsLanguageId IN (0, 1)"),
    (
        "PublicationRootKey",
        "WHERE Id IN (SELECT PublicationRootKeyId FROM main.Publication)",
    ),
    (
        "PublicationAsset",
        "WHERE PublicationId IN (SELECT Id FROM main.Publication)",
    ),
    (
        "PublicationAttributeMap",
        "WHERE PublicationId IN (SELECT Id FROM main.Publication)",
    ),
    (
        "PublicationDocument",
        "WHERE PublicationId IN (SELECT Id FROM main.Publication)",
    ),
    (
        "AvailableBibleBook",
        "WHERE PublicationId IN (SELECT Id FROM main.Publication)",
    ),
    (
        "DatedText",
        "WHERE PublicationId IN (SELECT Id FROM main.Publication)",
    ),
    (
        "PublicationAssetImageMap",
        "WHERE PublicationAssetId IN (SELECT Id FROM main.PublicationAsset)",
    ),
    (
        "ImageAsset",
        "WHERE Id IN (SELECT ImageAssetId FROM main.PublicationAssetImageMap)",
    ),
    (
        "CuratedAsset",
        "WHERE PublicationAssetId IN (SELECT Id FROM main.PublicationAsset)",
    ),
];

/// The path of the trimmed catalog (a plain, uncompressed `catalog.db`).
pub fn trimmed() -> PathBuf {
    static PATH: OnceLock<PathBuf> = OnceLock::new();
    PATH.get_or_init(build).clone()
}

fn build() -> PathBuf {
    let source = fixture(FULL);
    let tmp_root = Path::new(env!("CARGO_TARGET_TMPDIR"));
    let stem = FULL.trim_end_matches(".db.gz");
    let out = tmp_root.join(format!("{stem}-trimmed-v{VERSION}.db"));
    if out.is_file() {
        return out;
    }

    let work = tempfile::tempdir_in(tmp_root).unwrap();
    let full = work.path().join("full.db");
    let mut gz = flate2::read::GzDecoder::new(std::fs::File::open(&source).unwrap());
    std::io::copy(&mut gz, &mut std::fs::File::create(&full).unwrap()).unwrap();

    let cut = work.path().join("trimmed.db");
    let conn = Connection::open(&cut).unwrap();
    // Rows are copied table by table, and the real data need not satisfy its
    // declared foreign keys anyway.
    conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
    conn.execute("ATTACH DATABASE ?1 AS src", [full.to_str().unwrap()])
        .unwrap();

    let schema: Vec<(String, String, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT type, name, sql FROM src.sqlite_master \
                 WHERE sql IS NOT NULL ORDER BY type DESC, name",
            )
            .unwrap();
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap();
        rows.collect::<Result<_, _>>().unwrap()
    };
    // `type DESC`: tables before indexes.
    for (kind, name, sql) in &schema {
        if kind == "table" {
            assert!(
                TABLES.iter().any(|(t, _)| t == name),
                "the trimmed catalog does not know how to cut table {name}"
            );
        }
        conn.execute_batch(sql).unwrap();
    }
    for (table, filter) in TABLES {
        conn.execute_batch(&format!(
            "INSERT INTO main.\"{table}\" SELECT * FROM src.\"{table}\" {filter};"
        ))
        .unwrap();
    }
    conn.execute_batch("DETACH DATABASE src;").unwrap();
    drop(conn);

    std::fs::rename(&cut, &out).unwrap();
    out
}
