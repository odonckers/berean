//! Thin UniFFI surface over `berean-core`. All real logic lives in the core;
//! this crate only exposes it to foreign-language callers. Keeping every
//! exported type in this one crate means UniFFI generates a single module.

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Waker};

uniffi::setup_scaffolding!();

/// Run the blocking `f` on its own thread; the returned future resolves to
/// its result once it is done. The core stays synchronous; this is the only
/// place a call is moved off the caller's thread. If `f` panics, polling the
/// future resumes that panic, so it surfaces on the caller's side as before.
fn run_on_thread<T: Send + 'static>(
    f: impl FnOnce() -> T + Send + 'static,
) -> impl Future<Output = T> {
    let shared = Arc::new(Mutex::new(Slot {
        result: None,
        waker: None,
    }));
    let thread_shared = shared.clone();
    std::thread::spawn(move || {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f));
        // Store the result and take the waker under one lock, so a poll can't
        // slip in between and miss the wake-up.
        let waker = {
            let mut slot = thread_shared.lock().unwrap();
            slot.result = Some(result);
            slot.waker.take()
        };
        if let Some(waker) = waker {
            waker.wake();
        }
    });
    OnThread { shared }
}

/// The state [`run_on_thread`]'s thread and future share.
struct Slot<T> {
    result: Option<std::thread::Result<T>>,
    waker: Option<Waker>,
}

/// The future [`run_on_thread`] returns.
struct OnThread<T> {
    shared: Arc<Mutex<Slot<T>>>,
}

impl<T> Future for OnThread<T> {
    type Output = T;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<T> {
        let mut slot = self.shared.lock().unwrap();
        let result = slot.result.take();
        if result.is_none() {
            slot.waker = Some(cx.waker().clone());
        }
        // Release the lock before a resumed panic unwinds through here.
        drop(slot);
        match result {
            Some(Ok(result)) => Poll::Ready(result),
            Some(Err(payload)) => std::panic::resume_unwind(payload),
            None => Poll::Pending,
        }
    }
}

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
#[uniffi::export(Display)]
pub enum CoreError {
    #[error("not found")]
    NotFound,
    #[error("data is corrupt")]
    Corrupt,
    #[error("io error: {0}")]
    Io(String),
    #[error("storage is full")]
    StorageFull,
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
            C::StorageFull => CoreError::StorageFull,
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

    /// The reader.
    pub fn reader(&self) -> Arc<Reader> {
        Arc::new(Reader {
            inner: self.inner.reader(),
        })
    }

    /// Full-text search over the installed publications.
    pub fn search(&self) -> Arc<Search> {
        Arc::new(Search {
            inner: self.inner.search(),
        })
    }

    /// The user's notes, highlights, tags, favorites and bookmarks.
    pub fn userdata(&self) -> Arc<UserData> {
        Arc::new(UserData {
            inner: self.inner.userdata(),
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
    pub issue_title: Option<String>,
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
            issue_title: s.issue_title,
            kind: s.kind.into(),
        }
    }
}

/// The FFI mirror of [`berean_core::library::SideLoad`]: what
/// `Library::side_load` did with a file.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum SideLoad {
    /// The file is installed as `publication`, replacing any copy of it.
    Installed { publication: PublicationSummary },
    /// A copy of `publication` is already installed and the call didn't ask
    /// to replace it: nothing changed.
    AlreadyInstalled { publication: PublicationSummary },
}

impl From<berean_core::library::SideLoad> for SideLoad {
    fn from(s: berean_core::library::SideLoad) -> Self {
        use berean_core::library::SideLoad as S;
        match s {
            S::Installed { publication } => SideLoad::Installed {
                publication: publication.into(),
            },
            S::AlreadyInstalled { publication } => SideLoad::AlreadyInstalled {
                publication: publication.into(),
            },
        }
    }
}

/// The FFI mirror of [`berean_core::catalog::NewPublication`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct NewPublication {
    pub publication: PublicationSummary,
    pub released: String,
}

impl From<berean_core::catalog::NewPublication> for NewPublication {
    fn from(n: berean_core::catalog::NewPublication) -> Self {
        NewPublication {
            publication: n.publication.into(),
            released: n.released,
        }
    }
}

/// The FFI mirror of [`berean_core::titles::TitleMatch`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct TitleMatch {
    pub publication: PublicationSummary,
    pub installed: bool,
}

impl From<berean_core::titles::TitleMatch> for TitleMatch {
    fn from(m: berean_core::titles::TitleMatch) -> Self {
        TitleMatch {
            publication: m.publication.into(),
            installed: m.installed,
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

/// The FFI mirror of [`berean_core::catalog::CatalogUpdate`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct CatalogUpdate {
    pub url: String,
    pub id: String,
}

impl From<berean_core::catalog::CatalogUpdate> for CatalogUpdate {
    fn from(u: berean_core::catalog::CatalogUpdate) -> Self {
        CatalogUpdate {
            url: u.url,
            id: u.id,
        }
    }
}

impl From<CatalogUpdate> for berean_core::catalog::CatalogUpdate {
    fn from(u: CatalogUpdate) -> Self {
        berean_core::catalog::CatalogUpdate {
            url: u.url,
            id: u.id,
        }
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
    pub vernacular: String,
}

impl From<berean_core::languages::Language> for Language {
    fn from(l: berean_core::languages::Language) -> Self {
        Language {
            meps_id: l.meps_id,
            code: l.code,
            name: l.name,
            vernacular: l.vernacular,
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
    /// `path`. On any error the previous catalog is unchanged. The work runs
    /// on its own thread; the call resolves when it is done.
    pub async fn ingest_file(
        &self,
        path: String,
        progress: Arc<dyn ProgressSink>,
        cancel: Arc<CancelToken>,
    ) -> Result<(), CoreError> {
        let inner = self.inner.clone();
        run_on_thread(move || Ok(inner.ingest_file(path, &Progress(progress), &cancel.inner)?))
            .await
    }

    /// The request for the manifest that names the current catalog. The
    /// caller makes it and passes the reply body to `plan_update`.
    pub fn manifest_request(&self) -> HttpRequest {
        self.inner.manifest_request().into()
    }

    /// The catalog to download, from the reply to `manifest_request`, or
    /// `None` when the installed catalog is the manifest's current one.
    pub fn plan_update(
        &self,
        manifest_response: Vec<u8>,
    ) -> Result<Option<CatalogUpdate>, CoreError> {
        Ok(self.inner.plan_update(&manifest_response)?.map(Into::into))
    }

    /// Install the catalog `update` names, downloaded to `file_path`, and
    /// record its id once it has replaced the catalog. On any error before
    /// then the previous catalog and recorded id are unchanged. The work runs
    /// on its own thread; the call resolves when it is done.
    pub async fn install_update(
        &self,
        update: CatalogUpdate,
        file_path: String,
        progress: Arc<dyn ProgressSink>,
        cancel: Arc<CancelToken>,
    ) -> Result<(), CoreError> {
        let inner = self.inner.clone();
        run_on_thread(move || {
            Ok(inner.install_update(
                &update.into(),
                file_path,
                &Progress(progress),
                &cancel.inner,
            )?)
        })
        .await
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

    /// What's New: the publications in `meps_language` released most
    /// recently, newest first, at most `limit`, each with its release day
    /// (`YYYY-MM-DD`, UTC).
    pub fn whats_new(
        &self,
        meps_language: u32,
        limit: u32,
    ) -> Result<Vec<NewPublication>, CoreError> {
        Ok(self
            .inner
            .whats_new(meps_language, limit)?
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
    /// The work runs on its own thread; the call resolves when it is done.
    pub async fn install(
        &self,
        pub_key: String,
        file_path: String,
        progress: Arc<dyn ProgressSink>,
        cancel: Arc<CancelToken>,
    ) -> Result<(), CoreError> {
        let inner = self.inner.clone();
        run_on_thread(move || {
            Ok(inner.install(&pub_key, file_path, &Progress(progress), &cancel.inner)?)
        })
        .await
    }

    /// Install a `.jwpub` the user opened from their device, as the
    /// publication the file itself says it is, without holding it to the
    /// catalog's size and checksum (its own manifest hash is still checked).
    /// When that publication is already installed and `replace` is false,
    /// nothing changes and the result is `AlreadyInstalled`, so the app can
    /// ask before replacing it. Not an intact JWPUB => `Corrupt`. The work
    /// runs on its own thread; the call resolves when it is done.
    pub async fn side_load(
        &self,
        file_path: String,
        replace: bool,
        progress: Arc<dyn ProgressSink>,
        cancel: Arc<CancelToken>,
    ) -> Result<SideLoad, CoreError> {
        let inner = self.inner.clone();
        run_on_thread(move || {
            Ok(inner
                .side_load(file_path, replace, &Progress(progress), &cancel.inner)?
                .into())
        })
        .await
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

    /// The publications whose title, issue title or symbol matches `query`:
    /// every installed match (any language), then at most `limit` catalog
    /// matches in `meps_language` (every language when `None`) that are not
    /// installed, each group best match first.
    pub fn find_titles(
        &self,
        query: String,
        meps_language: Option<u32>,
        limit: u32,
    ) -> Result<Vec<TitleMatch>, CoreError> {
        Ok(self
            .inner
            .find_titles(&query, meps_language, limit)?
            .into_iter()
            .map(Into::into)
            .collect())
    }

    /// The keys of installed publications the catalog has a newer version
    /// of, ordered by key. Never fails: any catalog or library error gives
    /// an empty list, and a key that cannot be compared is left out.
    pub fn updates_available(&self) -> Vec<String> {
        self.inner.updates_available()
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

/// The FFI mirror of [`berean_core::reader::TocEntry`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct TocEntry {
    pub title: String,
    pub doc_id: Option<i64>,
    pub depth: u32,
}

impl From<berean_core::reader::TocEntry> for TocEntry {
    fn from(e: berean_core::reader::TocEntry) -> Self {
        TocEntry {
            title: e.title,
            doc_id: e.doc_id,
            depth: e.depth,
        }
    }
}

/// The FFI mirror of [`berean_core::reader::ParagraphAnchor`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct ParagraphAnchor {
    pub paragraph: u32,
    pub label: Option<String>,
    pub begin: Option<u32>,
    pub end: Option<u32>,
    /// The paragraph's plain text, what `ReaderState.char_offset` counts in
    /// UTF-16 code units; see the core type.
    pub text: String,
}

impl From<berean_core::reader::ParagraphAnchor> for ParagraphAnchor {
    fn from(p: berean_core::reader::ParagraphAnchor) -> Self {
        ParagraphAnchor {
            paragraph: p.paragraph,
            label: p.label,
            begin: p.begin,
            end: p.end,
            text: p.text,
        }
    }
}

/// The FFI mirror of [`berean_core::reader::Document`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Document {
    pub doc_id: i64,
    pub title: String,
    pub html: String,
    pub paragraphs: Vec<ParagraphAnchor>,
    pub blocks: Vec<DocBlock>,
}

impl From<berean_core::reader::Document> for Document {
    fn from(d: berean_core::reader::Document) -> Self {
        Document {
            doc_id: d.doc_id,
            title: d.title,
            html: d.html,
            paragraphs: d.paragraphs.into_iter().map(Into::into).collect(),
            blocks: mirror(d.blocks),
        }
    }
}

/// The FFI mirror of [`berean_core::doc_blocks::DocBlock`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum DocBlock {
    Heading {
        level: u8,
        paragraph: Option<u32>,
        inlines: Vec<DocInline>,
    },
    Paragraph {
        paragraph: u32,
        number: Option<String>,
        role: ParagraphRole,
        inlines: Vec<DocInline>,
    },
    Question {
        paragraph: u32,
        number: String,
        for_paragraphs: Vec<u32>,
        inlines: Vec<DocInline>,
    },
    AnswerField {
        paragraph: u32,
        tag: String,
    },
    Figure {
        image: DocImage,
        caption: Vec<DocBlock>,
    },
    Aside {
        title: Option<DocTitle>,
        blocks: Vec<DocBlock>,
    },
    List {
        ordered: bool,
        items: Vec<DocListItem>,
    },
    Table {
        rows: Vec<DocTableRow>,
    },
    Footnotes {
        items: Vec<DocFootnote>,
    },
    Rule,
}

impl From<berean_core::doc_blocks::DocBlock> for DocBlock {
    fn from(b: berean_core::doc_blocks::DocBlock) -> Self {
        use berean_core::doc_blocks::DocBlock as B;
        match b {
            B::Heading {
                level,
                paragraph,
                inlines,
            } => DocBlock::Heading {
                level,
                paragraph,
                inlines: mirror(inlines),
            },
            B::Paragraph {
                paragraph,
                number,
                role,
                inlines,
            } => DocBlock::Paragraph {
                paragraph,
                number,
                role: role.into(),
                inlines: mirror(inlines),
            },
            B::Question {
                paragraph,
                number,
                for_paragraphs,
                inlines,
            } => DocBlock::Question {
                paragraph,
                number,
                for_paragraphs,
                inlines: mirror(inlines),
            },
            B::AnswerField { paragraph, tag } => DocBlock::AnswerField { paragraph, tag },
            B::Figure { image, caption } => DocBlock::Figure {
                image: image.into(),
                caption: mirror(caption),
            },
            B::Aside { title, blocks } => DocBlock::Aside {
                title: title.map(Into::into),
                blocks: mirror(blocks),
            },
            B::List { ordered, items } => DocBlock::List {
                ordered,
                items: mirror(items),
            },
            B::Table { rows } => DocBlock::Table { rows: mirror(rows) },
            B::Footnotes { items } => DocBlock::Footnotes {
                items: mirror(items),
            },
            B::Rule => DocBlock::Rule,
        }
    }
}

/// The FFI mirror of [`berean_core::doc_blocks::DocTitle`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct DocTitle {
    pub paragraph: u32,
    pub inlines: Vec<DocInline>,
}

impl From<berean_core::doc_blocks::DocTitle> for DocTitle {
    fn from(t: berean_core::doc_blocks::DocTitle) -> Self {
        DocTitle {
            paragraph: t.paragraph,
            inlines: mirror(t.inlines),
        }
    }
}

/// The FFI mirror of [`berean_core::doc_blocks::DocImage`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct DocImage {
    pub file: String,
    pub path: String,
    pub alt: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

impl From<berean_core::doc_blocks::DocImage> for DocImage {
    fn from(i: berean_core::doc_blocks::DocImage) -> Self {
        DocImage {
            file: i.file,
            path: i.path,
            alt: i.alt,
            width: i.width,
            height: i.height,
        }
    }
}

/// The FFI mirror of [`berean_core::doc_blocks::DocListItem`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct DocListItem {
    pub blocks: Vec<DocBlock>,
}

impl From<berean_core::doc_blocks::DocListItem> for DocListItem {
    fn from(i: berean_core::doc_blocks::DocListItem) -> Self {
        DocListItem {
            blocks: mirror(i.blocks),
        }
    }
}

/// The FFI mirror of [`berean_core::doc_blocks::DocTableRow`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct DocTableRow {
    pub cells: Vec<DocTableCell>,
}

impl From<berean_core::doc_blocks::DocTableRow> for DocTableRow {
    fn from(r: berean_core::doc_blocks::DocTableRow) -> Self {
        DocTableRow {
            cells: mirror(r.cells),
        }
    }
}

/// The FFI mirror of [`berean_core::doc_blocks::DocTableCell`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct DocTableCell {
    pub header: bool,
    pub colspan: u32,
    pub blocks: Vec<DocBlock>,
}

impl From<berean_core::doc_blocks::DocTableCell> for DocTableCell {
    fn from(c: berean_core::doc_blocks::DocTableCell) -> Self {
        DocTableCell {
            header: c.header,
            colspan: c.colspan,
            blocks: mirror(c.blocks),
        }
    }
}

/// The FFI mirror of [`berean_core::doc_blocks::DocFootnote`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct DocFootnote {
    pub id: u32,
    pub marker: String,
    pub paragraph: Option<u32>,
    pub inlines: Vec<DocInline>,
}

impl From<berean_core::doc_blocks::DocFootnote> for DocFootnote {
    fn from(f: berean_core::doc_blocks::DocFootnote) -> Self {
        DocFootnote {
            id: f.id,
            marker: f.marker,
            paragraph: f.paragraph,
            inlines: mirror(f.inlines),
        }
    }
}

/// The FFI mirror of [`berean_core::doc_blocks::ParagraphRole`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum ParagraphRole {
    Body,
    Title,
    Summary,
    ContextTitle,
    ThemeScripture,
    PublicationReference,
    Byline,
    TocEntry,
}

impl From<berean_core::doc_blocks::ParagraphRole> for ParagraphRole {
    fn from(r: berean_core::doc_blocks::ParagraphRole) -> Self {
        use berean_core::doc_blocks::ParagraphRole as R;
        match r {
            R::Body => ParagraphRole::Body,
            R::Title => ParagraphRole::Title,
            R::Summary => ParagraphRole::Summary,
            R::ContextTitle => ParagraphRole::ContextTitle,
            R::ThemeScripture => ParagraphRole::ThemeScripture,
            R::PublicationReference => ParagraphRole::PublicationReference,
            R::Byline => ParagraphRole::Byline,
            R::TocEntry => ParagraphRole::TocEntry,
        }
    }
}

/// The FFI mirror of [`berean_core::doc_blocks::DocInline`]. `Common` holds
/// the shared [`Inline`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum DocInline {
    Common {
        inline: Inline,
    },
    Superscript {
        children: Vec<DocInline>,
    },
    Subscript {
        children: Vec<DocInline>,
    },
    SmallCaps {
        children: Vec<DocInline>,
    },
    Link {
        children: Vec<DocInline>,
        url: String,
        target: DocLinkTarget,
    },
    FootnoteRef {
        id: u32,
        marker: String,
    },
    PageMarker {
        page: String,
    },
}

