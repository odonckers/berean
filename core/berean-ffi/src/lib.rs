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
        }
    }
}

/// The FFI mirror of [`berean_core::userdata::NoteFilter`].
#[derive(Debug, Clone, Default, PartialEq, Eq, uniffi::Record)]
pub struct NoteFilter {
    pub location: Option<Location>,
    pub tag_id: Option<i64>,
}

impl From<NoteFilter> for berean_core::userdata::NoteFilter {
    fn from(f: NoteFilter) -> Self {
        berean_core::userdata::NoteFilter {
            location: f.location.map(Into::into),
            tag_id: f.tag_id,
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
    /// highlight `highlight_id` if given.
    pub fn add_note(
        &self,
        title: String,
        content: String,
        location: Option<Location>,
        highlight_id: Option<String>,
    ) -> Result<Note, CoreError> {
        let location = location.map(berean_core::reader::Location::from);
        Ok(self
            .inner
            .add_note(&title, &content, location.as_ref(), highlight_id.as_deref())?
            .into())
    }

    /// Replace the note `id`'s title and content.
    pub fn update_note(&self, id: String, title: String, content: String) -> Result<(), CoreError> {
        Ok(self.inner.update_note(&id, &title, &content)?)
    }

    /// Remove the note `id`.
    pub fn remove_note(&self, id: String) -> Result<(), CoreError> {
        Ok(self.inner.remove_note(&id)?)
    }

    /// The user tags, in the order they were made.
    pub fn tags(&self) -> Result<Vec<Tag>, CoreError> {
        Ok(self.inner.tags()?.into_iter().map(Into::into).collect())
    }

    /// Add a user tag called `name`.
    pub fn add_tag(&self, name: String) -> Result<Tag, CoreError> {
        Ok(self.inner.add_tag(&name)?.into())
    }

    /// Rename the user tag `id`.
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
            .add_note("T".into(), "C".into(), Some(para(2)), Some(h.id.clone()))
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
}
