//! Berean core: owns all on-device data (the user-data SQLite DB, the
//! downloaded publication store, and the search index). Callers see only this
//! API — never a path into the data or any SQL. Network transfer lives outside
//! the core: it produces download plans and later consumes the resulting files
//! from disk.

pub mod catalog;
pub mod jwpub;
pub mod library;
pub mod search;
pub mod userdata;

use std::path::Path;
use std::sync::Mutex;

use rusqlite::Connection;
use rusqlite_migration::{Migrations, M};

/// The core version, taken straight from the crate's `CARGO_PKG_VERSION`.
pub fn core_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// One error type for the whole core. The FFI crate mirrors it as a
/// `uniffi::Error` so it crosses the language boundary as a thrown error.
#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("not found")]
    NotFound,
    #[error("data is corrupt")]
    Corrupt,
    #[error("io error: {0}")]
    Io(String),
    #[error("operation cancelled")]
    Cancelled,
    #[error("migration error: {0}")]
    Migration(String),
    #[error("invalid: {0}")]
    Invalid(String),
}

impl From<std::io::Error> for CoreError {
    fn from(e: std::io::Error) -> Self {
        CoreError::Io(e.to_string())
    }
}

impl From<rusqlite::Error> for CoreError {
    fn from(e: rusqlite::Error) -> Self {
        use rusqlite::ErrorCode;
        match e {
            rusqlite::Error::QueryReturnedNoRows => CoreError::NotFound,
            rusqlite::Error::SqliteFailure(err, _)
                if matches!(
                    err.code,
                    ErrorCode::DatabaseCorrupt | ErrorCode::NotADatabase
                ) =>
            {
                CoreError::Corrupt
            }
            other => CoreError::Invalid(other.to_string()),
        }
    }
}

impl From<rusqlite_migration::Error> for CoreError {
    fn from(e: rusqlite_migration::Error) -> Self {
        match e {
            // A migration that fails because the database itself is unreadable
            // (e.g. corrupt or not a DB) should surface as `Corrupt`, not a
            // generic migration error.
            rusqlite_migration::Error::RusqliteError { err, .. } => err.into(),
            other => CoreError::Migration(other.to_string()),
        }
    }
}

/// Forward-only migrations for the user-data DB, tracked with
/// `PRAGMA user_version`. The initial migration is intentionally empty: it
/// stamps the DB at version 1 without yet defining any tables.
fn migration_list() -> Vec<M<'static>> {
    vec![M::up("")]
}

/// The schema version this build targets — i.e. the number of migrations the
/// user DB is brought forward to on `open`.
pub fn user_db_schema() -> u32 {
    migration_list().len() as u32
}

/// The single shared handle to all core data. `Send + Sync`: the SQLite
/// connection is behind a `Mutex`, so callers may use it from any thread.
pub struct Core {
    conn: Mutex<Connection>,
}

impl Core {
    /// Open (creating if missing) the data and cache directories, open/create
    /// the user-data DB under `data_dir`, and migrate it forward.
    pub fn open(
        data_dir: impl AsRef<Path>,
        cache_dir: impl AsRef<Path>,
    ) -> Result<Self, CoreError> {
        let data_dir = data_dir.as_ref();
        let cache_dir = cache_dir.as_ref();
        std::fs::create_dir_all(data_dir)?;
        std::fs::create_dir_all(cache_dir)?;

        let mut conn = Connection::open(data_dir.join("user.sqlite"))?;
        migrations().to_latest(&mut conn)?;

        Ok(Core {
            conn: Mutex::new(conn),
        })
    }

    /// The user DB's actual schema version, read from `PRAGMA user_version`.
    pub fn db_version(&self) -> Result<u32, CoreError> {
        let conn = self.conn.lock().expect("core connection mutex poisoned");
        let v: u32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        Ok(v)
    }
}

/// The migration set applied to the user DB on `open`.
fn migrations() -> Migrations<'static> {
    Migrations::new(migration_list())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn core_version_matches_cargo_pkg_version() {
        assert_eq!(core_version(), env!("CARGO_PKG_VERSION"));
        assert!(!core_version().is_empty());
    }

    #[test]
    fn open_is_idempotent_and_schema_is_stable() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        let cache = dir.path().join("cache");

        let core = Core::open(&data, &cache).unwrap();
        assert_eq!(core.db_version().unwrap(), user_db_schema());
        drop(core);

        // Opening again on the same dir must not change the schema version.
        let core = Core::open(&data, &cache).unwrap();
        assert_eq!(core.db_version().unwrap(), user_db_schema());
    }

    #[test]
    fn open_with_file_as_data_dir_is_io_error() {
        // A plain file where a directory is expected → create_dir_all fails.
        let file = tempfile::NamedTempFile::new().unwrap();
        let cache = tempfile::tempdir().unwrap();
        // `Core` isn't `Debug` (it wraps a `Connection`), so match instead of
        // `unwrap_err`.
        let err = match Core::open(file.path(), cache.path()) {
            Ok(_) => panic!("expected an io error"),
            Err(e) => e,
        };
        assert!(matches!(err, CoreError::Io(_)), "got {err:?}");
    }

    #[test]
    fn open_with_corrupt_db_is_corrupt() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        let cache = dir.path().join("cache");
        std::fs::create_dir_all(&data).unwrap();
        // Garbage where SQLite expects a database file → opening/migrating fails
        // with "not a database", which maps to `Corrupt`.
        std::fs::write(
            data.join("user.sqlite"),
            b"definitely not a sqlite database",
        )
        .unwrap();

        let err = match Core::open(&data, &cache) {
            Ok(_) => panic!("expected a corrupt error"),
            Err(e) => e,
        };
        assert!(matches!(err, CoreError::Corrupt), "got {err:?}");
    }

    #[test]
    fn rusqlite_no_rows_maps_to_not_found() {
        let err: CoreError = rusqlite::Error::QueryReturnedNoRows.into();
        assert!(matches!(err, CoreError::NotFound));
    }

    #[test]
    fn migration_error_maps_to_migration() {
        // Any migration failure surfaces as CoreError::Migration.
        let err: CoreError = rusqlite_migration::Error::FileLoad("boom".to_string()).into();
        assert!(matches!(err, CoreError::Migration(_)));
    }
}
