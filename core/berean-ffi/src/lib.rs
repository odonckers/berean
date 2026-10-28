//! Thin UniFFI surface over `berean-core`. All real logic lives in the core;
//! this crate only exposes it to foreign-language callers. Keeping every
//! exported type in this one crate means UniFFI generates a single module.

use std::sync::Arc;

uniffi::setup_scaffolding!();

/// The core version string.
#[uniffi::export]
pub fn core_version() -> String {
    berean_core::core_version()
}

/// The schema version this build targets for the user DB.
#[uniffi::export]
pub fn user_db_schema() -> u32 {
    berean_core::user_db_schema()
}

/// The FFI mirror of [`berean_core::CoreError`], exposed to callers as a
/// thrown error. It carries the same variants; the conversion below is the
/// only place the two are tied together.
#[derive(Debug, thiserror::Error, uniffi::Error)]
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

impl From<berean_core::CoreError> for CoreError {
    fn from(e: berean_core::CoreError) -> Self {
        use berean_core::CoreError as C;
        match e {
            C::NotFound => CoreError::NotFound,
            C::Corrupt => CoreError::Corrupt,
            C::Io(m) => CoreError::Io(m),
            C::Cancelled => CoreError::Cancelled,
            C::Migration(m) => CoreError::Migration(m),
            C::Invalid(m) => CoreError::Invalid(m),
        }
    }
}

/// The single shared `Core` handle, exposed to callers as an object.
#[derive(uniffi::Object)]
pub struct Core {
    inner: berean_core::Core,
}

#[uniffi::export]
impl Core {
    /// Open (creating if missing) the data and cache directories and migrate
    /// the user DB forward.
    #[uniffi::constructor]
    pub fn open(data_dir: String, cache_dir: String) -> Result<Arc<Self>, CoreError> {
        let inner = berean_core::Core::open(&data_dir, &cache_dir)?;
        Ok(Arc::new(Core { inner }))
    }

    /// The user DB's actual schema version, read from the database.
    pub fn db_version(&self) -> Result<u32, CoreError> {
        Ok(self.inner.db_version()?)
    }
}
