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

    /// The publication library.
    pub fn library(&self) -> Arc<Library> {
        Arc::new(Library {
            inner: self.inner.library(),
        })
    }

    /// The publication catalog.
    pub fn catalog(&self) -> Arc<Catalog> {
        Arc::new(Catalog {
            inner: self.inner.catalog(),
        })
    }
}

/// Lets a caller stop a long-running call; the core checks it between steps.
#[derive(uniffi::Object)]
pub struct CancelToken {
    inner: berean_core::CancelToken,
}

#[uniffi::export]
impl CancelToken {
    #[uniffi::constructor]
    pub fn new() -> Arc<Self> {
        Arc::new(CancelToken {
            inner: berean_core::CancelToken::new(),
        })
    }

    pub fn cancel(&self) {
        self.inner.cancel();
    }

    pub fn is_cancelled(&self) -> bool {
        self.inner.is_cancelled()
    }
}

/// Implemented by the caller to receive progress from a long-running call:
/// `done` of `total` steps, `total` fixed and `done` never decreasing.
#[uniffi::export(with_foreign)]
pub trait ProgressSink: Send + Sync {
    fn on_progress(&self, done: u64, total: u64);
}

/// The FFI mirror of [`berean_core::library::PubKind`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
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

impl From<berean_core::library::PubKind> for PubKind {
    fn from(k: berean_core::library::PubKind) -> Self {
        use berean_core::library::PubKind as K;
        match k {
            K::Bible => PubKind::Bible,
            K::Book => PubKind::Book,
            K::Brochure => PubKind::Brochure,
            K::Watchtower => PubKind::Watchtower,
            K::Awake => PubKind::Awake,
            K::Index => PubKind::Index,
            K::MeetingWorkbook => PubKind::MeetingWorkbook,
            K::Other => PubKind::Other,
        }
    }
}

impl From<PubKind> for berean_core::library::PubKind {
    fn from(k: PubKind) -> Self {
        use berean_core::library::PubKind as K;
        match k {
            PubKind::Bible => K::Bible,
            PubKind::Book => K::Book,
            PubKind::Brochure => K::Brochure,
            PubKind::Watchtower => K::Watchtower,
            PubKind::Awake => K::Awake,
            PubKind::Index => K::Index,
            PubKind::MeetingWorkbook => K::MeetingWorkbook,
            PubKind::Other => K::Other,
        }
    }
}

/// The FFI mirror of [`berean_core::library::PublicationSummary`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct PublicationSummary {
    pub pub_key: String,
    pub symbol: String,
    pub meps_language: u32,
    pub issue_tag: u32,
    pub year: u32,
    pub title: String,
    pub kind: PubKind,
}

impl From<berean_core::library::PublicationSummary> for PublicationSummary {
    fn from(s: berean_core::library::PublicationSummary) -> Self {
        PublicationSummary {
            pub_key: s.pub_key,
            symbol: s.symbol,
            meps_language: s.meps_language,
            issue_tag: s.issue_tag,
            year: s.year,
            title: s.title,
            kind: s.kind.into(),
        }
    }
}

/// The FFI mirror of [`berean_core::library::DownloadPlan`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct DownloadPlan {
    pub url: String,
    pub size: u64,
    pub checksum: String,
}

impl From<berean_core::library::DownloadPlan> for DownloadPlan {
    fn from(p: berean_core::library::DownloadPlan) -> Self {
        DownloadPlan {
            url: p.url,
            size: p.size,
            checksum: p.checksum,
        }
    }
}

/// The FFI mirror of [`berean_core::library::HttpRequest`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct HttpRequest {
    pub url: String,
}

impl From<berean_core::library::HttpRequest> for HttpRequest {
    fn from(r: berean_core::library::HttpRequest) -> Self {
        HttpRequest { url: r.url }
    }
}

/// The FFI mirror of [`berean_core::catalog::CatalogFilter`].
#[derive(Debug, Clone, Default, PartialEq, Eq, uniffi::Record)]
pub struct CatalogFilter {
    pub meps_language: Option<u32>,
    pub kind: Option<PubKind>,
    pub key_symbol: Option<String>,
    pub text: Option<String>,
    pub limit: Option<u32>,
}

impl From<CatalogFilter> for berean_core::catalog::CatalogFilter {
    fn from(f: CatalogFilter) -> Self {
        berean_core::catalog::CatalogFilter {
            meps_language: f.meps_language,
            kind: f.kind.map(Into::into),
            key_symbol: f.key_symbol,
            text: f.text,
            limit: f.limit,
        }
    }
}

