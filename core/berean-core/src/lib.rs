//! Berean core: owns all on-device data (the user-data SQLite DB, the
//! downloaded publication store, and the search index). Callers see only this
//! API — never a path into the data or any SQL. The core never does
//! networking: it says which requests to make (`Library::download_request`),
//! turns their replies into download plans (`Library::plan_download`), and
//! later consumes the downloaded files from disk.

pub mod catalog;
pub mod doc_blocks;
mod instant;
pub mod jwpub;
pub mod languages;
pub mod library;
pub mod meetings;
pub mod notes;
pub mod reader;
pub mod search;
pub mod userdata;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

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
    /// The device ran out of space (or a storage quota was hit). The
    /// operation wrote nothing that lasts; the user can free space and retry.
    #[error("storage is full")]
    StorageFull,
    #[error("operation cancelled")]
    Cancelled,
    #[error("migration error: {0}")]
    Migration(String),
    #[error("invalid: {0}")]
    Invalid(String),
}

impl From<std::io::Error> for CoreError {
    fn from(e: std::io::Error) -> Self {
        use std::io::ErrorKind;
        match e.kind() {
            ErrorKind::StorageFull | ErrorKind::QuotaExceeded => CoreError::StorageFull,
            _ => CoreError::Io(e.to_string()),
        }
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
            rusqlite::Error::SqliteFailure(err, _) if err.code == ErrorCode::DiskFull => {
                CoreError::StorageFull
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
/// `PRAGMA user_version`. Only ever append. The initial migration is
/// intentionally empty: it stamps the DB at version 1.
fn migration_list() -> Vec<M<'static>> {
    vec![
        M::up(""),
        // One row per publication in the store; `dir` is its directory under
        // `publications/`, `installed_at` is Unix seconds.
        M::up(
            "CREATE TABLE installed_publication (
                pub_key TEXT PRIMARY KEY NOT NULL,
                symbol TEXT NOT NULL,
                meps_language INTEGER NOT NULL,
                issue_tag INTEGER NOT NULL,
                year INTEGER NOT NULL,
                title TEXT NOT NULL,
                publication_type TEXT NOT NULL,
                dir TEXT NOT NULL UNIQUE,
                installed_at INTEGER NOT NULL
            );",
        ),
        // The search index (see `search`): one row per verse or paragraph of
        // an installed publication. Only `text` is searched; the rest says
        // where the row is.
        M::up(
            "CREATE VIRTUAL TABLE search_index USING fts5(
                text,
                title UNINDEXED,
                pub_key UNINDEXED,
                doc_id UNINDEXED,
                book UNINDEXED,
                chapter UNINDEXED,
                verse UNINDEXED,
                paragraph UNINDEXED,
                tokenize = 'unicode61 remove_diacritics 2'
            );",
        ),
    ]
}

/// The schema version this build targets — i.e. the number of migrations the
/// user DB is brought forward to on `open`.
pub fn user_db_schema() -> u32 {
    migration_list().len() as u32
}

/// Lets a caller stop a long-running call. The core checks it between steps;
/// a call that sees it set fails with `Cancelled` and leaves nothing behind.
#[derive(Debug, Default)]
pub struct CancelToken(AtomicBool);

impl CancelToken {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::Relaxed);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }

    /// `Err(Cancelled)` once cancelled.
    pub(crate) fn check(&self) -> Result<(), CoreError> {
        if self.is_cancelled() {
            Err(CoreError::Cancelled)
        } else {
            Ok(())
        }
    }
}

/// Receives progress from a long-running call: `done` of `total` steps.
/// `total` is fixed for the call and `done` never decreases.
pub trait ProgressSink {
    fn on_progress(&self, done: u64, total: u64);
}

impl<F: Fn(u64, u64)> ProgressSink for F {
    fn on_progress(&self, done: u64, total: u64) {
        self(done, total)
    }
}

