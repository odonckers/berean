//! User data: notes, highlights, tags, favorites and bookmarks keyed by
//! location, plus `.jwlibrary` backup export/import.
//!
//! # Storage
//!
//! The data lives in its own SQLite file, `<data_dir>/userData.db`, in JW
//! Library's own v16 schema (see docs/design/userdata.md, model A), so a
//! backup is close to a copy of the file and round-trips losslessly, tables
//! and columns Berean doesn't surface included. A missing file is created
//! from the vendored DDL in `userdata_v16.sql`. Its `PRAGMA user_version` is
//! JW's schema version (16), not our migration counter: this file is never
//! run through the core DB's migrations.

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::CoreError;

/// The file name of the user-data database in the data dir; also the
/// database name a backup manifest gives by default.
pub(crate) const DB_FILE: &str = "userData.db";

/// JW Library's v16 user-data schema, with its initial rows; see the file's
/// header for where it comes from.
const SCHEMA_V16: &str = include_str!("userdata_v16.sql");

/// The path of the user-data database under `data_dir`.
pub(crate) fn db_path(data_dir: &Path) -> PathBuf {
    data_dir.join(DB_FILE)
}

/// Open the user-data database under `data_dir`, first creating it from the
/// vendored v16 DDL if it is missing. The new file is built under a
/// temporary name and renamed into place, so a failed creation leaves no
/// half-made database behind. Foreign keys are enforced on the connection.
/// A file that isn't a database => `Corrupt`.
pub(crate) fn open(data_dir: &Path) -> Result<Connection, CoreError> {
    let path = db_path(data_dir);
    if !path.exists() {
        let tmp = tempfile::Builder::new()
            .prefix(".userData.")
            .suffix(".db")
            .tempfile_in(data_dir)?;
        {
            let conn = Connection::open(tmp.path())?;
            conn.execute_batch(&format!("BEGIN;\n{SCHEMA_V16}\nCOMMIT;"))?;
        }
        tmp.persist(&path)
            .map_err(|e| CoreError::Io(e.to_string()))?;
    }
    let conn = Connection::open(&path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    // SQLite opens lazily: read the schema so a damaged file fails here, as
    // `Corrupt`, rather than on the first call that uses it.
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |_| Ok(()))?;
    Ok(conn)
}