impl From<berean_core::doc_blocks::DocInline> for DocInline {
    fn from(i: berean_core::doc_blocks::DocInline) -> Self {
        use berean_core::doc_blocks::DocInline as I;
        match i {
            I::Common { inline } => DocInline::Common {
                inline: inline.into(),
            },
            I::Superscript { children } => DocInline::Superscript {
                children: mirror(children),
            },
            I::Subscript { children } => DocInline::Subscript {
                children: mirror(children),
            },
            I::SmallCaps { children } => DocInline::SmallCaps {
                children: mirror(children),
            },
            I::Link {
                children,
                url,
                target,
            } => DocInline::Link {
                children: mirror(children),
                url,
                target: target.into(),
            },
            I::FootnoteRef { id, marker } => DocInline::FootnoteRef { id, marker },
            I::PageMarker { page } => DocInline::PageMarker { page },
        }
    }
}

/// The FFI mirror of [`berean_core::doc_blocks::DocLinkTarget`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum DocLinkTarget {
    Bible {
        symbol: String,
        start: DocVerse,
        end: DocVerse,
    },
    Document {
        language: String,
        doc_id: i64,
        first: Option<u32>,
        last: Option<u32>,
    },
    StudyNote {
        language: String,
        doc_id: i64,
        chapter: u32,
        verse: u32,
    },
    External {
        url: String,
    },
    Invalid,
}

impl From<berean_core::doc_blocks::DocLinkTarget> for DocLinkTarget {
    fn from(t: berean_core::doc_blocks::DocLinkTarget) -> Self {
        use berean_core::doc_blocks::DocLinkTarget as T;
        match t {
            T::Bible { symbol, start, end } => DocLinkTarget::Bible {
                symbol,
                start: start.into(),
                end: end.into(),
            },
            T::Document {
                language,
                doc_id,
                first,
                last,
            } => DocLinkTarget::Document {
                language,
                doc_id,
                first,
                last,
            },
            T::StudyNote {
                language,
                doc_id,
                chapter,
                verse,
            } => DocLinkTarget::StudyNote {
                language,
                doc_id,
                chapter,
                verse,
            },
            T::External { url } => DocLinkTarget::External { url },
            T::Invalid => DocLinkTarget::Invalid,
        }
    }
}

/// The FFI mirror of [`berean_core::doc_blocks::DocVerse`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct DocVerse {
    pub book: u32,
    pub chapter: u32,
    pub verse: u32,
}

impl From<berean_core::doc_blocks::DocVerse> for DocVerse {
    fn from(v: berean_core::doc_blocks::DocVerse) -> Self {
        DocVerse {
            book: v.book,
            chapter: v.chapter,
            verse: v.verse,
        }
    }
}

/// The FFI mirror of [`berean_core::reader::VerseAnchor`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct VerseAnchor {
    pub verse: u32,
    pub label: String,
    pub text: String,
    pub begin: u32,
    pub end: u32,
}

impl From<berean_core::reader::VerseAnchor> for VerseAnchor {
    fn from(v: berean_core::reader::VerseAnchor) -> Self {
        VerseAnchor {
            verse: v.verse,
            label: v.label,
            text: v.text,
            begin: v.begin,
            end: v.end,
        }
    }
}

/// The FFI mirror of [`berean_core::reader::BibleChapter`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct BibleChapter {
    pub pub_key: String,
    pub book: u32,
    pub chapter: u32,
    pub html: String,
    pub verses: Vec<VerseAnchor>,
    pub blocks: Vec<ChapterBlock>,
}

impl From<berean_core::reader::BibleChapter> for BibleChapter {
    fn from(c: berean_core::reader::BibleChapter) -> Self {
        BibleChapter {
            pub_key: c.pub_key,
            book: c.book,
            chapter: c.chapter,
            html: c.html,
            verses: c.verses.into_iter().map(Into::into).collect(),
            blocks: c.blocks.into_iter().map(Into::into).collect(),
        }
    }
}

/// The FFI mirror of [`berean_core::reader::ChapterBlock`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum ChapterBlock {
    Heading {
        text: String,
    },
    Paragraph {
        paragraph: u32,
        style: ParagraphStyle,
        runs: Vec<VerseRun>,
    },
}

impl From<berean_core::reader::ChapterBlock> for ChapterBlock {
    fn from(b: berean_core::reader::ChapterBlock) -> Self {
        use berean_core::reader::ChapterBlock as B;
        match b {
            B::Heading { text } => ChapterBlock::Heading { text },
            B::Paragraph {
                paragraph,
                style,
                runs,
            } => ChapterBlock::Paragraph {
                paragraph,
                style: style.into(),
                runs: mirror(runs),
            },
        }
    }
}

/// The FFI mirror of [`berean_core::reader::ParagraphStyle`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum ParagraphStyle {
    Prose,
    PoetryLine,
    PoetryContinuation,
    Superscription,
    Note,
}

impl From<berean_core::reader::ParagraphStyle> for ParagraphStyle {
    fn from(s: berean_core::reader::ParagraphStyle) -> Self {
        use berean_core::reader::ParagraphStyle as S;
        match s {
            S::Prose => ParagraphStyle::Prose,
            S::PoetryLine => ParagraphStyle::PoetryLine,
            S::PoetryContinuation => ParagraphStyle::PoetryContinuation,
            S::Superscription => ParagraphStyle::Superscription,
            S::Note => ParagraphStyle::Note,
        }
    }
}

/// The FFI mirror of [`berean_core::reader::VerseRun`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct VerseRun {
    pub verse: u32,
    pub label: Option<String>,
    pub text: String,
    pub footnotes: Vec<String>,
    pub cross_refs: Vec<String>,
}

impl From<berean_core::reader::VerseRun> for VerseRun {
    fn from(r: berean_core::reader::VerseRun) -> Self {
        VerseRun {
            verse: r.verse,
            label: r.label,
            text: r.text,
            footnotes: r.footnotes,
            cross_refs: r.cross_refs,
        }
    }
}

/// The FFI mirror of [`berean_core::reader::BibleBook`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct BibleBook {
    pub book: u32,
    pub name: String,
    pub long_title: String,
    pub chapter_name: Option<String>,
    pub chapter_count: u32,
}

impl From<berean_core::reader::BibleBook> for BibleBook {
    fn from(b: berean_core::reader::BibleBook) -> Self {
        BibleBook {
            book: b.book,
            name: b.name,
            long_title: b.long_title,
            chapter_name: b.chapter_name,
            chapter_count: b.chapter_count,
        }
    }
}

/// The FFI mirror of [`berean_core::reader::Location`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Location {
    pub pub_key: String,
    pub doc_id: Option<i64>,
    pub book: Option<u32>,
    pub chapter: Option<u32>,
    pub verse: Option<u32>,
    pub paragraph: Option<u32>,
}

impl From<Location> for berean_core::reader::Location {
    fn from(l: Location) -> Self {
        berean_core::reader::Location {
            pub_key: l.pub_key,
            doc_id: l.doc_id,
            book: l.book,
            chapter: l.chapter,
            verse: l.verse,
            paragraph: l.paragraph,
        }
    }
}

impl From<berean_core::reader::Location> for Location {
    fn from(l: berean_core::reader::Location) -> Self {
        Location {
            pub_key: l.pub_key,
            doc_id: l.doc_id,
            book: l.book,
            chapter: l.chapter,
            verse: l.verse,
            paragraph: l.paragraph,
        }
    }
}

/// The FFI mirror of [`berean_core::reader::Located`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Located {
    pub location: Location,
    /// False when `location` is a fallback for a place that is gone.
    pub exact: bool,
}

impl From<berean_core::reader::Located> for Located {
    fn from(l: berean_core::reader::Located) -> Self {
        Located {
            location: l.location.into(),
            exact: l.exact,
        }
    }
}

/// The FFI mirror of [`berean_core::meetings::DailyText`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct DailyText {
    pub pub_key: String,
    pub doc_id: i64,
    pub day: i32,
    pub first_paragraph: u32,
    pub last_paragraph: u32,
    pub blocks: Vec<DocBlock>,
}

impl From<berean_core::meetings::DailyText> for DailyText {
    fn from(t: berean_core::meetings::DailyText) -> Self {
        DailyText {
            pub_key: t.pub_key,
            doc_id: t.doc_id,
            day: t.day,
            first_paragraph: t.first_paragraph,
            last_paragraph: t.last_paragraph,
            blocks: mirror(t.blocks),
        }
    }
}

/// The FFI mirror of [`berean_core::meetings::DailyTextDay`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum DailyTextDay {
    Ready { text: DailyText },
    NotInstalled { publication: PublicationSummary },
    Unavailable,
}

impl From<berean_core::meetings::DailyTextDay> for DailyTextDay {
    fn from(d: berean_core::meetings::DailyTextDay) -> Self {
        use berean_core::meetings::DailyTextDay as D;
        match d {
            D::Ready { text } => DailyTextDay::Ready { text: text.into() },
            D::NotInstalled { publication } => DailyTextDay::NotInstalled {
                publication: publication.into(),
            },
            D::Unavailable => DailyTextDay::Unavailable,
        }
    }
}

/// The FFI mirror of [`berean_core::translations::DocumentLanguage`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct DocumentLanguage {
    pub language: Language,
    pub publication: PublicationSummary,
    pub installed: bool,
}

impl From<berean_core::translations::DocumentLanguage> for DocumentLanguage {
    fn from(d: berean_core::translations::DocumentLanguage) -> Self {
        DocumentLanguage {
            language: d.language.into(),
            publication: d.publication.into(),
            installed: d.installed,
        }
    }
}

/// The FFI mirror of [`berean_core::meetings::MeetingWeek`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct MeetingWeek {
    pub first_day: i32,
    pub last_day: i32,
    pub midweek: MeetingPart,
    pub weekend: MeetingPart,
}

impl From<berean_core::meetings::MeetingWeek> for MeetingWeek {
    fn from(w: berean_core::meetings::MeetingWeek) -> Self {
        MeetingWeek {
            first_day: w.first_day,
            last_day: w.last_day,
            midweek: w.midweek.into(),
            weekend: w.weekend.into(),
        }
    }
}

/// The FFI mirror of [`berean_core::meetings::MeetingPart`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum MeetingPart {
    Ready {
        publication: PublicationSummary,
        doc_id: i64,
        title: String,
    },
    NotInstalled {
        publication: PublicationSummary,
    },
    Unavailable,
}

impl From<berean_core::meetings::MeetingPart> for MeetingPart {
    fn from(p: berean_core::meetings::MeetingPart) -> Self {
        use berean_core::meetings::MeetingPart as P;
        match p {
            P::Ready {
                publication,
                doc_id,
                title,
            } => MeetingPart::Ready {
                publication: publication.into(),
                doc_id,
                title,
            },
            P::NotInstalled { publication } => MeetingPart::NotInstalled {
                publication: publication.into(),
            },
            P::Unavailable => MeetingPart::Unavailable,
        }
    }
}

/// The FFI mirror of [`berean_core::reader::LocationSpan`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct LocationSpan {
    pub start: Location,
    pub end: Location,
}

impl From<LocationSpan> for berean_core::reader::LocationSpan {
    fn from(s: LocationSpan) -> Self {
        berean_core::reader::LocationSpan {
            start: s.start.into(),
            end: s.end.into(),
        }
    }
}

impl From<berean_core::reader::LocationSpan> for LocationSpan {
    fn from(s: berean_core::reader::LocationSpan) -> Self {
        LocationSpan {
            start: s.start.into(),
            end: s.end.into(),
        }
    }
}

/// The FFI mirror of [`berean_core::reader::Resolved`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum Resolved {
    Span { span: LocationSpan },
    External { url: String },
}

impl From<berean_core::reader::Resolved> for Resolved {
    fn from(r: berean_core::reader::Resolved) -> Self {
        use berean_core::reader::Resolved as R;
        match r {
            R::Span { span } => Resolved::Span { span: span.into() },
            R::External { url } => Resolved::External { url },
        }
    }
}

/// The FFI mirror of [`berean_core::reader::StudyAvailability`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum StudyAvailability {
    Installed,
    NotInstalled { pub_key: String },
    Unavailable,
}