/// The FFI mirror of [`berean_core::languages::Language`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Language {
    pub meps_id: u32,
    pub code: String,
    pub name: String,
}

impl From<berean_core::languages::Language> for Language {
    fn from(l: berean_core::languages::Language) -> Self {
        Language {
            meps_id: l.meps_id,
            code: l.code,
            name: l.name,
        }
    }
}

/// The publication catalog, exposed to callers as an object.
#[derive(uniffi::Object)]
pub struct Catalog {
    inner: berean_core::catalog::Catalog,
}

#[uniffi::export]
impl Catalog {
    /// Replace the catalog with the `catalog.db.gz` (or `catalog.db`) at
    /// `path`. On any error the previous catalog is unchanged.
    pub fn ingest_file(
        &self,
        path: String,
        cancel: Arc<CancelToken>,
        progress: Arc<dyn ProgressSink>,
    ) -> Result<(), CoreError> {
        Ok(self
            .inner
            .ingest_file(path, &Progress(progress), &cancel.inner)?)
    }

    /// The catalog publications `filter` matches, newest first.
    pub fn publications(
        &self,
        filter: CatalogFilter,
    ) -> Result<Vec<PublicationSummary>, CoreError> {
        Ok(self
            .inner
            .publications(&filter.into())?
            .into_iter()
            .map(Into::into)
            .collect())
    }

    /// The catalog's languages the language table maps, by MEPS id.
    pub fn languages(&self) -> Result<Vec<Language>, CoreError> {
        Ok(self
            .inner
            .languages()?
            .into_iter()
            .map(Into::into)
            .collect())
    }
}

/// The publication library, exposed to callers as an object.
#[derive(uniffi::Object)]
pub struct Library {
    inner: berean_core::library::Library,
}

/// Adapts a caller's [`ProgressSink`] to the core's.
struct Progress(Arc<dyn ProgressSink>);

impl berean_core::ProgressSink for Progress {
    fn on_progress(&self, done: u64, total: u64) {
        self.0.on_progress(done, total);
    }
}

#[uniffi::export]
impl Library {
    /// Verify, unpack and record the `.jwpub` at `file_path` as `pub_key`.
    pub fn install(
        &self,
        pub_key: String,
        file_path: String,
        progress: Arc<dyn ProgressSink>,
        cancel: Arc<CancelToken>,
    ) -> Result<(), CoreError> {
        Ok(self
            .inner
            .install(&pub_key, file_path, &Progress(progress), &cancel.inner)?)
    }

    /// All installed publications, ordered by key.
    pub fn installed(&self) -> Result<Vec<PublicationSummary>, CoreError> {
        Ok(self
            .inner
            .installed()?
            .into_iter()
            .map(Into::into)
            .collect())
    }

    /// Uninstall a publication.
    pub fn remove(&self, pub_key: String) -> Result<(), CoreError> {
        Ok(self.inner.remove(&pub_key)?)
    }

    /// The pub-media request that lists `pub_key`'s `.jwpub`. The caller
    /// makes it and passes the reply body to `plan_download`.
    pub fn download_request(&self, pub_key: String) -> Result<HttpRequest, CoreError> {
        Ok(self.inner.download_request(&pub_key)?.into())
    }

