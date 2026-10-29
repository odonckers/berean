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
}

impl From<berean_core::reader::ParagraphAnchor> for ParagraphAnchor {
    fn from(p: berean_core::reader::ParagraphAnchor) -> Self {
        ParagraphAnchor {
            paragraph: p.paragraph,
            label: p.label,
            begin: p.begin,
            end: p.end,
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
}

impl From<berean_core::reader::Document> for Document {
    fn from(d: berean_core::reader::Document) -> Self {
        Document {
            doc_id: d.doc_id,
            title: d.title,
            html: d.html,
            paragraphs: d.paragraphs.into_iter().map(Into::into).collect(),
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
}

impl From<berean_core::reader::BibleChapter> for BibleChapter {
    fn from(c: berean_core::reader::BibleChapter) -> Self {
        BibleChapter {
            pub_key: c.pub_key,
            book: c.book,
            chapter: c.chapter,
            html: c.html,
            verses: c.verses.into_iter().map(Into::into).collect(),
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

    /// Chapter `chapter` of book `book` (1-66) of the installed Bible `bible`.
    pub fn bible_chapter(
        &self,
        bible: String,
        book: u32,
        chapter: u32,
    ) -> Result<BibleChapter, CoreError> {
        Ok(self.inner.bible_chapter(&bible, book, chapter)?.into())
    }

    /// Resolve a citation or `jwpub://` link to the span it names.
    pub fn resolve(&self, reference: String) -> Result<LocationSpan, CoreError> {
        Ok(self.inner.resolve(&reference)?.into())
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
    pub fn query(
        &self,
        text: String,
        scope: SearchScope,
        limit: u32,
    ) -> Result<Vec<Hit>, CoreError> {
        Ok(self
            .inner
            .query(&text, &scope.into(), limit)?
            .into_iter()
            .map(Into::into)
            .collect())
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
        let err =
            block_on(catalog.ingest_file(path.clone(), recorder.clone(), cancelled)).unwrap_err();
        assert!(matches!(err, CoreError::Cancelled), "{err:?}");
        assert!(catalog.languages().unwrap().is_empty());
        assert!(matches!(
            library.download_request("ll:0:0".into()),
            Err(CoreError::NotFound)
        ));

        block_on(catalog.ingest_file(path, recorder.clone(), CancelToken::new())).unwrap();
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

    #[test]
    fn reader_through_ffi() {
        let dir = tempfile::tempdir().unwrap();
        let core = open_core(&dir);
        let library = core.library();
        let reader = core.reader();
        for (key, file) in [("ll:0:0", "ll_E.jwpub"), ("nwt:0:0", "nwt_E.jwpub")] {
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

        let chapter = reader.bible_chapter("nwt:0:0".into(), 43, 3).unwrap();
        assert_eq!((chapter.book, chapter.chapter), (43, 3));
        assert_eq!(chapter.verses.len(), 36);
        assert_eq!(chapter.verses[15].label, "16");

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
            LocationSpan {
                start: john(16),
                end: john(18),
            }
        );
        assert!(matches!(
            reader.resolve("John 3:18-16".into()),
            Err(CoreError::Invalid(_))
        ));
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
        let hits = search
            .query(phrase.into(), SearchScope::default(), 5)
            .unwrap();
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
        assert!(search.query(phrase.into(), bibles, 5).unwrap().is_empty());
        let all = search
            .query("Jehovah".into(), SearchScope::default(), 10)
            .unwrap();
        assert_eq!(all.len(), 10);
        let paged = SearchScope {
            offset: 1,
            ..Default::default()
        };
        assert_eq!(search.query("Jehovah".into(), paged, 9).unwrap(), all[1..]);
        for (text, limit) in [("", 5), ("Jehovah", 0)] {
            let err = search
                .query(text.into(), SearchScope::default(), limit)
                .unwrap_err();
            assert!(matches!(err, CoreError::Invalid(_)), "{err:?}");
        }

        // A sink that calls back into the core on every call.
        struct Reentrant {
            core: Arc<Core>,
            calls: Mutex<Vec<(u64, u64)>>,
        }
        impl ProgressSink for Reentrant {
            fn on_progress(&self, done: u64, total: u64) {
                self.core.library().installed().unwrap();
                self.core
                    .search()
                    .query("Jehovah".into(), SearchScope::default(), 1)
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
            search
                .query(phrase.into(), SearchScope::default(), 5)
                .unwrap(),
            hits
        );

        let cancelled = CancelToken::new();
        cancelled.cancel();
        let err = block_on(search.rebuild_index(sink, cancelled)).unwrap_err();
        assert!(matches!(err, CoreError::Cancelled), "{err:?}");
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
}