impl From<berean_core::reader::StudyAvailability> for StudyAvailability {
    fn from(a: berean_core::reader::StudyAvailability) -> Self {
        use berean_core::reader::StudyAvailability as A;
        match a {
            A::Installed => StudyAvailability::Installed,
            A::NotInstalled { pub_key } => StudyAvailability::NotInstalled { pub_key },
            A::Unavailable => StudyAvailability::Unavailable,
        }
    }
}

/// The FFI mirror of [`berean_core::reader::StudyReference`], without its
/// HTML.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct StudyReference {
    pub label: String,
    pub source: String,
    pub target: Option<Location>,
}

impl From<berean_core::reader::StudyReference> for StudyReference {
    fn from(r: berean_core::reader::StudyReference) -> Self {
        StudyReference {
            label: r.label,
            source: r.source,
            target: r.target.map(Into::into),
        }
    }
}

/// The FFI mirror of [`berean_core::reader::StudyReferences`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct StudyReferences {
    pub availability: StudyAvailability,
    pub items: Vec<StudyReference>,
}

impl From<berean_core::reader::StudyReferences> for StudyReferences {
    fn from(r: berean_core::reader::StudyReferences) -> Self {
        StudyReferences {
            availability: r.availability.into(),
            items: mirror(r.items),
        }
    }
}

/// The FFI mirror of [`berean_core::reader::StudyNote`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct StudyNote {
    pub label: String,
    pub text: String,
}

impl From<berean_core::reader::StudyNote> for StudyNote {
    fn from(n: berean_core::reader::StudyNote) -> Self {
        StudyNote {
            label: n.label,
            text: n.text,
        }
    }
}

/// The FFI mirror of [`berean_core::reader::CrossRef`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct CrossRef {
    pub label: String,
    pub target: LocationSpan,
    pub snippet: Option<String>,
}

impl From<berean_core::reader::CrossRef> for CrossRef {
    fn from(c: berean_core::reader::CrossRef) -> Self {
        CrossRef {
            label: c.label,
            target: c.target.into(),
            snippet: c.snippet,
        }
    }
}

/// The FFI mirror of [`berean_core::reader::Footnote`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Footnote {
    pub marker: String,
    pub text: String,
}

impl From<berean_core::reader::Footnote> for Footnote {
    fn from(f: berean_core::reader::Footnote) -> Self {
        Footnote {
            marker: f.marker,
            text: f.text,
        }
    }
}

/// The FFI mirror of [`berean_core::reader::VerseStudy`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct VerseStudy {
    pub study_notes: Vec<StudyNote>,
    pub cross_refs: Vec<CrossRef>,
    pub footnotes: Vec<Footnote>,
    pub availability: StudyAvailability,
}

impl From<berean_core::reader::VerseStudy> for VerseStudy {
    fn from(s: berean_core::reader::VerseStudy) -> Self {
        VerseStudy {
            study_notes: mirror(s.study_notes),
            cross_refs: mirror(s.cross_refs),
            footnotes: mirror(s.footnotes),
            availability: s.availability.into(),
        }
    }
}

/// The FFI mirror of [`berean_core::reader::VerseStudyCounts`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct VerseStudyCounts {
    pub verse: u32,
    pub study_notes: u32,
    pub cross_refs: u32,
    pub footnotes: u32,
}

impl From<berean_core::reader::VerseStudyCounts> for VerseStudyCounts {
    fn from(c: berean_core::reader::VerseStudyCounts) -> Self {
        VerseStudyCounts {
            verse: c.verse,
            study_notes: c.study_notes,
            cross_refs: c.cross_refs,
            footnotes: c.footnotes,
        }
    }
}

/// The reader, exposed to callers as an object.
#[derive(uniffi::Object)]
pub struct Reader {
    inner: berean_core::reader::Reader,
}

#[uniffi::export]
impl Reader {
    /// The table of contents of an installed publication, in display order.
    pub fn toc(&self, pub_key: String) -> Result<Vec<TocEntry>, CoreError> {
        Ok(self
            .inner
            .toc(&pub_key)?
            .into_iter()
            .map(Into::into)
            .collect())
    }

    /// The document with MEPS id `doc_id` in the installed publication
    /// `pub_key`.
    pub fn document(&self, pub_key: String, doc_id: i64) -> Result<Document, CoreError> {
        Ok(self.inner.document(&pub_key, doc_id)?.into())
    }

    /// Where a saved location is in the installed publication now, falling
    /// back to the nearest place that exists; see the core's
    /// `Reader::locate`. `today` is the device's local calendar date as
    /// `YYYYMMDD` (e.g. 20261007), or `None`; a Meeting Workbook opened
    /// alone uses it to pick the week.
    pub fn locate(&self, location: Location, today: Option<i32>) -> Result<Located, CoreError> {
        Ok(self.inner.locate(&location.into(), today)?.into())
    }

    /// The daily text for `day` (the device's local calendar date as
    /// `YYYYMMDD`) in `meps_language`; see the core's `Reader::daily_text`.
    pub fn daily_text(&self, meps_language: u32, day: i32) -> Result<DailyTextDay, CoreError> {
        Ok(self.inner.daily_text(meps_language, day)?.into())
    }

    /// The meeting publications for the week (Monday to Sunday) holding
    /// `day`; see the core's `Reader::meeting_week`.
    pub fn meeting_week(&self, meps_language: u32, day: i32) -> Result<MeetingWeek, CoreError> {
        Ok(self.inner.meeting_week(meps_language, day)?.into())
    }

    /// The languages the document `doc_id` of the installed publication
    /// `pub_key` can be read in, its own included, by language name; see the
    /// core's `Reader::document_languages`.
    pub fn document_languages(
        &self,
        pub_key: String,
        doc_id: i64,
    ) -> Result<Vec<DocumentLanguage>, CoreError> {
        Ok(mirror(self.inner.document_languages(&pub_key, doc_id)?))
    }

    /// Chapter `chapter` of book `book` (1-66) of the installed Bible `bible`.
    pub fn bible_chapter(
        &self,
        bible: String,
        book: u32,
        chapter: u32,
    ) -> Result<BibleChapter, CoreError> {
        Ok(self.inner.bible_chapter(&bible, book, chapter)?.into())
    }

    /// The books of the installed Bible `bible`, by book number, with their
    /// names and chapter counts; books it has no chapters of are not listed.
    pub fn bible_books(&self, bible: String) -> Result<Vec<BibleBook>, CoreError> {
        Ok(self
            .inner
            .bible_books(&bible)?
            .into_iter()
            .map(Into::into)
            .collect())
    }

    /// Resolve a citation or `jwpub://` link to the span it names, or an
    /// `http://`, `https://` or `mailto:` link to `External`, for the app to
    /// hand to the system.
    pub fn resolve(&self, reference: String) -> Result<Resolved, CoreError> {
        Ok(self.inner.resolve(&reference)?.into())
    }

    /// The footnotes, cross references and (from the NWT Study Edition)
    /// study notes of the Bible verse at `location`.
    pub fn verse_study(&self, location: Location) -> Result<VerseStudy, CoreError> {
        Ok(self.inner.verse_study(&location.into())?.into())
    }

    /// What the Research Guide in the Bible's language cites for the Bible
    /// verse at `location`, newest first.
    pub fn study_references(&self, location: Location) -> Result<StudyReferences, CoreError> {
        Ok(self.inner.study_references(&location.into())?.into())
    }

    /// For each verse of a chapter of the installed Bible `bible` with any
    /// study content, how much `verse_study` gives for it.
    pub fn chapter_study_markers(
        &self,
        bible: String,
        book: u32,
        chapter: u32,
    ) -> Result<Vec<VerseStudyCounts>, CoreError> {
        Ok(mirror(
            self.inner.chapter_study_markers(&bible, book, chapter)?,
        ))
    }
}

/// The FFI mirror of [`berean_core::search::SearchScope`].
#[derive(Debug, Clone, Default, PartialEq, Eq, uniffi::Record)]
pub struct SearchScope {
    pub pub_keys: Vec<String>,
    pub kinds: Vec<PubKind>,
    pub languages: Vec<u32>,
    pub offset: u32,
}

impl From<SearchScope> for berean_core::search::SearchScope {
    fn from(s: SearchScope) -> Self {
        berean_core::search::SearchScope {
            pub_keys: s.pub_keys,
            kinds: s.kinds.into_iter().map(Into::into).collect(),
            languages: s.languages,
            offset: s.offset,
        }
    }
}

/// The FFI mirror of [`berean_core::search::Hit`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Hit {
    pub location: Location,
    pub title: String,
    pub snippet: String,
}

impl From<berean_core::search::Hit> for Hit {
    fn from(h: berean_core::search::Hit) -> Self {
        Hit {
            location: h.location.into(),
            title: h.title,
            snippet: h.snippet,
        }
    }
}

/// The FFI mirror of [`berean_core::search::Suggestions`].
#[derive(Debug, Clone, Default, PartialEq, Eq, uniffi::Record)]
pub struct Suggestions {
    /// Topic articles (Insight) whose title starts with the text, best first.
    pub topics: Vec<TopicSuggestion>,
    /// The text with its last word completed, most common first.
    pub queries: Vec<String>,
}

impl From<berean_core::search::Suggestions> for Suggestions {
    fn from(s: berean_core::search::Suggestions) -> Self {
        Suggestions {
            topics: mirror(s.topics),
            queries: s.queries,
        }
    }
}

/// The FFI mirror of [`berean_core::search::TopicSuggestion`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct TopicSuggestion {
    pub title: String,
    /// The article: `pub_key` and `doc_id`.
    pub location: Location,
}

impl From<berean_core::search::TopicSuggestion> for TopicSuggestion {
    fn from(t: berean_core::search::TopicSuggestion) -> Self {
        TopicSuggestion {
            title: t.title,
            location: t.location.into(),
        }
    }
}

/// Full-text search, exposed to callers as an object.
#[derive(uniffi::Object)]
pub struct Search {
    inner: berean_core::search::Search,
}

#[uniffi::export]
impl Search {
    /// Up to `limit` (at most 500, [`berean_core::search::MAX_LIMIT`]) hits
    /// for `text` in the publications `scope` selects, best first, after
    /// skipping `scope.offset`. Empty text, a `limit` of 0, or a malformed
    /// key in the scope => `Invalid`.
    /// Index publications (e.g. the Research Guide) have no rows;
    /// pronunciation marks (`Abʹsa·lom`) are ignored.
    /// The work runs on its own thread; the call resolves when it is done.
    /// Callers should debounce typing and drop stale results.
    pub async fn query(
        &self,
        text: String,
        scope: SearchScope,
        limit: u32,
    ) -> Result<Vec<Hit>, CoreError> {
        let inner = self.inner.clone();
        run_on_thread(move || {
            Ok(inner
                .query(&text, &scope.into(), limit)?
                .into_iter()
                .map(Into::into)
                .collect())
        })
        .await
    }

    /// Suggestions for `text` as it is typed, from the publications `scope`
    /// selects (its offset is ignored): up to `limit` (at most 20,
    /// [`berean_core::search::MAX_SUGGESTIONS`]) of each kind. Queries are
    /// the text with its last word completed, most common first (with other
    /// words, only completions that find something); topics are Insight
    /// articles whose title starts with the text. Text with nothing to
    /// complete (empty, or ending in a space) gives none; a `limit` of 0 or
    /// a malformed key in the scope => `Invalid`.
    /// The work runs on its own thread; the call resolves when it is done.
    /// Callers should debounce typing and drop stale results.
    pub async fn suggest(
        &self,
        text: String,
        scope: SearchScope,
        limit: u32,
    ) -> Result<Suggestions, CoreError> {
        let inner = self.inner.clone();
        run_on_thread(move || Ok(inner.suggest(&text, &scope.into(), limit)?.into())).await
    }

    /// Rebuild every installed publication's index rows from its files. On
    /// any error the index is unchanged. The work runs on its own thread;
    /// the call resolves when it is done. Progress is never reported while a
    /// core lock is held, so `progress` may call back into the core.
    pub async fn rebuild_index(
        &self,
        progress: Arc<dyn ProgressSink>,
        cancel: Arc<CancelToken>,
    ) -> Result<(), CoreError> {
        let inner = self.inner.clone();
        run_on_thread(move || Ok(inner.rebuild_index(&Progress(progress), &cancel.inner)?)).await
    }
}

/// The FFI mirror of [`berean_core::userdata::HighlightColor`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum HighlightColor {
    Yellow,
    Green,
    Blue,
    Pink,
    Orange,
    Purple,
}

impl From<berean_core::userdata::HighlightColor> for HighlightColor {
    fn from(c: berean_core::userdata::HighlightColor) -> Self {
        use berean_core::userdata::HighlightColor as C;
        match c {
            C::Yellow => HighlightColor::Yellow,
            C::Green => HighlightColor::Green,
            C::Blue => HighlightColor::Blue,
            C::Pink => HighlightColor::Pink,
            C::Orange => HighlightColor::Orange,
            C::Purple => HighlightColor::Purple,
        }
    }
}

impl From<HighlightColor> for berean_core::userdata::HighlightColor {
    fn from(c: HighlightColor) -> Self {
        use berean_core::userdata::HighlightColor as C;
        match c {
            HighlightColor::Yellow => C::Yellow,
            HighlightColor::Green => C::Green,
            HighlightColor::Blue => C::Blue,
            HighlightColor::Pink => C::Pink,
            HighlightColor::Orange => C::Orange,
            HighlightColor::Purple => C::Purple,
        }
    }
}

/// The FFI mirror of [`berean_core::userdata::TextRange`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct TextRange {
    pub span: LocationSpan,
    pub start_token: Option<u32>,
    pub end_token: Option<u32>,
}

impl From<TextRange> for berean_core::userdata::TextRange {
    fn from(r: TextRange) -> Self {
        berean_core::userdata::TextRange {
            span: r.span.into(),
            start_token: r.start_token,
            end_token: r.end_token,
        }
    }
}

impl From<berean_core::userdata::TextRange> for TextRange {
    fn from(r: berean_core::userdata::TextRange) -> Self {
        TextRange {
            span: r.span.into(),
            start_token: r.start_token,
            end_token: r.end_token,
        }
    }
}

/// The FFI mirror of [`berean_core::userdata::Highlight`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Highlight {
    pub id: String,
    pub range: TextRange,
    pub color: HighlightColor,
}

impl From<berean_core::userdata::Highlight> for Highlight {
    fn from(h: berean_core::userdata::Highlight) -> Self {
        Highlight {
            id: h.id,
            range: h.range.into(),
            color: h.color.into(),
        }
    }
}

/// The FFI mirror of [`berean_core::userdata::Note`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String,
    pub location: Option<Location>,
    pub highlight_id: Option<String>,
    pub tag_ids: Vec<i64>,
    pub created: String,
    pub modified: String,
    pub folder_id: Option<i64>,
}

impl From<berean_core::userdata::Note> for Note {
    fn from(n: berean_core::userdata::Note) -> Self {
        Note {
            id: n.id,
            title: n.title,
            content: n.content,
            location: n.location.map(Into::into),
            highlight_id: n.highlight_id,
            tag_ids: n.tag_ids,
            created: n.created,
            modified: n.modified,
            folder_id: n.folder_id,
        }
    }
}