    /// Where to download `pub_key`, from the reply to its `download_request`.
    /// The plan's size and checksum (SHA-1, hex) are the catalog's.
    pub fn plan_download(
        &self,
        pub_key: String,
        response: Vec<u8>,
    ) -> Result<DownloadPlan, CoreError> {
        Ok(self.inner.plan_download(&pub_key, &response)?.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::Mutex;

    struct Recorder {
        calls: Mutex<Vec<(u64, u64)>>,
    }

    impl ProgressSink for Recorder {
        fn on_progress(&self, done: u64, total: u64) {
            self.calls.lock().unwrap().push((done, total));
        }
    }

    /// The path of a fixture; see `core/scripts/fetch-fixtures.sh`.
    fn fixture(name: &str) -> PathBuf {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../fixtures")
            .join(name);
        assert!(
            path.is_file(),
            "fixture missing: run core/scripts/fetch-fixtures.sh ({})",
            path.display()
        );
        path
    }

    fn open_core(dir: &tempfile::TempDir) -> Arc<Core> {
        Core::open(
            dir.path().join("data").display().to_string(),
            dir.path().join("cache").display().to_string(),
        )
        .unwrap()
    }

    #[test]
    fn install_round_trips_through_ffi() {
        let fixture = fixture("ll_E.jwpub");
        let dir = tempfile::tempdir().unwrap();
        let core = Core::open(
            dir.path().join("data").display().to_string(),
            dir.path().join("cache").display().to_string(),
        )
        .unwrap();
        let library = core.library();
        let path = fixture.display().to_string();

        let cancelled = CancelToken::new();
        cancelled.cancel();
        assert!(cancelled.is_cancelled());
        let recorder = Arc::new(Recorder {
            calls: Mutex::new(Vec::new()),
        });
        let err = library
            .install("ll:0:0".into(), path.clone(), recorder.clone(), cancelled)
            .unwrap_err();
        assert!(matches!(err, CoreError::Cancelled), "{err:?}");
        assert!(library.installed().unwrap().is_empty());

        let token = CancelToken::new();
        assert!(!token.is_cancelled());
        library
            .install("ll:0:0".into(), path, recorder.clone(), token)
            .unwrap();
        let calls = recorder.calls.lock().unwrap().clone();
        let (done, total) = *calls.last().unwrap();
        assert_eq!(done, total);

        assert_eq!(
            library.installed().unwrap(),
            vec![PublicationSummary {
                pub_key: "ll:0:0".into(),
                symbol: "ll".into(),
                meps_language: 0,
                issue_tag: 0,
                year: 2011,
                title: "Listen to God and Live Forever".into(),
                kind: PubKind::Brochure,
            }]
        );
        // No catalog: nothing to plan from.
        assert!(matches!(
            library.plan_download("ll:0:0".into(), Vec::new()),
            Err(CoreError::NotFound)
        ));
        library.remove("ll:0:0".into()).unwrap();
        assert!(library.installed().unwrap().is_empty());
    }

    #[test]
    fn catalog_and_downloads_through_ffi() {
        let dir = tempfile::tempdir().unwrap();
        let core = open_core(&dir);
        let catalog = core.catalog();
        let library = core.library();
        let path = fixture("catalog-v5-ffa78686.db.gz").display().to_string();
        let recorder = Arc::new(Recorder {
            calls: Mutex::new(Vec::new()),
        });

        let cancelled = CancelToken::new();
        cancelled.cancel();
        let err = catalog
            .ingest_file(path.clone(), cancelled, recorder.clone())
            .unwrap_err();
        assert!(matches!(err, CoreError::Cancelled), "{err:?}");
        assert!(catalog.languages().unwrap().is_empty());
        assert!(matches!(
            library.download_request("ll:0:0".into()),
            Err(CoreError::NotFound)
        ));

        catalog
            .ingest_file(path, CancelToken::new(), recorder.clone())
            .unwrap();
        let calls = recorder.calls.lock().unwrap().clone();
        let (done, total) = *calls.last().unwrap();
        assert_eq!(done, total);

        let languages = catalog.languages().unwrap();
        assert_eq!(
            languages[0],
            Language {
                meps_id: 0,
                code: "E".into(),
                name: "English".into(),
            }
        );

        let workbooks = catalog
            .publications(CatalogFilter {
                meps_language: Some(0),
                kind: Some(PubKind::MeetingWorkbook),
                key_symbol: Some("mwb".into()),
                ..Default::default()
            })
            .unwrap();
        let mwb = workbooks
            .iter()
            .find(|s| s.pub_key == "mwb26:0:20260900")
            .unwrap();
        assert_eq!(mwb.kind, PubKind::MeetingWorkbook);

        assert_eq!(
            library.download_request("ll:0:0".into()).unwrap(),
            HttpRequest {
                url: "https://b.jw-cdn.org/apis/pub-media/GETPUBMEDIALINKS\
                      ?output=json&fileformat=JWPUB&pub=ll&langwritten=E"
                    .into(),
            }
        );
        let reply = std::fs::read(fixture("pubmedia-ll_E.json")).unwrap();
        assert_eq!(
            library.plan_download("ll:0:0".into(), reply).unwrap(),
            DownloadPlan {
                url: "https://cfp2.jw-cdn.org/a/33502e/2/o/ll_E.jwpub".into(),
                size: 6419248,
                checksum: "50577b22544ce31654eeec183cd4d68cc9379d87".into(),
            }
        );
        assert!(matches!(
            library.plan_download("ll:0:0".into(), b"garbage".to_vec()),
            Err(CoreError::Corrupt)
        ));
    }
}