/// Maps `done` of `units` of work onto steps `base..=base + steps` of
/// `total`, reporting only when the step advances, so a call reports at most
/// `steps` times however many units it has.
pub(crate) struct Steps<'a> {
    progress: &'a dyn ProgressSink,
    base: u64,
    steps: u64,
    units: u64,
    total: u64,
    reported: u64,
}

impl<'a> Steps<'a> {
    pub(crate) fn new(
        progress: &'a dyn ProgressSink,
        base: u64,
        steps: u64,
        units: u64,
        total: u64,
    ) -> Self {
        Steps {
            progress,
            base,
            steps,
            units,
            total,
            reported: base,
        }
    }

    /// `done` units are done. No units (`units` 0) reports nothing.
    pub(crate) fn report(&mut self, done: u64) {
        let at = self.base + done.min(self.units) * self.steps / self.units.max(1);
        if at > self.reported {
            self.reported = at;
            self.progress.on_progress(at, self.total);
        }
    }
}

/// The single shared handle to all core data. `Send + Sync`: the SQLite
/// connection is behind a `Mutex`, so callers may use it from any thread.
pub struct Core {
    inner: Arc<Inner>,
}

/// State shared by `Core` and the handles it gives out.
///
/// Lock order: a publication's lock, then `publications`, then `conn`. A
/// thread holds at most one publication lock at a time, and never waits on
/// one while holding `publications` or `conn`. `userdata` stands alone: it
/// is never taken while another of these locks is held, nor another taken
/// while it is held.
pub(crate) struct Inner {
    conn: Mutex<Connection>,
    /// The user-data database, `userData.db` (see `userdata`).
    userdata: Mutex<Connection>,
    /// Recently opened publications, least recently used first, keyed by
    /// their store directory (a reinstall gets a new one). See
    /// `Library::with_publication`.
    publications: Mutex<Vec<(String, Arc<Mutex<jwpub::Publication>>)>>,
    pub(crate) data_dir: PathBuf,
}

impl Inner {
    pub(crate) fn conn(&self) -> MutexGuard<'_, Connection> {
        self.conn.lock().expect("core connection mutex poisoned")
    }

    pub(crate) fn userdata(&self) -> MutexGuard<'_, Connection> {
        self.userdata
            .lock()
            .expect("user-data connection mutex poisoned")
    }

    pub(crate) fn publications(
        &self,
    ) -> MutexGuard<'_, Vec<(String, Arc<Mutex<jwpub::Publication>>)>> {
        // The cache is only ever left consistent, so a panic elsewhere while
        // it was held does not make it unusable.
        self.publications
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

impl Core {
    /// Open (creating if missing) the data and cache directories, open/create
    /// the core DB under `data_dir` and migrate it forward, and open/create
    /// the user-data DB (`userData.db`) next to it.
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
        let userdata = userdata::open(data_dir)?;