/// The FFI mirror of [`berean_core::userdata::NoteFilter`].
#[derive(Debug, Clone, Default, PartialEq, Eq, uniffi::Record)]
pub struct NoteFilter {
    pub location: Option<Location>,
    pub tag_ids: Vec<i64>,
    pub folder: Option<FolderScope>,
}

impl From<NoteFilter> for berean_core::userdata::NoteFilter {
    fn from(f: NoteFilter) -> Self {
        berean_core::userdata::NoteFilter {
            location: f.location.map(Into::into),
            tag_ids: f.tag_ids,
            folder: f.folder.map(Into::into),
        }
    }
}

/// The FFI mirror of [`berean_core::userdata::FolderScope`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum FolderScope {
    Unfiled,
    Folder { id: i64, include_subfolders: bool },
}

impl From<FolderScope> for berean_core::userdata::FolderScope {
    fn from(s: FolderScope) -> Self {
        use berean_core::userdata::FolderScope as S;
        match s {
            FolderScope::Unfiled => S::Unfiled,
            FolderScope::Folder {
                id,
                include_subfolders,
            } => S::Folder {
                id,
                include_subfolders,
            },
        }
    }
}

/// The FFI mirror of [`berean_core::userdata::Folder`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Folder {
    pub id: i64,
    pub parent_id: Option<i64>,
    pub name: String,
    pub position: u32,
    pub depth: u32,
    pub note_count: u32,
    pub subfolder_count: u32,
}

impl From<berean_core::userdata::Folder> for Folder {
    fn from(f: berean_core::userdata::Folder) -> Self {
        Folder {
            id: f.id,
            parent_id: f.parent_id,
            name: f.name,
            position: f.position,
            depth: f.depth,
            note_count: f.note_count,
            subfolder_count: f.subfolder_count,
        }
    }
}

impl From<Folder> for berean_core::userdata::Folder {
    fn from(f: Folder) -> Self {
        berean_core::userdata::Folder {
            id: f.id,
            parent_id: f.parent_id,
            name: f.name,
            position: f.position,
            depth: f.depth,
            note_count: f.note_count,
            subfolder_count: f.subfolder_count,
        }
    }
}

/// The FFI mirror of [`berean_core::userdata::NoteFolder`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct NoteFolder {
    pub note_id: String,
    pub folder_id: i64,
}

impl From<berean_core::userdata::NoteFolder> for NoteFolder {
    fn from(n: berean_core::userdata::NoteFolder) -> Self {
        NoteFolder {
            note_id: n.note_id,
            folder_id: n.folder_id,
        }
    }
}

impl From<NoteFolder> for berean_core::userdata::NoteFolder {
    fn from(n: NoteFolder) -> Self {
        berean_core::userdata::NoteFolder {
            note_id: n.note_id,
            folder_id: n.folder_id,
        }
    }
}

/// The FFI mirror of [`berean_core::userdata::DeletedFolder`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct DeletedFolder {
    pub folders: Vec<Folder>,
    pub notes: Vec<NoteFolder>,
}

impl From<berean_core::userdata::DeletedFolder> for DeletedFolder {
    fn from(d: berean_core::userdata::DeletedFolder) -> Self {
        DeletedFolder {
            folders: mirror(d.folders),
            notes: mirror(d.notes),
        }
    }
}

impl From<DeletedFolder> for berean_core::userdata::DeletedFolder {
    fn from(d: DeletedFolder) -> Self {
        berean_core::userdata::DeletedFolder {
            folders: mirror(d.folders),
            notes: mirror(d.notes),
        }
    }
}

/// The FFI mirror of [`berean_core::userdata::Workspace`].
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct Workspace {
    pub id: i64,
    pub name: String,
    pub viewport: Option<Viewport>,
    pub item_count: u32,
}

impl From<berean_core::userdata::Workspace> for Workspace {
    fn from(w: berean_core::userdata::Workspace) -> Self {
        Workspace {
            id: w.id,
            name: w.name,
            viewport: w.viewport.map(Into::into),
            item_count: w.item_count,
        }
    }
}

/// The FFI mirror of [`berean_core::userdata::Viewport`]: `x`, `y` is the
/// canvas point at the centre of the view.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct Viewport {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

impl From<berean_core::userdata::Viewport> for Viewport {
    fn from(v: berean_core::userdata::Viewport) -> Self {
        Viewport {
            x: v.x,
            y: v.y,
            zoom: v.zoom,
        }
    }
}

impl From<Viewport> for berean_core::userdata::Viewport {
    fn from(v: Viewport) -> Self {
        berean_core::userdata::Viewport {
            x: v.x,
            y: v.y,
            zoom: v.zoom,
        }
    }
}

/// The FFI mirror of [`berean_core::userdata::Frame`]: `x`, `y` is the
/// card's top-left corner.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct Frame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl From<berean_core::userdata::Frame> for Frame {
    fn from(f: berean_core::userdata::Frame) -> Self {
        Frame {
            x: f.x,
            y: f.y,
            width: f.width,
            height: f.height,
        }
    }
}

impl From<Frame> for berean_core::userdata::Frame {
    fn from(f: Frame) -> Self {
        berean_core::userdata::Frame {
            x: f.x,
            y: f.y,
            width: f.width,
            height: f.height,
        }
    }
}

/// The FFI mirror of [`berean_core::userdata::CardRef`].
#[derive(Debug, Clone, PartialEq, uniffi::Enum)]
pub enum CardRef {
    Note { note_id: String },
    Passage { span: LocationSpan, missing: bool },
    Publication { location: Location, missing: bool },
}

impl From<berean_core::userdata::CardRef> for CardRef {
    fn from(c: berean_core::userdata::CardRef) -> Self {
        use berean_core::userdata::CardRef as C;
        match c {
            C::Note { note_id } => CardRef::Note { note_id },
            C::Passage { span, missing } => CardRef::Passage {
                span: span.into(),
                missing,
            },
            C::Publication { location, missing } => CardRef::Publication {
                location: location.into(),
                missing,
            },
        }
    }
}

impl From<CardRef> for berean_core::userdata::CardRef {
    fn from(c: CardRef) -> Self {
        use berean_core::userdata::CardRef as C;
        match c {
            CardRef::Note { note_id } => C::Note { note_id },
            CardRef::Passage { span, missing } => C::Passage {
                span: span.into(),
                missing,
            },
            CardRef::Publication { location, missing } => C::Publication {
                location: location.into(),
                missing,
            },
        }
    }
}

/// The FFI mirror of [`berean_core::userdata::ReaderState`]: `char_offset`
/// is in UTF-16 code units into the verse or paragraph's plain text.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct ReaderState {
    pub at: CardRef,
    pub char_offset: u32,
}

impl From<berean_core::userdata::ReaderState> for ReaderState {
    fn from(s: berean_core::userdata::ReaderState) -> Self {
        ReaderState {
            at: s.at.into(),
            char_offset: s.char_offset,
        }
    }
}

impl From<ReaderState> for berean_core::userdata::ReaderState {
    fn from(s: ReaderState) -> Self {
        berean_core::userdata::ReaderState {
            at: s.at.into(),
            char_offset: s.char_offset,
        }
    }
}

/// The FFI mirror of [`berean_core::userdata::CanvasItem`].
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct CanvasItem {
    pub id: i64,
    pub workspace_id: i64,
    pub card: CardRef,
    pub frame: Frame,
    pub z: i64,
    pub reader: Option<ReaderState>,
    /// When the card was added, read in or touched: ISO 8601 in UTC, like
    /// `Note.modified`.
    pub last_used_at: String,
}

impl From<berean_core::userdata::CanvasItem> for CanvasItem {
    fn from(i: berean_core::userdata::CanvasItem) -> Self {
        CanvasItem {
            id: i.id,
            workspace_id: i.workspace_id,
            card: i.card.into(),
            frame: i.frame.into(),
            z: i.z,
            reader: i.reader.map(Into::into),
            last_used_at: i.last_used_at,
        }
    }
}

/// The FFI mirror of [`berean_core::userdata::ItemFrame`].
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct ItemFrame {
    pub id: i64,
    pub frame: Frame,
}

impl From<ItemFrame> for berean_core::userdata::ItemFrame {
    fn from(f: ItemFrame) -> Self {
        berean_core::userdata::ItemFrame {
            id: f.id,
            frame: f.frame.into(),
        }
    }
}

/// The FFI mirror of [`berean_core::userdata::ItemOrder`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum ItemOrder {
    Z,
    Reading,
}

impl From<ItemOrder> for berean_core::userdata::ItemOrder {
    fn from(o: ItemOrder) -> Self {
        use berean_core::userdata::ItemOrder as O;
        match o {
            ItemOrder::Z => O::Z,
            ItemOrder::Reading => O::Reading,
        }
    }
}

/// The FFI mirror of [`berean_core::userdata::Tag`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Tag {
    pub id: i64,
    pub name: String,
}

impl From<berean_core::userdata::Tag> for Tag {
    fn from(t: berean_core::userdata::Tag) -> Self {
        Tag {
            id: t.id,
            name: t.name,
        }
    }
}

/// The FFI mirror of [`berean_core::userdata::Bookmark`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Bookmark {
    pub pub_key: String,
    pub slot: u8,
    pub location: Location,
    pub title: String,
    pub snippet: Option<String>,
}

impl From<berean_core::userdata::Bookmark> for Bookmark {
    fn from(b: berean_core::userdata::Bookmark) -> Self {
        Bookmark {
            pub_key: b.pub_key,
            slot: b.slot,
            location: b.location.into(),
            title: b.title,
            snippet: b.snippet,
        }
    }
}

/// The FFI mirror of [`berean_core::userdata::ImportSummary`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Record)]
pub struct ImportSummary {
    pub highlights: u64,
    pub notes: u64,
    pub tags: u64,
    pub bookmarks: u64,
    pub favorites: u64,
}

impl From<berean_core::userdata::ImportSummary> for ImportSummary {
    fn from(s: berean_core::userdata::ImportSummary) -> Self {
        ImportSummary {
            highlights: s.highlights,
            notes: s.notes,
            tags: s.tags,
            bookmarks: s.bookmarks,
            favorites: s.favorites,
        }
    }
}

/// The FFI mirror of [`berean_core::userdata::ImportPreview`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct ImportPreview {
    pub backup: ImportSummary,
    pub current: ImportSummary,
    pub folders: u32,
    pub filed_notes: u32,
    pub device_name: String,
    pub created: String,
}

impl From<berean_core::userdata::ImportPreview> for ImportPreview {
    fn from(p: berean_core::userdata::ImportPreview) -> Self {
        ImportPreview {
            backup: p.backup.into(),
            current: p.current.into(),
            folders: p.folders,
            filed_notes: p.filed_notes,
            device_name: p.device_name,
            created: p.created,
        }
    }
}

/// The `berean://bible/...` URL of `span`; `Invalid` if it isn't a Bible
/// passage within one book.
#[uniffi::export]
pub fn passage_url(span: LocationSpan) -> Result<String, CoreError> {
    Ok(berean_core::notes::passage_url(&span.into())?)
}

/// The `berean://pub/...` URL of `location`; `Invalid` if it isn't a
/// publication location.
#[uniffi::export]
pub fn publication_url(location: Location) -> Result<String, CoreError> {
    Ok(berean_core::notes::publication_url(&location.into())?)
}

/// The FFI mirror of [`berean_core::notes::SourceSpan`]: half-open, in
/// UTF-16 code units.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Record)]
pub struct SourceSpan {
    pub start: u32,
    pub end: u32,
    pub kind: SpanKind,
}

impl From<berean_core::notes::SourceSpan> for SourceSpan {
    fn from(s: berean_core::notes::SourceSpan) -> Self {
        SourceSpan {
            start: s.start,
            end: s.end,
            kind: s.kind.into(),
        }
    }
}

/// The FFI mirror of [`berean_core::notes::SpanKind`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum SpanKind {
    HeadingMarker,
    EmphasisMarker,
    StrongMarker,
    StrikeMarker,
    CodeMarker,
    Code,
    LinkBracket,
    LinkUrl,
    ListMarker,
    TaskMarker,
    QuoteMarker,
    Rule,
    Tag,
}

impl From<berean_core::notes::SpanKind> for SpanKind {
    fn from(k: berean_core::notes::SpanKind) -> Self {
        use berean_core::notes::SpanKind as K;
        match k {
            K::HeadingMarker => SpanKind::HeadingMarker,
            K::EmphasisMarker => SpanKind::EmphasisMarker,
            K::StrongMarker => SpanKind::StrongMarker,
            K::StrikeMarker => SpanKind::StrikeMarker,
            K::CodeMarker => SpanKind::CodeMarker,
            K::Code => SpanKind::Code,
            K::LinkBracket => SpanKind::LinkBracket,
            K::LinkUrl => SpanKind::LinkUrl,
            K::ListMarker => SpanKind::ListMarker,
            K::TaskMarker => SpanKind::TaskMarker,
            K::QuoteMarker => SpanKind::QuoteMarker,
            K::Rule => SpanKind::Rule,
            K::Tag => SpanKind::Tag,
        }
    }
}

/// The syntax ranges of a note's Markdown source, for the Write view: flat,
/// never overlapping, sorted by start, in UTF-16 code units. No database;
/// never fails.
#[uniffi::export]
pub fn markdown_spans(markdown: String) -> Vec<SourceSpan> {
    berean_core::notes::markdown_spans(&markdown)
        .into_iter()
        .map(Into::into)
        .collect()
}

/// The FFI mirror of [`berean_core::notes::Block`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum Block {
    Heading {
        level: u8,
        inlines: Vec<Inline>,
    },
    Paragraph {
        inlines: Vec<Inline>,
    },
    PassageCard {
        text: String,
        span: LocationSpan,
        missing: bool,
    },
    List {
        start: Option<u32>,
        items: Vec<ListItem>,
    },
    Quote {
        blocks: Vec<Block>,
    },
    CodeBlock {
        text: String,
    },
    Rule,
}

/// Convert each of `items`, for the tree's nested lists.
fn mirror<T, U: From<T>>(items: Vec<T>) -> Vec<U> {
    items.into_iter().map(Into::into).collect()
}

impl From<berean_core::notes::Block> for Block {
    fn from(b: berean_core::notes::Block) -> Self {
        use berean_core::notes::Block as B;
        match b {
            B::Heading { level, inlines } => Block::Heading {
                level,
                inlines: mirror(inlines),
            },
            B::Paragraph { inlines } => Block::Paragraph {
                inlines: mirror(inlines),
            },
            B::PassageCard {
                text,
                span,
                missing,
            } => Block::PassageCard {
                text,
                span: span.into(),
                missing,
            },
            B::List { start, items } => Block::List {
                start,
                items: mirror(items),
            },
            B::Quote { blocks } => Block::Quote {
                blocks: mirror(blocks),
            },
            B::CodeBlock { text } => Block::CodeBlock { text },
            B::Rule => Block::Rule,
        }
    }
}

/// The FFI mirror of [`berean_core::notes::ListItem`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct ListItem {
    pub task: Option<NoteTask>,
    pub blocks: Vec<Block>,
}

impl From<berean_core::notes::ListItem> for ListItem {
    fn from(i: berean_core::notes::ListItem) -> Self {
        ListItem {
            task: i.task.map(Into::into),
            blocks: mirror(i.blocks),
        }
    }
}

/// The FFI mirror of [`berean_core::notes::NoteTask`]. Not `Task`, which
/// would shadow Swift Concurrency's `Task` in the apps.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Record)]
pub struct NoteTask {
    pub index: u32,
    pub checked: bool,
}

impl From<berean_core::notes::NoteTask> for NoteTask {
    fn from(t: berean_core::notes::NoteTask) -> Self {
        NoteTask {
            index: t.index,
            checked: t.checked,
        }
    }
}

/// The FFI mirror of [`berean_core::notes::Inline`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum Inline {
    Text {
        text: String,
    },
    Emphasis {
        children: Vec<Inline>,
    },
    Strong {
        children: Vec<Inline>,
    },
    Strikethrough {
        children: Vec<Inline>,
    },
    Code {
        text: String,
    },
    Link {
        children: Vec<Inline>,
        url: String,
        target: LinkTarget,
    },
    Tag {
        name: String,
    },
    LineBreak,
}

impl From<berean_core::notes::Inline> for Inline {
    fn from(i: berean_core::notes::Inline) -> Self {
        use berean_core::notes::Inline as I;
        match i {
            I::Text { text } => Inline::Text { text },
            I::Emphasis { children } => Inline::Emphasis {
                children: mirror(children),
            },
            I::Strong { children } => Inline::Strong {
                children: mirror(children),
            },
            I::Strikethrough { children } => Inline::Strikethrough {
                children: mirror(children),
            },
            I::Code { text } => Inline::Code { text },
            I::Link {
                children,
                url,
                target,
            } => Inline::Link {
                children: mirror(children),
                url,
                target: target.into(),
            },
            I::Tag { name } => Inline::Tag { name },
            I::LineBreak => Inline::LineBreak,
        }
    }
}

/// The FFI mirror of [`berean_core::notes::LinkTarget`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum LinkTarget {
    Passage { span: LocationSpan, missing: bool },
    Publication { location: Location, missing: bool },
    External { url: String },
    Invalid,
}

impl From<berean_core::notes::LinkTarget> for LinkTarget {
    fn from(t: berean_core::notes::LinkTarget) -> Self {
        use berean_core::notes::LinkTarget as T;
        match t {
            T::Passage { span, missing } => LinkTarget::Passage {
                span: span.into(),
                missing,
            },
            T::Publication { location, missing } => LinkTarget::Publication {
                location: location.into(),
                missing,
            },
            T::External { url } => LinkTarget::External { url },
            T::Invalid => LinkTarget::Invalid,
        }
    }
}

/// The user's notes, highlights, tags, favorites and bookmarks, exposed to
/// callers as an object.
#[derive(uniffi::Object)]
pub struct UserData {
    inner: berean_core::userdata::UserData,
}

#[uniffi::export]
impl UserData {
    /// The highlights in a document or Bible chapter of `pub_key`.
    pub fn highlights(
        &self,
        pub_key: String,
        doc_or_chapter: Location,
    ) -> Result<Vec<Highlight>, CoreError> {
        Ok(self
            .inner
            .highlights(&pub_key, &doc_or_chapter.into())?
            .into_iter()
            .map(Into::into)
            .collect())
    }

    /// Highlight `range` in `color`.
    pub fn add_highlight(
        &self,
        range: TextRange,
        color: HighlightColor,
    ) -> Result<Highlight, CoreError> {
        Ok(self
            .inner
            .add_highlight(&range.into(), color.into())?
            .into())
    }

    /// Recolor the highlight `id`.
    pub fn set_highlight_color(&self, id: String, color: HighlightColor) -> Result<(), CoreError> {
        Ok(self.inner.set_highlight_color(&id, color.into())?)
    }

    /// Remove the highlight `id`; notes on it are kept, detached.
    pub fn remove_highlight(&self, id: String) -> Result<(), CoreError> {
        Ok(self.inner.remove_highlight(&id)?)
    }

    /// The notes `filter` selects, in the order they were made.
    pub fn notes(&self, filter: NoteFilter) -> Result<Vec<Note>, CoreError> {
        Ok(self
            .inner
            .notes(&filter.into())?
            .into_iter()
            .map(Into::into)
            .collect())
    }

    /// The note `id` (its Guid), or none if there's no such note: the same
    /// `Note` that `notes` returns, so a note `notes` skips is none here too.
    pub fn note(&self, id: String) -> Result<Option<Note>, CoreError> {
        Ok(self.inner.note(&id)?.map(Into::into))
    }

    /// Add a note at `location` (none for a free-standing one), on the
    /// highlight `highlight_id` if given, filed in `folder_id` if given,
    /// tagged with its body's inline #tags.
    pub fn add_note(
        &self,
        title: String,
        content: String,
        location: Option<Location>,
        highlight_id: Option<String>,
        folder_id: Option<i64>,
    ) -> Result<Note, CoreError> {
        let location = location.map(berean_core::reader::Location::from);
        Ok(self
            .inner
            .add_note(
                &title,
                &content,
                location.as_ref(),
                highlight_id.as_deref(),
                folder_id,
            )?
            .into())
    }

    /// Replace the note `id`'s title and content, syncing its tags with the
    /// body's inline #tags.
    pub fn update_note(&self, id: String, title: String, content: String) -> Result<(), CoreError> {
        Ok(self.inner.update_note(&id, &title, &content)?)
    }

    /// Check or uncheck the note `id`'s task `index` (`NoteTask.index` in
    /// its rendered body), rewriting only that marker.
    pub fn set_task(&self, id: String, index: u32, checked: bool) -> Result<(), CoreError> {
        Ok(self.inner.set_task(&id, index, checked)?)
    }

    /// Remove the note `id`.
    pub fn remove_note(&self, id: String) -> Result<(), CoreError> {
        Ok(self.inner.remove_note(&id)?)
    }

    /// A note body parsed into the tree the apps draw, with app links
    /// flagged `missing` when their publication isn't installed.
    pub fn render_markdown(&self, markdown: String) -> Result<Vec<Block>, CoreError> {
        Ok(mirror(self.inner.render_markdown(&markdown)?))
    }

    /// Every note folder, flat, in tree order (depth-first, siblings by
    /// position).
    pub fn folders(&self) -> Result<Vec<Folder>, CoreError> {
        Ok(mirror(self.inner.folders()?))
    }

    /// Add a folder called `name` under `parent_id` (none = top level),
    /// last among its siblings.
    pub fn create_folder(&self, name: String, parent_id: Option<i64>) -> Result<Folder, CoreError> {
        Ok(self.inner.create_folder(&name, parent_id)?.into())
    }

    /// Rename folder `id`.
    pub fn rename_folder(&self, id: i64, name: String) -> Result<(), CoreError> {
        Ok(self.inner.rename_folder(id, &name)?)
    }

    /// Move folder `id` under `parent_id` at `position` (clamped to the
    /// end): reparents, reorders, or both.
    pub fn move_folder(
        &self,
        id: i64,
        parent_id: Option<i64>,
        position: u32,
    ) -> Result<(), CoreError> {
        Ok(self.inner.move_folder(id, parent_id, position)?)
    }

    /// Delete folder `id` and its subfolders; their notes become unfiled.
    /// Returns what was removed, for `restore_folder`.
    pub fn delete_folder(&self, id: i64) -> Result<DeletedFolder, CoreError> {
        Ok(self.inner.delete_folder(id)?.into())
    }

    /// Undo `delete_folder`.
    pub fn restore_folder(&self, deleted: DeletedFolder) -> Result<(), CoreError> {
        Ok(self.inner.restore_folder(&deleted.into())?)
    }

    /// File the note `note_id` in `folder_id`, or unfile it for none.
    pub fn set_note_folder(
        &self,
        note_id: String,
        folder_id: Option<i64>,
    ) -> Result<(), CoreError> {
        Ok(self.inner.set_note_folder(&note_id, folder_id)?)
    }

    /// Every Studyspace workspace, in the order they were made.
    pub fn workspaces(&self) -> Result<Vec<Workspace>, CoreError> {
        Ok(mirror(self.inner.workspaces()?))
    }

    /// Add an empty workspace called `name`, with no viewport saved.
    pub fn create_workspace(&self, name: String) -> Result<Workspace, CoreError> {
        Ok(self.inner.create_workspace(&name)?.into())
    }

    /// Rename workspace `id`.
    pub fn rename_workspace(&self, id: i64, name: String) -> Result<(), CoreError> {
        Ok(self.inner.rename_workspace(id, &name)?)
    }

    /// Delete workspace `id` and its cards; the notes on it are kept.
    pub fn delete_workspace(&self, id: i64) -> Result<(), CoreError> {
        Ok(self.inner.delete_workspace(id)?)
    }

    /// The workspace open last, if any: none before the first
    /// `set_last_workspace`, after it's cleared, after that workspace is
    /// deleted, and after an import.
    pub fn last_workspace(&self) -> Result<Option<i64>, CoreError> {
        Ok(self.inner.last_workspace()?)
    }

    /// Remember `id` as the workspace open last (none clears it).
    pub fn set_last_workspace(&self, id: Option<i64>) -> Result<(), CoreError> {
        Ok(self.inner.set_last_workspace(id)?)
    }

    /// Save where workspace `workspace_id`'s view is: its centre and zoom.
    pub fn set_viewport(&self, workspace_id: i64, viewport: Viewport) -> Result<(), CoreError> {
        Ok(self.inner.set_viewport(workspace_id, &viewport.into())?)
    }

    /// The cards on workspace `workspace_id`, in `order`.
    pub fn items(&self, workspace_id: i64, order: ItemOrder) -> Result<Vec<CanvasItem>, CoreError> {
        Ok(mirror(self.inner.items(workspace_id, order.into())?))
    }

    /// Put `card` on workspace `workspace_id` at `frame`, on top of the
    /// others; `missing` is ignored.
    pub fn add_item(
        &self,
        workspace_id: i64,
        card: CardRef,
        frame: Frame,
    ) -> Result<CanvasItem, CoreError> {
        Ok(self
            .inner
            .add_item(workspace_id, &card.into(), &frame.into())?
            .into())
    }

    /// Give items new frames, all or nothing.
    pub fn set_frames(&self, frames: Vec<ItemFrame>) -> Result<(), CoreError> {
        Ok(self.inner.set_frames(&mirror(frames))?)
    }

    /// Put item `item_id` on top of its workspace; returns its new z.
    pub fn bring_to_front(&self, item_id: i64) -> Result<i64, CoreError> {
        Ok(self.inner.bring_to_front(item_id)?)
    }

    /// Save where passage or excerpt card `item_id` has been read to: a
    /// verse or paragraph of the card's own publication and a UTF-16 offset
    /// into its plain text, stored as given. One cheap write, meant for
    /// (debounced) scrolling; bumps last_used_at, z and frame are untouched.
    pub fn set_reader_state(&self, item_id: i64, state: ReaderState) -> Result<(), CoreError> {
        Ok(self.inner.set_reader_state(item_id, &state.into())?)
    }

    /// Mark item `item_id` as just used: bump its last_used_at, leaving z
    /// and frame as they are. For focusing a card, and for link reuse (the
    /// app picks the most recently used card).
    pub fn touch_item(&self, item_id: i64) -> Result<(), CoreError> {
        Ok(self.inner.touch_item(item_id)?)
    }

    /// Take item `item_id` off its workspace; a note card's note is kept.
    pub fn remove_item(&self, item_id: i64) -> Result<(), CoreError> {
        Ok(self.inner.remove_item(item_id)?)
    }

    /// The user tags, in the order they were made.
    pub fn tags(&self) -> Result<Vec<Tag>, CoreError> {
        Ok(self.inner.tags()?.into_iter().map(Into::into).collect())
    }

    /// Add a user tag called `name`.
    pub fn add_tag(&self, name: String) -> Result<Tag, CoreError> {
        Ok(self.inner.add_tag(&name)?.into())
    }

    /// Rename the user tag `id`, rewriting inline `#old` to `#name` in its
    /// notes when both are inline tag names.
    pub fn rename_tag(&self, id: i64, name: String) -> Result<(), CoreError> {
        Ok(self.inner.rename_tag(id, &name)?)
    }

    /// Remove the user tag `id`, untagging whatever had it.
    pub fn remove_tag(&self, id: i64) -> Result<(), CoreError> {
        Ok(self.inner.remove_tag(id)?)
    }

    /// Tag the note `note_id` with `tag_id`.
    pub fn tag_note(&self, note_id: String, tag_id: i64) -> Result<(), CoreError> {
        Ok(self.inner.tag_note(&note_id, tag_id)?)
    }

    /// Take the tag `tag_id` off the note `note_id`.
    pub fn untag_note(&self, note_id: String, tag_id: i64) -> Result<(), CoreError> {
        Ok(self.inner.untag_note(&note_id, tag_id)?)
    }

    /// The favorites, in their order.
    pub fn favorites(&self) -> Result<Vec<Location>, CoreError> {
        Ok(self
            .inner
            .favorites()?
            .into_iter()
            .map(Into::into)
            .collect())
    }

    /// Add `location` last among the favorites.
    pub fn add_favorite(&self, location: Location) -> Result<(), CoreError> {
        Ok(self.inner.add_favorite(&location.into())?)
    }

    /// Remove `location` from the favorites.
    pub fn remove_favorite(&self, location: Location) -> Result<(), CoreError> {
        Ok(self.inner.remove_favorite(&location.into())?)
    }

    /// Move the favorite `location` to index `to_position`.
    pub fn move_favorite(&self, location: Location, to_position: u32) -> Result<(), CoreError> {
        Ok(self.inner.move_favorite(&location.into(), to_position)?)
    }

    /// The bookmarks of `pub_key`, by slot.
    pub fn bookmarks(&self, pub_key: String) -> Result<Vec<Bookmark>, CoreError> {
        Ok(self
            .inner
            .bookmarks(&pub_key)?
            .into_iter()
            .map(Into::into)
            .collect())
    }

    /// Bookmark `location` in `slot` (0-9) of `pub_key`, replacing whatever
    /// was there.
    pub fn set_bookmark(
        &self,
        pub_key: String,
        slot: u8,
        location: Location,
        title: String,
        snippet: Option<String>,
    ) -> Result<(), CoreError> {
        Ok(self
            .inner
            .set_bookmark(&pub_key, slot, &location.into(), &title, snippet.as_deref())?)
    }

    /// Clear `slot` of `pub_key`'s bookmarks.
    pub fn remove_bookmark(&self, pub_key: String, slot: u8) -> Result<(), CoreError> {
        Ok(self.inner.remove_bookmark(&pub_key, slot)?)
    }

    /// Write a `.jwlibrary` backup of all the user data to `path`.
    pub async fn export_backup(
        &self,
        path: String,
        progress: Arc<dyn ProgressSink>,
        cancel: Arc<CancelToken>,
    ) -> Result<(), CoreError> {
        let inner = self.inner.clone();
        run_on_thread(move || Ok(inner.export_backup(path, &Progress(progress), &cancel.inner)?))
            .await
    }