        let inner = Arc::new(Inner {
            conn: Mutex::new(conn),
            userdata: Mutex::new(userdata),
            publications: Mutex::new(Vec::new()),
            data_dir: data_dir.to_path_buf(),
        });
        library::Library::new(inner.clone()).prepare_store()?;
        catalog::Catalog::new(inner.clone()).prepare_dir()?;
        Ok(Core { inner })
    }

    /// The publication library.
    pub fn library(&self) -> library::Library {
        library::Library::new(self.inner.clone())
    }

    /// The publication catalog.
    pub fn catalog(&self) -> catalog::Catalog {
        catalog::Catalog::new(self.inner.clone())
    }

    /// The reader.
    pub fn reader(&self) -> reader::Reader {
        reader::Reader::new(self.inner.clone())
    }

    /// Full-text search over the installed publications.
    pub fn search(&self) -> search::Search {
        search::Search::new(self.inner.clone())
    }

    /// The user's notes, highlights, tags, favorites and bookmarks.
    pub fn userdata(&self) -> userdata::UserData {
        userdata::UserData::new(self.inner.clone())
    }

    /// The user DB's actual schema version, read from `PRAGMA user_version`.
    pub fn db_version(&self) -> Result<u32, CoreError> {
        let conn = self.inner.conn();
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
    fn core_is_send_and_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<Core>();
        assert_send_sync::<library::Library>();
        assert_send_sync::<reader::Reader>();
        assert_send_sync::<search::Search>();
        assert_send_sync::<userdata::UserData>();
    }

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

    #[test]
    fn storage_full_display() {
        assert_eq!(CoreError::StorageFull.to_string(), "storage is full");
    }

    #[test]
    fn io_out_of_space_maps_to_storage_full() {
        use std::io::{Error, ErrorKind};
        let err: CoreError = Error::from(ErrorKind::StorageFull).into();
        assert!(matches!(err, CoreError::StorageFull), "got {err:?}");
        let err: CoreError = Error::from(ErrorKind::QuotaExceeded).into();
        assert!(matches!(err, CoreError::StorageFull), "got {err:?}");
        let err: CoreError = Error::from(ErrorKind::PermissionDenied).into();
        assert!(matches!(err, CoreError::Io(_)), "got {err:?}");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn writing_to_dev_full_is_storage_full() {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .open("/dev/full")
            .unwrap();
        // ENOSPC comes back on the write (or, if buffered, the flush).
        let err = file
            .write_all(&[0u8; 4096])
            .and_then(|()| file.flush())
            .and_then(|()| file.sync_all())
            .unwrap_err();
        let err: CoreError = err.into();
        assert!(matches!(err, CoreError::StorageFull), "got {err:?}");
    }

    #[test]
    fn sqlite_full_maps_to_storage_full() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA max_page_count = 16; CREATE TABLE t (b BLOB);")
            .unwrap();
        let mut err = None;
        for _ in 0..1000 {
            if let Err(e) = conn.execute("INSERT INTO t VALUES (zeroblob(4096))", []) {
                err = Some(e);
                break;
            }
        }
        let err = err.expect("the page cap should fill the database");
        assert_eq!(err.sqlite_error_code(), Some(rusqlite::ErrorCode::DiskFull));
        let err: CoreError = err.into();
        assert!(matches!(err, CoreError::StorageFull), "got {err:?}");
    }

    #[test]
    fn sqlite_corrupt_and_constraint_keep_their_mapping() {
        use rusqlite::ffi;
        let err: CoreError =
            rusqlite::Error::SqliteFailure(ffi::Error::new(ffi::SQLITE_CORRUPT), None).into();
        assert!(matches!(err, CoreError::Corrupt), "got {err:?}");
        let err: CoreError =
            rusqlite::Error::SqliteFailure(ffi::Error::new(ffi::SQLITE_CONSTRAINT), None).into();
        assert!(matches!(err, CoreError::Invalid(_)), "got {err:?}");
    }

    #[test]
    fn zip_write_io_error_keeps_its_kind() {
        use std::io::{Error, ErrorKind};
        use zip::result::ZipError;
        let err = userdata::zip_write_error(ZipError::Io(Error::from(ErrorKind::StorageFull)));
        assert!(matches!(err, CoreError::StorageFull), "got {err:?}");
        let err = userdata::zip_write_error(ZipError::FileNotFound);
        assert!(matches!(err, CoreError::Io(_)), "got {err:?}");
    }

    #[test]
    fn persist_into_missing_dir_is_io_not_storage_full() {
        let dir = tempfile::tempdir().unwrap();
        let tmp = tempfile::NamedTempFile::new_in(dir.path()).unwrap();
        let err = tmp
            .persist(dir.path().join("missing").join("file"))
            .map_err(|e| CoreError::from(e.error))
            .unwrap_err();
        assert!(matches!(err, CoreError::Io(_)), "got {err:?}");
    }
}