    /// Check the `.jwlibrary` backup at `path` as
    /// [`import_backup`](Self::import_backup) does, without importing it,
    /// and say what an import would bring in, replace and clear.
    pub async fn import_preview(
        &self,
        path: String,
        progress: Arc<dyn ProgressSink>,
        cancel: Arc<CancelToken>,
    ) -> Result<ImportPreview, CoreError> {
        let inner = self.inner.clone();
        run_on_thread(move || {
            Ok(inner
                .import_preview(path, &Progress(progress), &cancel.inner)?
                .into())
        })
        .await
    }

    /// Replace all the user data with the `.jwlibrary` backup at `path`.
    pub async fn import_backup(
        &self,
        path: String,
        progress: Arc<dyn ProgressSink>,
        cancel: Arc<CancelToken>,
    ) -> Result<ImportSummary, CoreError> {
        let inner = self.inner.clone();
        run_on_thread(move || {
            Ok(inner
                .import_backup(path, &Progress(progress), &cancel.inner)?
                .into())
        })
        .await
    }

    /// Put back the data the last [`import_backup`](Self::import_backup)
    /// replaced, dropping what it brought in. Returns `true` when the
    /// previous data was restored, `false` when there is no undo copy (no
    /// import yet, or it was already undone); there is one undo per import.
    pub fn undo_import(&self) -> Result<bool, CoreError> {
        Ok(self.inner.undo_import()?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::task::Wake;
    use std::thread::Thread;

    /// Wakes a parked thread.
    struct Unpark(Thread);

    impl Wake for Unpark {
        fn wake(self: Arc<Self>) {
            self.0.unpark();
        }
    }

    /// Drive `future` to completion on this thread, parking between polls.
    fn block_on<F: Future>(future: F) -> F::Output {
        let mut future = std::pin::pin!(future);
        let waker = Waker::from(Arc::new(Unpark(std::thread::current())));
        let mut cx = Context::from_waker(&waker);
        loop {
            match future.as_mut().poll(&mut cx) {
                Poll::Ready(output) => return output,
                Poll::Pending => std::thread::park(),
            }
        }
    }

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
    fn meetings_and_daily_text_through_ffi() {
        let dir = tempfile::tempdir().unwrap();
        let reader = open_core(&dir).reader();
        // Nothing installed and no catalog: nothing for the day.
        assert_eq!(
            reader.meeting_week(0, 20261112).unwrap(),
            MeetingWeek {
                first_day: 20261109,
                last_day: 20261115,
                midweek: MeetingPart::Unavailable,
                weekend: MeetingPart::Unavailable,
            }
        );
        assert_eq!(
            reader.daily_text(0, 20261112).unwrap(),
            DailyTextDay::Unavailable
        );
        assert!(matches!(
            reader.daily_text(0, 20261131),
            Err(CoreError::Invalid { .. })
        ));
        assert!(matches!(
            reader.meeting_week(0, 2026),
            Err(CoreError::Invalid { .. })
        ));
    }

    #[test]
    fn storage_full_crosses_the_ffi() {
        let err = CoreError::from(berean_core::CoreError::StorageFull);
        assert!(matches!(err, CoreError::StorageFull), "got {err:?}");
        assert_eq!(err.to_string(), "storage is full");
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
        let err =
            block_on(library.install("ll:0:0".into(), path.clone(), recorder.clone(), cancelled))
                .unwrap_err();
        assert!(matches!(err, CoreError::Cancelled), "{err:?}");
        assert!(library.installed().unwrap().is_empty());

        let token = CancelToken::new();
        assert!(!token.is_cancelled());
        block_on(library.install("ll:0:0".into(), path, recorder.clone(), token)).unwrap();
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
                issue_title: None,
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
    fn side_load_round_trips_through_ffi() {
        let path = fixture("ll_E.jwpub").display().to_string();
        let dir = tempfile::tempdir().unwrap();
        let core = open_core(&dir);
        let library = core.library();
        let recorder = Arc::new(Recorder {
            calls: Mutex::new(Vec::new()),
        });
        let side_load = |replace: bool| {
            block_on(library.side_load(path.clone(), replace, recorder.clone(), CancelToken::new()))
                .unwrap()
        };

        let SideLoad::Installed { publication } = side_load(false) else {
            panic!("expected an install");
        };
        assert_eq!(publication.pub_key, "ll:0:0");
        assert_eq!(publication.kind, PubKind::Brochure);
        assert_eq!(library.installed().unwrap(), vec![publication.clone()]);
        let (done, total) = *recorder.calls.lock().unwrap().last().unwrap();
        assert_eq!(done, total);

        assert_eq!(
            side_load(false),
            SideLoad::AlreadyInstalled {
                publication: publication.clone()
            }
        );
        assert_eq!(side_load(true), SideLoad::Installed { publication });

        let err = block_on(library.side_load(
            dir.path().join("absent.jwpub").display().to_string(),
            false,
            recorder,
            CancelToken::new(),
        ))
        .unwrap_err();
        assert!(matches!(err, CoreError::Io { .. }), "{err:?}");
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
        let err =
            block_on(catalog.ingest_file(path.clone(), recorder.clone(), cancelled)).unwrap_err();
        assert!(matches!(err, CoreError::Cancelled), "{err:?}");
        assert!(catalog.languages().unwrap().is_empty());
        assert!(matches!(
            library.download_request("ll:0:0".into()),
            Err(CoreError::NotFound)
        ));
        let ll = fixture("ll_E.jwpub").display().to_string();
        block_on(library.install("ll:0:0".into(), ll, recorder.clone(), CancelToken::new()))
            .unwrap();
        // No catalog: no updates.
        assert!(library.updates_available().is_empty());

        block_on(catalog.ingest_file(path, recorder.clone(), CancelToken::new())).unwrap();
        let calls = recorder.calls.lock().unwrap().clone();
        let (done, total) = *calls.last().unwrap();
        assert_eq!(done, total);

        // The installed copy is the catalog's current one...
        assert!(library.updates_available().is_empty());
        // ...until it is older than the catalog's row.
        let store = dir.path().join("data/publications");
        let installed = std::fs::read_dir(&store)
            .unwrap()
            .map(|e| e.unwrap().path())
            .find(|p| {
                p.file_name()
                    .unwrap()
                    .to_str()
                    .unwrap()
                    .starts_with("ll_0_0")
            })
            .unwrap();
        let manifest = installed.join("manifest.json");
        let json = std::fs::read_to_string(&manifest).unwrap();
        // The value of `"timestamp"`, between the quotes after its colon.
        let key = json.find("\"timestamp\"").unwrap() + "\"timestamp\"".len();
        let start = key + json[key..].find('"').unwrap() + 1;
        let end = start + json[start..].find('"').unwrap();
        assert!(json[key..start].trim_start().starts_with(':'), "{json}");
        let older = format!("{}2000-01-01T00:00:00Z{}", &json[..start], &json[end..]);
        std::fs::write(&manifest, older).unwrap();
        assert_eq!(library.updates_available(), vec!["ll:0:0".to_string()]);

        let languages = catalog.languages().unwrap();
        assert_eq!(
            languages[0],
            Language {
                meps_id: 0,
                code: "E".into(),
                name: "English".into(),
                vernacular: "English".into(),
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

    #[test]
    fn catalog_update_through_ffi() {
        let dir = tempfile::tempdir().unwrap();
        let core = open_core(&dir);
        let catalog = core.catalog();
        assert_eq!(
            catalog.manifest_request(),
            HttpRequest {
                url: "https://app.jw-cdn.org/catalogs/publications/v5/manifest.json".into(),
            }
        );

        let reply =
            br#"{"version": 1, "current": "84939357-BE37-4893-8A5B-F3E87F137B08"}"#.to_vec();
        let update = catalog.plan_update(reply.clone()).unwrap().unwrap();
        assert_eq!(
            update,
            CatalogUpdate {
                url: "https://app.jw-cdn.org/catalogs/publications/v5/\
                      84939357-be37-4893-8a5b-f3e87f137b08/catalog.db.gz"
                    .into(),
                id: "84939357-be37-4893-8a5b-f3e87f137b08".into(),
            }
        );

        assert!(catalog.languages().unwrap().is_empty());
        let path = fixture("catalog-v5-ffa78686.db.gz").display().to_string();
        let recorder = Arc::new(Recorder {
            calls: Mutex::new(Vec::new()),
        });
        block_on(catalog.install_update(update, path, recorder.clone(), CancelToken::new()))
            .unwrap();
        let calls = recorder.calls.lock().unwrap().clone();
        let (done, total) = *calls.last().unwrap();
        assert_eq!(done, total);
        assert_eq!(
            catalog.languages().unwrap()[0],
            Language {
                meps_id: 0,
                code: "E".into(),
                name: "English".into(),
                vernacular: "English".into(),
            }
        );
        assert_eq!(catalog.plan_update(reply).unwrap(), None);
        assert!(matches!(
            catalog.plan_update(b"garbage".to_vec()),
            Err(CoreError::Corrupt)
        ));
    }

    #[test]
    fn reader_through_ffi() {
        let dir = tempfile::tempdir().unwrap();
        let core = open_core(&dir);
        let library = core.library();
        let reader = core.reader();
        for (key, file) in [
            ("ll:0:0", "ll_E.jwpub"),
            ("nwt:0:0", "nwt_E.jwpub"),
            ("nwtsty:0:0", "nwtsty_E.jwpub"),
        ] {
            let progress = Arc::new(Recorder {
                calls: Mutex::new(Vec::new()),
            });
            block_on(library.install(
                key.into(),
                fixture(file).display().to_string(),
                progress,
                CancelToken::new(),
            ))
            .unwrap();
        }

        let toc = reader.toc("ll:0:0".into()).unwrap();
        assert_eq!(
            toc[2],
            TocEntry {
                title: "Title Page/Publishers’ Page".into(),
                doc_id: Some(1102011094),
                depth: 1,
            }
        );

        let doc = reader.document("ll:0:0".into(), 1102011094).unwrap();
        assert_eq!(doc.doc_id, 1102011094);
        let p6 = doc.paragraphs.iter().find(|p| p.paragraph == 6).unwrap();
        assert_eq!(
            &doc.html[p6.begin.unwrap() as usize..p6.end.unwrap() as usize],
            "<p id=\"p6\" data-pid=\"6\" class=\"si\">January 2016 Printing</p>"
        );
        assert!(doc.blocks.contains(&DocBlock::Paragraph {
            paragraph: 6,
            number: None,
            role: ParagraphRole::Body,
            inlines: vec![DocInline::Common {
                inline: Inline::Text {
                    text: "January 2016 Printing".into(),
                },
            }],
        }));
        assert_eq!(p6.text, "January 2016 Printing");

        let ll = |doc_id, paragraph| Location {
            pub_key: "ll:0:0".into(),
            doc_id,
            book: None,
            chapter: None,
            verse: None,
            paragraph,
        };
        assert_eq!(
            reader.locate(ll(Some(1102011094), Some(6)), None).unwrap(),
            Located {
                location: ll(Some(1102011094), Some(6)),
                exact: true,
            }
        );
        // Not a Meeting Workbook, so the date is checked but not used.
        assert_eq!(
            reader
                .locate(ll(Some(1102011094), Some(6)), Some(20261007))
                .unwrap(),
            Located {
                location: ll(Some(1102011094), Some(6)),
                exact: true,
            }
        );
        let start = reader.locate(ll(Some(1), None), None).unwrap();
        assert_eq!(start.location.doc_id, toc.iter().find_map(|e| e.doc_id));
        assert!(!start.exact);

        let chapter = reader.bible_chapter("nwt:0:0".into(), 43, 3).unwrap();
        assert_eq!((chapter.book, chapter.chapter), (43, 3));
        assert_eq!(chapter.verses.len(), 36);
        assert_eq!(chapter.verses[15].label, "16");
        let runs: Vec<&VerseRun> = chapter
            .blocks
            .iter()
            .flat_map(|b| match b {
                ChapterBlock::Paragraph { runs, .. } => runs.iter().collect(),
                ChapterBlock::Heading { .. } => Vec::new(),
            })
            .collect();
        let v3 = runs.iter().find(|r| r.verse == 3).unwrap();
        assert_eq!(v3.label.as_deref(), Some("3"));
        assert_eq!(v3.footnotes, ["a"]);
        assert_eq!(v3.cross_refs, ["f", "g"]);
        assert!(matches!(
            chapter.blocks[0],
            ChapterBlock::Paragraph {
                style: ParagraphStyle::Prose,
                ..
            }
        ));

        let books = reader.bible_books("nwt:0:0".into()).unwrap();
        assert_eq!(books.len(), 66);
        assert_eq!(books[42].book, 43);
        assert_eq!(books[42].chapter_count, 21);
        assert_eq!(books[18].chapter_name.as_deref(), Some("Psalm"));

        let john = |verse| Location {
            pub_key: "nwt:0:0".into(),
            doc_id: Some(1001061147),
            book: Some(43),
            chapter: Some(3),
            verse: Some(verse),
            paragraph: None,
        };
        assert_eq!(
            reader.resolve("John 3:16-18".into()).unwrap(),
            Resolved::Span {
                span: LocationSpan {
                    start: john(16),
                    end: john(18),
                }
            }
        );
        assert_eq!(
            reader.resolve(" HTTPS://www.jw.org/ ".into()).unwrap(),
            Resolved::External {
                url: "HTTPS://www.jw.org/".into()
            }
        );
        assert!(matches!(
            reader.resolve("javascript:alert(1)".into()),
            Err(CoreError::Invalid(_))
        ));
        assert_eq!(
            reader.locate(john(99), None).unwrap(),
            Located {
                location: john(36),
                exact: false,
            }
        );
        assert!(matches!(
            reader.locate(
                Location {
                    pub_key: "zz".into(),
                    ..john(16)
                },
                None
            ),
            Err(CoreError::Invalid(_))
        ));
        assert!(matches!(
            reader.resolve("John 3:18-16".into()),
            Err(CoreError::Invalid(_))
        ));

        let study = reader.verse_study(john(16)).unwrap();
        assert_eq!(study.availability, StudyAvailability::Installed);
        assert_eq!(study.study_notes.len(), 4);
        assert_eq!(study.study_notes[0].label, "loved");
        let labels: Vec<&str> = study.cross_refs.iter().map(|c| c.label.as_str()).collect();
        assert_eq!(labels, ["p", "p", "p", "p", "q", "q", "q", "q", "q"]);
        assert_eq!(
            Resolved::Span {
                span: study.cross_refs[0].target.clone()
            },
            reader.resolve("Romans 5:8".into()).unwrap()
        );
        assert!(study.cross_refs[0].snippet.is_some());
        assert_eq!(
            reader.verse_study(john(3)).unwrap().footnotes,
            [Footnote {
                marker: "a".into(),
                text: "Or possibly, “born from above.”".into(),
            }]
        );
        let markers = reader
            .chapter_study_markers("nwt:0:0".into(), 43, 3)
            .unwrap();
        assert_eq!(markers.len(), 27);
        assert_eq!(
            markers[2],
            VerseStudyCounts {
                verse: 3,
                study_notes: 2,
                cross_refs: 5,
                footnotes: 1,
            }
        );
        assert!(matches!(
            reader.verse_study(Location {
                verse: None,
                ..john(16)
            }),
            Err(CoreError::Invalid(_))
        ));

        // No guide installed and no catalog to list one.
        assert_eq!(
            reader.study_references(john(16)).unwrap(),
            StudyReferences {
                availability: StudyAvailability::Unavailable,
                items: Vec::new(),
            }
        );
        let progress = Arc::new(Recorder {
            calls: Mutex::new(Vec::new()),
        });
        block_on(library.install(
            "rsg:0:0".into(),
            fixture("rsg_E.jwpub").display().to_string(),
            progress,
            CancelToken::new(),
        ))
        .unwrap();
        let refs = reader.study_references(john(16)).unwrap();
        assert_eq!(refs.availability, StudyAvailability::Installed);
        assert!(!refs.items.is_empty());
        assert_eq!(refs.items[0].source, "w24.08 pp. 2-6");
        assert!(refs.items[0].target.is_some());
        assert!(matches!(
            reader.toc("zz:0:0".into()),
            Err(CoreError::NotFound)
        ));
    }

    #[test]
    fn async_calls_fail_through_ffi() {
        let dir = tempfile::tempdir().unwrap();
        let core = open_core(&dir);
        let catalog = core.catalog();
        let library = core.library();
        let missing = dir.path().join("missing").display().to_string();
        let garbage = dir.path().join("garbage.jwpub");
        std::fs::write(&garbage, b"not a jwpub").unwrap();
        let garbage = garbage.display().to_string();
        let recorder = Arc::new(Recorder {
            calls: Mutex::new(Vec::new()),
        });

        let err =
            block_on(catalog.ingest_file(missing.clone(), recorder.clone(), CancelToken::new()))
                .unwrap_err();
        assert!(matches!(err, CoreError::Io(_)), "{err:?}");
        assert!(catalog.languages().unwrap().is_empty());

        let err = block_on(library.install(
            "ll:0:0".into(),
            missing,
            recorder.clone(),
            CancelToken::new(),
        ))
        .unwrap_err();
        assert!(matches!(err, CoreError::Io(_)), "{err:?}");
        let err = block_on(library.install(
            "ll:0:0".into(),
            garbage,
            recorder.clone(),
            CancelToken::new(),
        ))
        .unwrap_err();
        assert!(matches!(err, CoreError::Corrupt), "{err:?}");
        assert!(library.installed().unwrap().is_empty());
    }

    #[test]
    #[should_panic(expected = "core call panicked")]
    fn run_on_thread_resumes_a_panic() {
        block_on(run_on_thread(|| -> () { panic!("core call panicked") }));
    }

    #[test]
    fn search_through_ffi() {
        const W_E: &str = "w26:0:20260800";
        let dir = tempfile::tempdir().unwrap();
        let core = open_core(&dir);
        let search = core.search();
        let recorder = Arc::new(Recorder {
            calls: Mutex::new(Vec::new()),
        });
        block_on(core.library().install(
            W_E.into(),
            fixture("w_E_202608.jwpub").display().to_string(),
            recorder,
            CancelToken::new(),
        ))
        .unwrap();

        let phrase = "What tactic does Satan use to try to break the integrity";
        let hits = block_on(search.query(phrase.into(), SearchScope::default(), 5)).unwrap();
        let hit = &hits[0];
        assert_eq!(
            hit.location,
            Location {
                pub_key: W_E.into(),
                doc_id: Some(2026520),
                book: None,
                chapter: None,
                verse: None,
                paragraph: Some(40),
            }
        );
        assert!(hit.snippet.contains("<mark>"), "{}", hit.snippet);

        let bibles = SearchScope {
            kinds: vec![PubKind::Bible],
            ..Default::default()
        };
        assert!(block_on(search.query(phrase.into(), bibles, 5))
            .unwrap()
            .is_empty());
        let all = block_on(search.query("Jehovah".into(), SearchScope::default(), 10)).unwrap();
        assert_eq!(all.len(), 10);
        let paged = SearchScope {
            offset: 1,
            ..Default::default()
        };
        assert_eq!(
            block_on(search.query("Jehovah".into(), paged, 9)).unwrap(),
            all[1..]
        );
        for (text, limit) in [("", 5), ("Jehovah", 0)] {
            let err =
                block_on(search.query(text.into(), SearchScope::default(), limit)).unwrap_err();
            assert!(matches!(err, CoreError::Invalid(_)), "{err:?}");
        }

        let suggested = block_on(search.suggest("jeho".into(), SearchScope::default(), 3)).unwrap();
        assert_eq!(suggested.queries[0], "Jehovah");
        assert!(suggested.topics.is_empty());
        assert_eq!(
            block_on(search.suggest("love ".into(), SearchScope::default(), 3)).unwrap(),
            Suggestions::default()
        );
        let err = block_on(search.suggest("jeho".into(), SearchScope::default(), 0)).unwrap_err();
        assert!(matches!(err, CoreError::Invalid(_)), "{err:?}");

        // A sink that calls back into the core on every call.
        struct Reentrant {
            core: Arc<Core>,
            calls: Mutex<Vec<(u64, u64)>>,
        }
        impl ProgressSink for Reentrant {
            fn on_progress(&self, done: u64, total: u64) {
                self.core.library().installed().unwrap();
                block_on(
                    self.core
                        .search()
                        .query("Jehovah".into(), SearchScope::default(), 1),
                )
                .unwrap();
                self.calls.lock().unwrap().push((done, total));
            }
        }
        let sink = Arc::new(Reentrant {
            core: core.clone(),
            calls: Mutex::new(Vec::new()),
        });
        block_on(search.rebuild_index(sink.clone(), CancelToken::new())).unwrap();
        let calls = sink.calls.lock().unwrap().clone();
        let (done, total) = *calls.last().unwrap();
        assert_eq!(done, total);
        assert_eq!(
            block_on(search.query(phrase.into(), SearchScope::default(), 5)).unwrap(),
            hits
        );

        let cancelled = CancelToken::new();
        cancelled.cancel();
        let err = block_on(search.rebuild_index(sink, cancelled)).unwrap_err();
        assert!(matches!(err, CoreError::Cancelled), "{err:?}");
    }

    #[test]
    fn core_error_displays_its_message() {
        assert_eq!(CoreError::Io("x".into()).to_string(), "io error: x");
        assert_eq!(CoreError::NotFound.to_string(), "not found");
    }

    #[test]
    fn userdata_backup_through_ffi() {
        let dir = tempfile::tempdir().unwrap();
        let core = open_core(&dir);
        let ud = core.userdata();
        let para = |p| Location {
            pub_key: "w26:0:20260800".into(),
            doc_id: Some(2026601),
            book: None,
            chapter: None,
            verse: None,
            paragraph: Some(p),
        };
        let range = TextRange {
            span: LocationSpan {
                start: para(2),
                end: para(4),
            },
            start_token: Some(1),
            end_token: None,
        };
        let h = ud
            .add_highlight(range.clone(), HighlightColor::Pink)
            .unwrap();
        assert_eq!(h.range, range);
        let tag = ud.add_tag("Study".into()).unwrap();
        let note = ud
            .add_note(
                "T".into(),
                "C".into(),
                Some(para(2)),
                Some(h.id.clone()),
                None,
            )
            .unwrap();
        ud.tag_note(note.id.clone(), tag.id).unwrap();
        ud.set_bookmark("w26:0:20260800".into(), 9, para(3), "B".into(), None)
            .unwrap();
        assert!(matches!(
            ud.set_bookmark("w26:0:20260800".into(), 10, para(3), "B".into(), None),
            Err(CoreError::Invalid(_))
        ));
        let mut doc = para(0);
        doc.paragraph = None;
        ud.add_favorite(doc.clone()).unwrap();

        let recorder = Arc::new(Recorder {
            calls: Mutex::new(Vec::new()),
        });
        let backup = dir.path().join("b.jwlibrary").display().to_string();
        block_on(ud.export_backup(backup.clone(), recorder.clone(), CancelToken::new())).unwrap();
        let (done, total) = *recorder.calls.lock().unwrap().last().unwrap();
        assert_eq!(done, total);

        let other_dir = tempfile::tempdir().unwrap();
        let other = open_core(&other_dir).userdata();
        // No import yet: nothing to undo.
        assert!(!other.undo_import().unwrap());
        let prior = other.add_tag("Prior".into()).unwrap();
        // Cancelled: nothing imported.
        let cancelled = CancelToken::new();
        cancelled.cancel();
        let err =
            block_on(other.import_backup(backup.clone(), recorder.clone(), cancelled)).unwrap_err();
        assert!(matches!(err, CoreError::Cancelled), "{err:?}");
        assert_eq!(other.tags().unwrap(), std::slice::from_ref(&prior));
        // Not a backup.
        let junk = other_dir.path().join("junk.jwlibrary");
        std::fs::write(&junk, b"not a zip").unwrap();
        let err = block_on(other.import_backup(
            junk.display().to_string(),
            recorder.clone(),
            CancelToken::new(),
        ))
        .unwrap_err();
        assert!(matches!(err, CoreError::Corrupt), "{err:?}");
        let err = block_on(other.import_preview(
            junk.display().to_string(),
            recorder.clone(),
            CancelToken::new(),
        ))
        .unwrap_err();
        assert!(matches!(err, CoreError::Corrupt), "{err:?}");

        // The preview says what the import brings and replaces, and changes
        // nothing.
        let folder = other.create_folder("Kept".into(), None).unwrap();
        let filed = other
            .add_note("F".into(), "".into(), None, None, Some(folder.id))
            .unwrap();
        recorder.calls.lock().unwrap().clear();
        let preview =
            block_on(other.import_preview(backup.clone(), recorder.clone(), CancelToken::new()))
                .unwrap();
        let one = ImportSummary {
            highlights: 1,
            notes: 1,
            tags: 1,
            bookmarks: 1,
            favorites: 1,
        };
        assert_eq!(
            preview,
            ImportPreview {
                backup: one,
                current: ImportSummary {
                    tags: 1,
                    notes: 1,
                    ..ImportSummary::from(berean_core::userdata::ImportSummary::default())
                },
                folders: 1,
                filed_notes: 1,
                device_name: "Berean".into(),
                created: preview.created.clone(),
            }
        );
        let (done, total) = *recorder.calls.lock().unwrap().last().unwrap();
        assert_eq!(done, total);
        assert_eq!(other.folders().unwrap().len(), 1);
        other.remove_note(filed.id).unwrap();
        other.delete_folder(folder.id).unwrap();

        let summary =
            block_on(other.import_backup(backup, recorder.clone(), CancelToken::new())).unwrap();
        assert_eq!(
            summary,
            ImportSummary {
                highlights: 1,
                notes: 1,
                tags: 1,
                bookmarks: 1,
                favorites: 1,
            }
        );
        let mut doc_only = para(0);
        doc_only.paragraph = None;
        assert_eq!(
            other.highlights("w26:0:20260800".into(), doc_only).unwrap(),
            [h]
        );
        let notes = other.notes(NoteFilter::default()).unwrap();
        assert_eq!(
            notes,
            [Note {
                tag_ids: vec![tag.id],
                ..note
            }]
        );
        assert_eq!(other.tags().unwrap(), [tag]);
        assert_eq!(other.favorites().unwrap(), [doc]);
        assert_eq!(
            other.bookmarks("w26:0:20260800".into()).unwrap(),
            [Bookmark {
                pub_key: "w26:0:20260800".into(),
                slot: 9,
                location: para(3),
                title: "B".into(),
                snippet: None,
            }]
        );

        // Undo puts back the data from before the import, once.
        assert!(other.undo_import().unwrap());
        assert_eq!(other.tags().unwrap(), [prior]);
        assert!(other.notes(NoteFilter::default()).unwrap().is_empty());
        assert!(other.favorites().unwrap().is_empty());
        assert!(other.bookmarks("w26:0:20260800".into()).unwrap().is_empty());
        assert!(!other.undo_import().unwrap());
        assert_eq!(other.tags().unwrap().len(), 1);
    }

    #[test]
    fn folders_through_ffi() {
        let dir = tempfile::tempdir().unwrap();
        let ud = open_core(&dir).userdata();
        let john = ud.create_folder("Gospel of John".into(), None).unwrap();
        let signs = ud.create_folder("Signs".into(), Some(john.id)).unwrap();
        assert_eq!((signs.depth, signs.position), (1, 0));
        let note = ud
            .add_note("Cana".into(), "".into(), None, None, Some(signs.id))
            .unwrap();
        assert_eq!(note.folder_id, Some(signs.id));
        ud.add_note("Loose".into(), "".into(), None, None, None)
            .unwrap();
        let in_john = NoteFilter {
            folder: Some(FolderScope::Folder {
                id: john.id,
                include_subfolders: true,
            }),
            ..NoteFilter::default()
        };
        assert_eq!(
            ud.notes(in_john.clone()).unwrap(),
            std::slice::from_ref(&note)
        );
        assert_eq!(ud.folders().unwrap()[0].note_count, 1);

        let deleted = ud.delete_folder(john.id).unwrap();
        assert!(ud.folders().unwrap().is_empty());
        assert_eq!(ud.notes(NoteFilter::default()).unwrap().len(), 2);
        ud.restore_folder(deleted).unwrap();
        assert_eq!(ud.notes(in_john).unwrap(), std::slice::from_ref(&note));
        ud.set_note_folder(note.id.clone(), None).unwrap();
        let unfiled = NoteFilter {
            folder: Some(FolderScope::Unfiled),
            ..NoteFilter::default()
        };
        assert_eq!(ud.notes(unfiled).unwrap().len(), 2);
        assert!(matches!(
            ud.move_folder(john.id, Some(signs.id), 0),
            Err(CoreError::Invalid(_))
        ));
        assert!(matches!(
            ud.rename_folder(999, "x".into()),
            Err(CoreError::NotFound)
        ));
    }

    #[test]
    fn last_workspace_through_ffi() {
        let dir = tempfile::tempdir().unwrap();
        let ud = open_core(&dir).userdata();
        assert_eq!(ud.last_workspace().unwrap(), None);
        let ws = ud.create_workspace("John".into()).unwrap();
        ud.set_last_workspace(Some(ws.id)).unwrap();
        assert_eq!(ud.last_workspace().unwrap(), Some(ws.id));
        assert!(matches!(
            ud.set_last_workspace(Some(ws.id + 1)),
            Err(CoreError::NotFound)
        ));
        assert_eq!(ud.last_workspace().unwrap(), Some(ws.id));
        ud.set_last_workspace(None).unwrap();
        assert_eq!(ud.last_workspace().unwrap(), None);
    }

    #[test]
    fn note_by_id_through_ffi() {
        let dir = tempfile::tempdir().unwrap();
        let ud = open_core(&dir).userdata();
        let note = ud
            .add_note("Cana".into(), "#signs".into(), None, None, None)
            .unwrap();
        assert_eq!(ud.note(note.id.clone()).unwrap(), Some(note.clone()));
        assert_eq!(ud.note("no-such-guid".into()).unwrap(), None);
        ud.remove_note(note.id.clone()).unwrap();
        assert_eq!(ud.note(note.id).unwrap(), None);
    }

    #[test]
    fn studyspace_through_ffi() {
        let dir = tempfile::tempdir().unwrap();
        let ud = open_core(&dir).userdata();
        let ws = ud.create_workspace("Prologue study".into()).unwrap();
        assert_eq!(ws.viewport, None);
        assert_eq!(ws.item_count, 0);
        assert!(matches!(
            ud.create_workspace(" prologue STUDY ".into()),
            Err(CoreError::Invalid(_))
        ));
        ud.rename_workspace(ws.id, "John 1".into()).unwrap();
        let viewport = Viewport {
            x: -120.5,
            y: 40.0,
            zoom: 0.75,
        };
        ud.set_viewport(ws.id, viewport.clone()).unwrap();
        let listed = ud.workspaces().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "John 1");
        assert_eq!(listed[0].viewport, Some(viewport));

        let frame = |x: f64, y: f64| Frame {
            x,
            y,
            width: 200.0,
            height: 120.0,
        };
        let note = ud
            .add_note("Word".into(), "".into(), None, None, None)
            .unwrap();
        let verse = |verse| Location {
            pub_key: "nwtsty:0:0".into(),
            doc_id: None,
            book: Some(43),
            chapter: Some(1),
            verse: Some(verse),
            paragraph: None,
        };
        let cards = [
            CardRef::Note {
                note_id: note.id.clone(),
            },
            CardRef::Passage {
                span: LocationSpan {
                    start: verse(1),
                    end: verse(3),
                },
                missing: true,
            },
            CardRef::Publication {
                location: Location {
                    pub_key: "ll:0:0".into(),
                    doc_id: Some(2),
                    book: None,
                    chapter: None,
                    verse: None,
                    paragraph: Some(4),
                },
                missing: true,
            },
        ];
        let mut items = Vec::new();
        for (i, card) in cards.iter().enumerate() {
            let item = ud
                .add_item(ws.id, card.clone(), frame(0.0, 100.0 - i as f64))
                .unwrap();
            assert_eq!(&item.card, card);
            assert_eq!(item.z, i as i64 + 1);
            items.push(item);
        }
        assert_eq!(ud.items(ws.id, ItemOrder::Z).unwrap(), items);
        let reading: Vec<i64> = ud
            .items(ws.id, ItemOrder::Reading)
            .unwrap()
            .iter()
            .map(|i| i.id)
            .collect();
        assert_eq!(reading, [items[2].id, items[1].id, items[0].id]);

        ud.set_frames(vec![ItemFrame {
            id: items[0].id,
            frame: frame(5.0, 6.0),
        }])
        .unwrap();
        assert!(matches!(
            ud.set_frames(vec![
                ItemFrame {
                    id: items[1].id,
                    frame: frame(7.0, 8.0),
                },
                ItemFrame {
                    id: items[2].id,
                    frame: Frame {
                        width: 0.0,
                        ..frame(0.0, 0.0)
                    },
                },
            ]),
            Err(CoreError::Invalid(_))
        ));
        assert_eq!(ud.bring_to_front(items[0].id).unwrap(), 4);
        let now = ud.items(ws.id, ItemOrder::Z).unwrap();
        assert_eq!(now[2].frame, frame(5.0, 6.0));
        assert_eq!(now[0], items[1]);
        assert!(now.iter().all(|i| i.reader.is_none()));

        // Readers: a verse elsewhere in the same Bible, a paragraph in
        // another document of the same publication.
        let states = [
            ReaderState {
                at: CardRef::Passage {
                    span: LocationSpan {
                        start: Location {
                            chapter: Some(2),
                            ..verse(5)
                        },
                        end: Location {
                            chapter: Some(2),
                            ..verse(5)
                        },
                    },
                    missing: true,
                },
                char_offset: 17,
            },
            ReaderState {
                at: CardRef::Publication {
                    location: Location {
                        pub_key: "ll:0:0".into(),
                        doc_id: Some(9),
                        book: None,
                        chapter: None,
                        verse: None,
                        paragraph: Some(1),
                    },
                    missing: true,
                },
                char_offset: 0,
            },
        ];
        ud.set_reader_state(items[1].id, states[0].clone()).unwrap();
        ud.set_reader_state(items[2].id, states[1].clone()).unwrap();
        assert!(matches!(
            ud.set_reader_state(items[0].id, states[1].clone()),
            Err(CoreError::Invalid(_))
        ));
        assert!(matches!(
            ud.set_reader_state(items[1].id, states[1].clone()),
            Err(CoreError::Invalid(_))
        ));
        assert!(matches!(
            ud.set_reader_state(items[2].id + 100, states[1].clone()),
            Err(CoreError::NotFound)
        ));
        let read = ud.items(ws.id, ItemOrder::Z).unwrap();
        let reader = |id| read.iter().find(|i| i.id == id).unwrap().reader.clone();
        assert_eq!(reader(items[0].id), None);
        assert_eq!(reader(items[1].id), Some(states[0].clone()));
        assert_eq!(reader(items[2].id), Some(states[1].clone()));
        // Reading bumps last_used_at (whole seconds, so it may not move
        // within a test); nothing else changes.
        assert!(read.iter().all(|i| i.last_used_at.ends_with('Z')));
        assert!(read
            .iter()
            .zip(&now)
            .all(|(r, n)| r.last_used_at >= n.last_used_at));
        assert_eq!(read, {
            let mut want = now.clone();
            want[0].reader = Some(states[0].clone());
            want[1].reader = Some(states[1].clone());
            for (w, r) in want.iter_mut().zip(&read) {
                w.last_used_at = r.last_used_at.clone();
            }
            want
        });

        // Touching leaves z and frame alone.
        ud.touch_item(items[0].id).unwrap();
        let touched = ud.items(ws.id, ItemOrder::Z).unwrap();
        assert_eq!(touched.len(), read.len());
        for (t, r) in touched.iter().zip(&read) {
            assert_eq!((t.id, t.z, &t.frame), (r.id, r.z, &r.frame));
            assert!(t.last_used_at >= r.last_used_at);
        }
        assert!(matches!(
            ud.touch_item(items[2].id + 100),
            Err(CoreError::NotFound)
        ));

        ud.remove_item(items[1].id).unwrap();
        assert_eq!(ud.workspaces().unwrap()[0].item_count, 2);
        ud.delete_workspace(ws.id).unwrap();
        assert!(ud.workspaces().unwrap().is_empty());
        assert_eq!(ud.notes(NoteFilter::default()).unwrap().len(), 1);
        assert!(matches!(
            ud.items(ws.id, ItemOrder::Z),
            Err(CoreError::NotFound)
        ));
    }

    #[test]
    fn doc_blocks_mirror_the_core_tree() {
        use berean_core::doc_blocks as core;
        use berean_core::notes::Inline as CoreInline;

        let core_text = |text: &str| core::DocInline::Common {
            inline: CoreInline::Text { text: text.into() },
        };
        let text = |text: &str| DocInline::Common {
            inline: Inline::Text { text: text.into() },
        };
        let core_verse = |verse| core::DocVerse {
            book: 43,
            chapter: 3,
            verse,
        };
        let verse = |verse| DocVerse {
            book: 43,
            chapter: 3,
            verse,
        };
        let blocks: Vec<DocBlock> = mirror(vec![
            core::DocBlock::Heading {
                level: 1,
                paragraph: Some(1),
                inlines: vec![core_text("Title")],
            },
            core::DocBlock::Paragraph {
                paragraph: 2,
                number: Some("1".into()),
                role: core::ParagraphRole::ThemeScripture,
                inlines: vec![
                    core::DocInline::Common {
                        inline: CoreInline::Emphasis {
                            children: vec![CoreInline::Text { text: "b".into() }],
                        },
                    },
                    core::DocInline::Superscript {
                        children: vec![core_text("e")],
                    },
                    core::DocInline::Link {
                        children: vec![core::DocInline::SmallCaps {
                            children: vec![core_text("John 3:16")],
                        }],
                        url: "jwpub://b/NWTR/43:3:16-43:3:17".into(),
                        target: core::DocLinkTarget::Bible {
                            symbol: "NWTR".into(),
                            start: core_verse(16),
                            end: core_verse(17),
                        },
                    },
                    core::DocInline::Link {
                        children: vec![core::DocInline::PageMarker { page: "3".into() }],
                        url: "jwpub://p/E:1102021206/4-5".into(),
                        target: core::DocLinkTarget::Document {
                            language: "E".into(),
                            doc_id: 1102021206,
                            first: Some(4),
                            last: Some(5),
                        },
                    },
                    core::DocInline::FootnoteRef {
                        id: 7,
                        marker: "a".into(),
                    },
                ],
            },
            core::DocBlock::Question {
                paragraph: 3,
                number: "1-2".into(),
                for_paragraphs: vec![2, 4],
                inlines: vec![core::DocInline::Subscript {
                    children: vec![core_text("q")],
                }],
            },
            core::DocBlock::AnswerField {
                paragraph: 5,
                tag: "textarea-1".into(),
            },
            core::DocBlock::Figure {
                image: core::DocImage {
                    file: "a.jpg".into(),
                    path: "/pubs/a.jpg".into(),
                    alt: "A".into(),
                    width: Some(10),
                    height: None,
                },
                caption: Vec::new(),
            },
            core::DocBlock::Aside {
                title: Some(core::DocTitle {
                    paragraph: 6,
                    inlines: vec![core_text("Box")],
                }),
                blocks: vec![core::DocBlock::List {
                    ordered: true,
                    items: vec![core::DocListItem {
                        blocks: vec![core::DocBlock::Table {
                            rows: vec![core::DocTableRow {
                                cells: vec![core::DocTableCell {
                                    header: true,
                                    colspan: 2,
                                    blocks: vec![core::DocBlock::Rule],
                                }],
                            }],
                        }],
                    }],
                }],
            },
            core::DocBlock::Footnotes {
                items: vec![core::DocFootnote {
                    id: 7,
                    marker: "a".into(),
                    paragraph: None,
                    inlines: vec![core::DocInline::Link {
                        children: vec![core_text("x")],
                        url: "#x".into(),
                        target: core::DocLinkTarget::Invalid,
                    }],
                }],
            },
        ]);
        assert_eq!(
            blocks,
            [
                DocBlock::Heading {
                    level: 1,
                    paragraph: Some(1),
                    inlines: vec![text("Title")],
                },
                DocBlock::Paragraph {
                    paragraph: 2,
                    number: Some("1".into()),
                    role: ParagraphRole::ThemeScripture,
                    inlines: vec![
                        DocInline::Common {
                            inline: Inline::Emphasis {
                                children: vec![Inline::Text { text: "b".into() }],
                            },
                        },
                        DocInline::Superscript {
                            children: vec![text("e")],
                        },
                        DocInline::Link {
                            children: vec![DocInline::SmallCaps {
                                children: vec![text("John 3:16")],
                            }],
                            url: "jwpub://b/NWTR/43:3:16-43:3:17".into(),
                            target: DocLinkTarget::Bible {
                                symbol: "NWTR".into(),
                                start: verse(16),
                                end: verse(17),
                            },
                        },
                        DocInline::Link {
                            children: vec![DocInline::PageMarker { page: "3".into() }],
                            url: "jwpub://p/E:1102021206/4-5".into(),
                            target: DocLinkTarget::Document {
                                language: "E".into(),
                                doc_id: 1102021206,
                                first: Some(4),
                                last: Some(5),
                            },
                        },
                        DocInline::FootnoteRef {
                            id: 7,
                            marker: "a".into(),
                        },
                    ],
                },
                DocBlock::Question {
                    paragraph: 3,
                    number: "1-2".into(),
                    for_paragraphs: vec![2, 4],
                    inlines: vec![DocInline::Subscript {
                        children: vec![text("q")],
                    }],
                },
                DocBlock::AnswerField {
                    paragraph: 5,
                    tag: "textarea-1".into(),
                },
                DocBlock::Figure {
                    image: DocImage {
                        file: "a.jpg".into(),
                        path: "/pubs/a.jpg".into(),
                        alt: "A".into(),
                        width: Some(10),
                        height: None,
                    },
                    caption: Vec::new(),
                },
                DocBlock::Aside {
                    title: Some(DocTitle {
                        paragraph: 6,
                        inlines: vec![text("Box")],
                    }),
                    blocks: vec![DocBlock::List {
                        ordered: true,
                        items: vec![DocListItem {
                            blocks: vec![DocBlock::Table {
                                rows: vec![DocTableRow {
                                    cells: vec![DocTableCell {
                                        header: true,
                                        colspan: 2,
                                        blocks: vec![DocBlock::Rule],
                                    }],
                                }],
                            }],
                        }],
                    }],
                },
                DocBlock::Footnotes {
                    items: vec![DocFootnote {
                        id: 7,
                        marker: "a".into(),
                        paragraph: None,
                        inlines: vec![DocInline::Link {
                            children: vec![text("x")],
                            url: "#x".into(),
                            target: DocLinkTarget::Invalid,
                        }],
                    }],
                },
            ]
        );
    }

    #[test]
    fn notes_render_through_ffi() {
        let dir = tempfile::tempdir().unwrap();
        let ud = open_core(&dir).userdata();
        let john = Location {
            pub_key: "nwtsty:0:0".into(),
            doc_id: None,
            book: Some(43),
            chapter: Some(1),
            verse: Some(9),
            paragraph: None,
        };
        let span = LocationSpan {
            start: john.clone(),
            end: john,
        };
        let url = passage_url(span.clone()).unwrap();
        assert_eq!(url, "berean://bible/nwtsty:0:0/43/1/9");
        assert_eq!(
            ud.render_markdown(format!("[John 1:9]({url})\n\n- [x] #done"))
                .unwrap(),
            [
                Block::PassageCard {
                    text: "John 1:9".into(),
                    span: span.clone(),
                    missing: true,
                },
                Block::List {
                    start: None,
                    items: vec![ListItem {
                        task: Some(NoteTask {
                            index: 0,
                            checked: true,
                        }),
                        blocks: vec![Block::Paragraph {
                            inlines: vec![Inline::Tag {
                                name: "done".into(),
                            }],
                        }],
                    }],
                },
            ]
        );
        assert!(matches!(
            publication_url(span.start),
            Err(CoreError::Invalid(_))
        ));
    }

    #[test]
    fn markdown_spans_through_ffi() {
        let span = |start, end, kind| SourceSpan { start, end, kind };
        // "😀" is two UTF-16 units, so everything after it shifts by two.
        assert_eq!(
            markdown_spans("## 😀 [a](u) #t".into()),
            [
                span(0, 2, SpanKind::HeadingMarker),
                span(6, 7, SpanKind::LinkBracket),
                span(8, 10, SpanKind::LinkBracket),
                span(10, 11, SpanKind::LinkUrl),
                span(11, 12, SpanKind::LinkBracket),
                span(13, 15, SpanKind::Tag),
            ]
        );
        assert_eq!(markdown_spans(String::new()), []);
    }
}
