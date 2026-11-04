//! Reader: the table of contents, documents and Bible chapters of installed
//! publications, and resolving citations and `jwpub://` links to a
//! [`LocationSpan`]. [`Reader::bible_books`] lists a Bible's books with their
//! names and chapter counts, for book and chapter navigation.
//!
//! A document is named by its MEPS document id (`Document.MepsDocumentId`),
//! never by the publication's local `DocumentId`: the MEPS id stays the same
//! across reinstalls, and JW Library keys user data by it too. A MEPS id is
//! only unique within one publication, so [`Reader::document`] takes the
//! publication's key as well as the id.
//!
//! Anchors (`begin`, `end`) are byte offsets into the HTML they come with.
//! A paragraph's anchor always covers its whole element, opening and closing
//! tags included, however the publication records it.
//!
//! # Resolving
//!
//! [`Reader::resolve`] returns a [`Resolved::Span`] holding a
//! [`LocationSpan`], from its `start` through its `end`; a single verse,
//! chapter, document or paragraph gives `start == end`. It takes one of:
//!
//! - A citation: `<book> <chapter>`, `<book> <chapter>:<verse>`, a verse
//!   range in one chapter `<book> <chapter>:<verse>-<verse>`, one across
//!   chapters `<book> <chapter>:<verse>-<chapter>:<verse>`, or a chapter
//!   range `<book> <chapter>-<chapter>` (an en or em dash works as well as
//!   `-`). A chapter alone (`Psalm 23`) gives a location with `verse: None`
//!   as both start and end. A chapter range gives the span from the first
//!   verse the Bible has in its first chapter (verse 0 for a psalm with a
//!   superscription) through the last verse of its last chapter. In a book of
//!   one chapter (one the Bible has no chapter 2 of: Obadiah, Philemon, 2
//!   John, 3 John, Jude) a lone number is a verse, so `Jude 3` is Jude 1:3
//!   and `Jude 3-5` is Jude 1:3-1:5; `Jude 1:3` works too. Book names come
//!   from each installed Bible's own tables: the title of the book's document
//!   (`John`, `Psalms`, `1 Juan`), plus its `ChapterDisplayTitle` when that
//!   is a single word (`Psalm`, `Salmos`). Names match ignoring case, runs of
//!   whitespace (non-breaking spaces included) and the diacritics of Latin
//!   letters. Installed Bibles are searched in key order; the first with a
//!   matching book name is used. A trailing `.` or `;` is ignored.
//! - `jwpub://b/<bible>/<book>:<chapter>:<verse>-<book>:<chapter>:<verse>`, a
//!   link to a Bible verse or range of verses (possibly across chapters,
//!   never across books). The link names no language, so it resolves against
//!   the first installed Bible, in key order, with the link's symbol (`NWTR`
//!   is the `nwt` New World Translation; no other is known).
//! - `jwpub://p/<code>:<doc_id>/[<paragraph>[-<paragraph>]]`, a link to a
//!   document, or a paragraph or range of paragraphs of it, by JW language
//!   code and MEPS document id. It resolves to the first installed
//!   publication, in key order, in that language holding the document.
//!
//! An `http://`, `https://` or `mailto:` link (the scheme in any case, with
//! something after it) is not looked up: it gives [`Resolved::External`]
//! with the link as given, for the apps to hand to the system. Any other
//! scheme (`javascript:`, `ftp:`, `data:`, `file:`, ...) is `Invalid`.
//!
//! Both ends of a range must exist, and the end may not come before the start
//! (in Bible order: book, chapter, verse; or paragraph order). A span stays
//! within one book. Not a single span, and so `Invalid`: a list (`John 3:16,
//! 17`; resolve each part on its own) and a range from a chapter to a verse
//! (`John 3-4:2`).
//!
//! Errors: a malformed key, citation or link, a reversed range, or a Bible
//! link from one book to another => `Invalid`; a publication that is not
//! installed, or an unknown document, book, chapter, verse or paragraph =>
//! `NotFound`; publication data that contradicts itself (an anchor out of
//! range or not on its paragraph's element, a verse missing from its chapter,
//! a table of contents that is not a tree) => `Corrupt`.
//!
//! # Study references
//!
//! [`Reader::study_references`] lists what the Research Guide (symbol
//! `rsg`) cites for a Bible verse. The guide used is the installed one in the
//! Bible's language. Its `VerseCommentaryMap` names the verse by the Bible's
//! own `BibleVerseId`, so each entry's header (a `jwpub://b/` link to the
//! verse) is checked against the verse asked for: a Bible numbered unlike the
//! guide gives `Corrupt` rather than another verse's references. An entry is
//! a list of references in the guide's order, newest first; each is a `<div>`
//! holding one `<a class="xt">` link, followed by a `<div>` naming its source
//! (e.g. `w24.08 pp. 2-6`), whose plain text is the reference's `source`.
//! Empty `<p>` elements between them are skipped; anything else =>
//! `Corrupt`. A link's target is the first paragraph of its first
//! `$`-separated `jwpub://p/` target, in the publication its `Extract` row's
//! `RefPublication` names.
//!
//! A study publication that is not installed is reported, not an error: as
//! [`StudyAvailability::NotInstalled`] with the catalog's key for it, or
//! [`StudyAvailability::Unavailable`] when there is no catalog or it lists
//! none in the Bible's language.
//!
//! # Verse study
//!
//! [`Reader::verse_study`] gives a Bible verse's footnotes, cross references
//! and study notes; [`Reader::chapter_study_markers`] counts them for each
//! verse of a chapter, for its "has content" margin markers.
//!
//! Footnotes and cross references come from the Bible being read. A
//! chapter's HTML marks them in the verse text with `<span class="fn">a…`
//! and `<span class="m">a…` (also `fn pr`, `m pr`), the letters
//! [`VerseRun`] lists. A footnote marker's `data-fnid` is the
//! `FootnoteIndex` of a `Footnote` row of the book's document, which holds
//! its text. A cross-reference marker's `data-mid` is the `BlockNumber` of
//! one or more `BibleCitation` rows of the book's document, one per target
//! (by `ElementNumber`): `FirstBibleVerseId` through `LastBibleVerseId`, in
//! the same Bible, never across books. Each row's `BibleVerseId` (the
//! footnote's too) must be the marked verse; a marker without its rows, or
//! rows for another verse => `Corrupt`.
//!
//! Study notes come from the NWT Study Edition (symbol `nwtsty`): the Bible
//! being read if it is one, otherwise the installed one in the Bible's
//! language (taken first in key order). Like the Research Guide, it has one
//! `VerseCommentary` entry per verse, mapped from its own `BibleVerseId` (so
//! the verse is looked up there by number) and checked against its header's
//! `jwpub://b/` link. An entry is a run of `<p>` elements; a paragraph that
//! opens with a bold lemma (`<strong>loved:</strong>`) starts a note, the
//! lemma being its label, and most others continue the note before it.

use std::collections::HashMap;
use std::sync::Arc;

use crate::catalog::{Catalog, CatalogFilter};
use crate::doc_blocks::{self, DocBlock};
use crate::jwpub::{self, DocumentParagraph, DocumentSummary, Publication, PublicationViewItem};
use crate::languages;
use crate::library::{format_pub_key, Library, PubKind, PublicationSummary};
use crate::{CoreError, Inner};

/// The `PublicationView` whose items are the table of contents.
const TOC_VIEW: &str = "jwpub";

const LISTS: &str = "a list of references is not a single span; resolve each part on its own";
const REVERSED: &str = "range ends before it starts";
const MIXED_RANGE: &str = "a chapter range cannot end at a verse";
const ONE_BOOK: &str = "a span must stay within one book";
const NOT_A_VERSE: &str =
    "study references need a Bible verse: a Bible's key, book, chapter and verse, no paragraph";

const NOT_A_STUDY_VERSE: &str =
    "verse study needs a Bible verse: a Bible's key, book, chapter and verse, no paragraph";

/// The Research Guide's publication symbol.
const GUIDE: &str = "rsg";

/// The NWT Study Edition's publication symbol.
const STUDY_BIBLE: &str = "nwtsty";

/// A point in a publication: a document, optionally a paragraph of it, or a
/// Bible book, chapter and optionally verse.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Location {
    pub pub_key: String,
    /// The MEPS document id (for a Bible location, the book's document).
    pub doc_id: Option<i64>,
    pub book: Option<u32>,
    pub chapter: Option<u32>,
    pub verse: Option<u32>,
    /// The paragraph's `data-pid` (`DocumentParagraph.ParagraphIndex`).
    pub paragraph: Option<u32>,
}

/// What a reference names: from `start` through `end`, both inclusive. A
/// single verse, chapter, document or paragraph gives `start == end`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocationSpan {
    pub start: Location,
    pub end: Location,
}

/// What [`Reader::resolve`] gives: a span of the library, or a web or mail
/// link for the apps to hand to the system.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Resolved {
    Span {
        span: LocationSpan,
    },
    /// An `http://`, `https://` or `mailto:` link, as given (trimmed).
    External {
        url: String,
    },
}

/// One table-of-contents entry. The entries of a publication form a flat
/// list in display order; `depth` is 0 for a top-level entry and one more
/// for each level of nesting.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TocEntry {
    pub title: String,
    /// The MEPS document id the entry opens; `None` for a heading.
    pub doc_id: Option<i64>,
    pub depth: u32,
}

/// A document's decrypted HTML and paragraph anchors.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Document {
    /// The MEPS document id.
    pub doc_id: i64,
    pub title: String,
    pub html: String,
    /// One per `DocumentParagraph` row, in order.
    pub paragraphs: Vec<ParagraphAnchor>,
    /// The document laid out as plain text, in HTML (reading) order, not pid
    /// order.
    pub blocks: Vec<DocBlock>,
}

/// Where a paragraph is in its document's HTML.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParagraphAnchor {
    /// The paragraph's `data-pid` (`ParagraphIndex`).
    pub paragraph: u32,
    /// The printed paragraph number, if it has one.
    pub label: Option<String>,
    /// The paragraph's byte range in the HTML: its whole element, from the
    /// `<` of the opening tag carrying `data-pid` through the `>` of the
    /// matching closing tag, whichever way the publication records it
    /// (`DocumentParagraph.BeginPosition`/`EndPosition`). Both are `None` for
    /// a paragraph the publication gives no position for (it does not appear
    /// in the HTML).
    pub begin: Option<u32>,
    pub end: Option<u32>,
    /// The paragraph's plain text as the reader draws it: the text of the
    /// inlines of its block in [`Document::blocks`], with footnote refs and
    /// page markers left out and without the printed paragraph or question
    /// number (`DocBlock::Paragraph::number`, `DocBlock::Question::number`).
    /// This is what `ReaderState::char_offset` counts (in UTF-16 code units)
    /// and what a bookmark's snippet starts with. A positioned paragraph is
    /// on exactly one block; were it on more, the first in reading order
    /// would give the text. Empty for a paragraph not in the HTML and for an
    /// `AnswerField`.
    pub text: String,
}

/// A Bible chapter's decrypted HTML and verse anchors.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BibleChapter {
    pub pub_key: String,
    pub book: u32,
    pub chapter: u32,
    pub html: String,
    /// In order. Verse 0 is a psalm's superscription.
    pub verses: Vec<VerseAnchor>,
    /// The chapter laid out as plain text, in reading order: what comes
    /// before its verses (`PreContent`), the verses (`Content`, without its
    /// footnotes) and what comes after them (`PostContent`).
    pub blocks: Vec<ChapterBlock>,
}

/// One block of a [`BibleChapter`]'s layout.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChapterBlock {
    /// A heading: a book's title on its first chapter, a book division of
    /// the Psalms (`BOOK ONE`, `(Psalms 1-41)`), a letter of Psalm 119.
    /// Footnote markers in it are dropped.
    Heading { text: String },
    /// A paragraph, or one line of poetry.
    Paragraph {
        /// The paragraph's `data-pid`. The lines of a stanza share it.
        paragraph: u32,
        style: ParagraphStyle,
        /// In order. A verse split across paragraphs has a run in each.
        runs: Vec<VerseRun>,
    },
}

/// How a [`ChapterBlock::Paragraph`] is laid out.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParagraphStyle {
    /// A prose paragraph (`sb`).
    Prose,
    /// A line of poetry that starts a verse (`sl`).
    PoetryLine,
    /// A line of poetry that continues a verse (`sz`).
    PoetryContinuation,
    /// A psalm's superscription, verse 0 (`sw`).
    Superscription,
    /// A note after the verses (`PostContent`): Habakkuk 3's closing
    /// instruction, the end of the Hebrew-Aramaic Scriptures after Malachi 4.
    /// Its one run belongs to no verse (verse 0) and is not verse text.
    Note,
}

/// One verse part's text in a [`ChapterBlock::Paragraph`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerseRun {
    /// The verse the part belongs to; 0 for a superscription. In a
    /// [`ParagraphStyle::Note`] it is 0 but the run belongs to no verse and
    /// must not be treated as verse text.
    pub verse: u32,
    /// The label printed at the part: the chapter number on a chapter's
    /// first verse, the verse number on another verse's first part; `None`
    /// on a superscription or a verse's later parts.
    pub label: Option<String>,
    /// The part as plain text, without its label or markers, whitespace
    /// runs collapsed and trimmed. Separate runs with a space when joining.
    pub text: String,
    /// The letters of the footnote markers in the part, in order (`a`).
    pub footnotes: Vec<String>,
    /// The letters of the cross-reference markers in the part, in order.
    pub cross_refs: Vec<String>,
}

/// One book of a Bible, for navigating to its chapters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BibleBook {
    /// The book number, 1 (Genesis) to 66 (Revelation).
    pub book: u32,
    /// The title of the book's document: `John`, `Psalms`, `1 Juan`.
    pub name: String,
    /// The book's full title (`BookDisplayTitle`).
    pub long_title: String,
    /// What a chapter of the book is called, when the Bible gives a single
    /// word for it (`Psalm`, `Salmos`); `None` otherwise.
    pub chapter_name: Option<String>,
    /// How many chapters the Bible has of the book.
    pub chapter_count: u32,
}

/// One verse of a [`BibleChapter`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerseAnchor {
    pub verse: u32,
    /// The label printed at the verse: its number, the chapter number for a
    /// chapter's first verse, empty for a superscription.
    pub label: String,
    /// The verse as plain text: the text of its runs in
    /// [`BibleChapter::blocks`], in order, joined with a single space. This
    /// is what `ReaderState::char_offset` counts (in UTF-16 code units).
    pub text: String,
    /// The byte range in the chapter's HTML from the start of the verse's
    /// first part to the end of its last (a verse may be split across
    /// paragraphs).
    pub begin: u32,
    pub end: u32,
}

/// Whether the study publication a call draws on, in the Bible's language,
/// is installed: the Research Guide (`rsg`) for
/// [`Reader::study_references`], the NWT Study Edition (`nwtsty`) for
/// [`Reader::verse_study`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StudyAvailability {
    Installed,
    /// Not installed; the catalog lists it as `pub_key` (its newest in the
    /// language), to download.
    NotInstalled {
        pub_key: String,
    },
    /// Not installed, and none to download: there is no catalog, or it lists
    /// none in the language.
    Unavailable,
}

/// The study content for one Bible verse; see the module docs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerseStudy {
    /// From the NWT Study Edition, in its order. Empty when it is not
    /// installed or has no notes on the verse.
    pub study_notes: Vec<StudyNote>,
    /// From the Bible being read: one per target of each of the verse's
    /// cross-reference markers, in marker order and then target order (a
    /// marker with three targets gives three, all with its letter).
    pub cross_refs: Vec<CrossRef>,
    /// From the Bible being read: one per footnote marker in the verse, in
    /// order.
    pub footnotes: Vec<Footnote>,
    /// Whether the NWT Study Edition in the Bible's language is installed.
    pub availability: StudyAvailability,
}

/// One study note of the NWT Study Edition (a `VerseCommentary` entry holds
/// all of a verse's notes).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StudyNote {
    /// The note's lemma, the words of the verse it explains, as plain text
    /// without its closing `:` (`loved`, `only-begotten Son`); empty for a
    /// note that has none (a note on manuscripts that add a verse).
    pub label: String,
    /// The note's body as plain text. A note of several paragraphs has them
    /// on separate lines.
    pub text: String,
}

/// One target of a cross-reference (marginal reference) marker, from the
/// Bible's `BibleCitation` table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CrossRef {
    /// The marker's letter, as the verse shows it (`p`): the same letters
    /// as [`VerseRun::cross_refs`].
    pub label: String,
    /// The verse or verses it points to, in the same Bible (possibly across
    /// chapters, never across books).
    pub target: LocationSpan,
    /// The target verses as plain text, separated by spaces; `None` when the
    /// Bible has no text for them.
    pub snippet: Option<String>,
}

/// One footnote on a verse, from the Bible's `Footnote` table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Footnote {
    /// The marker's letter, as the verse shows it (`a`): the same letters as
    /// [`VerseRun::footnotes`].
    pub marker: String,
    /// The footnote as plain text.
    pub text: String,
}

/// How much study content one verse has, for a chapter's margin markers:
/// the lengths of what [`Reader::verse_study`] returns for it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerseStudyCounts {
    pub verse: u32,
    pub study_notes: u32,
    pub cross_refs: u32,
    pub footnotes: u32,
}

/// What the Research Guide cites for one verse.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StudyReferences {
    pub availability: StudyAvailability,
    /// In the guide's order, newest first. Empty when the guide is not
    /// installed or has no entry for the verse.
    pub items: Vec<StudyReference>,
}

/// One reference the Research Guide cites.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StudyReference {
    /// The link's text, as plain text.
    pub label: String,
    /// The source the guide names for it, as plain text (`w24.08 pp. 2-6`).
    pub source: String,
    /// The guide's HTML for the reference: from the `<div` holding the link
    /// through the `</div>` of the one naming its source.
    pub html: String,
    /// The first paragraph the link targets, in the publication the guide
    /// says it quotes (which need not be installed). `None` when the guide
    /// does not say which publication that is.
    pub target: Option<Location>,
}

/// Where a saved location is in the installed publication now; see
/// [`Reader::locate`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Located {
    /// A location that exists, so the reader can open it as it is.
    pub location: Location,
    /// False when `location` is a fallback: the saved paragraph, verse,
    /// chapter, book or document is gone.
    pub exact: bool,
}

/// Handle to the reader. Cheap to clone; shares the core's state.
#[derive(Clone)]
pub struct Reader {
    inner: Arc<Inner>,
}

impl Reader {
    pub(crate) fn new(inner: Arc<Inner>) -> Self {
        Reader { inner }
    }

    /// The table of contents of an installed publication, in display order.
    /// Titles are trimmed of surrounding whitespace. Malformed key =>
    /// `Invalid`; not installed => `NotFound`.
    pub fn toc(&self, pub_key: &str) -> Result<Vec<TocEntry>, CoreError> {
        self.library().with_publication(pub_key, toc)
    }

    /// The document with MEPS id `doc_id` in the installed publication
    /// `pub_key`. Malformed key => `Invalid`; not installed, or no such
    /// document (or one without content) => `NotFound`.
    pub fn document(&self, pub_key: &str, doc_id: i64) -> Result<Document, CoreError> {
        self.library()
            .with_publication_in(pub_key, |publication, dir| {
                let summary = find_document(publication, doc_id)?.ok_or(CoreError::NotFound)?;
                let html = publication.document_html(summary.document_id)?;
                let mut paragraphs: Vec<ParagraphAnchor> = publication
                    .document_paragraphs(summary.document_id)?
                    .into_iter()
                    .map(|p| paragraph_anchor(&html, p))
                    .collect::<Result<_, _>>()?;
                let blocks = doc_blocks::document_blocks(&html, &mut paragraphs, dir)?;
                Ok(Document {
                    doc_id,
                    title: summary.title,
                    html,
                    paragraphs,
                    blocks,
                })
            })
    }

    /// Chapter `chapter` of book `book` (1-66) of the installed Bible
    /// `bible`. Malformed key => `Invalid`; not installed, not a Bible, or
    /// no such chapter => `NotFound`.
    pub fn bible_chapter(
        &self,
        bible: &str,
        book: u32,
        chapter: u32,
    ) -> Result<BibleChapter, CoreError> {
        self.library().with_publication(bible, |publication| {
            read_chapter(publication, bible, book, chapter)
        })
    }

    /// The books of the installed Bible `bible`, by book number. A book the
    /// Bible has no chapters of (a partial Bible) is not listed. Malformed
    /// key => `Invalid`; not installed, or not a Bible (no book has a
    /// chapter) => `NotFound`; a book without a document or a full title =>
    /// `Corrupt`.
    pub fn bible_books(&self, bible: &str) -> Result<Vec<BibleBook>, CoreError> {
        self.library().with_publication(bible, |publication| {
            let mut counts: HashMap<u32, u32> = HashMap::new();
            for (book, _) in publication.bible_chapter_numbers()? {
                *counts.entry(book).or_default() += 1;
            }
            let documents = documents_by_id(publication)?;
            let mut books = Vec::new();
            for row in publication.bible_books()? {
                let book = u32::try_from(row.bible_book_id).map_err(|_| CoreError::Corrupt)?;
                let Some(&chapter_count) = counts.get(&book) else {
                    continue;
                };
                let doc = documents
                    .get(&row.book_document_id)
                    .ok_or(CoreError::Corrupt)?;
                books.push(BibleBook {
                    book,
                    name: doc.title.clone(),
                    chapter_name: chapter_name(&row).map(str::to_string),
                    long_title: row.book_display_title,
                    chapter_count,
                });
            }
            if books.is_empty() {
                return Err(CoreError::NotFound);
            }
            Ok(books)
        })
    }

    /// Where a saved location (a bookmark, a reader state, a card's own
    /// location) is in the installed publication now. It never fails because
    /// the place is gone; it falls back, in order:
    ///
    /// - The publication alone (no document, no book): the publication's
    ///   starting document (the first table-of-contents entry with one),
    ///   exact.
    /// - A document with a paragraph that is in its HTML, or a document
    ///   alone: as saved, exact. A paragraph that is gone or not in the
    ///   HTML: the one in the HTML with the largest pid below it, else the
    ///   first in reading order, else the document alone; not exact.
    /// - A document the publication does not have: its starting document,
    ///   not exact.
    /// - A Bible book, chapter or verse that exists: as saved, exact. A
    ///   verse that is gone: the chapter's largest verse below it, else its
    ///   first verse. A chapter that is gone: the book's first chapter, no
    ///   verse. A book that is gone: the publication alone. None is exact.
    ///
    /// Opens at most one document's paragraph rows or one chapter. A
    /// malformed key or location => `Invalid`; not installed => `NotFound`.
    pub fn locate(&self, location: &Location) -> Result<Located, CoreError> {
        crate::userdata::check_location(location)?;
        self.library()
            .with_publication(&location.pub_key, |publication| {
                if location.book.is_some() {
                    return locate_verse(publication, location);
                }
                let at = |doc_id, paragraph, exact| Located {
                    location: Location {
                        pub_key: location.pub_key.clone(),
                        doc_id,
                        book: None,
                        chapter: None,
                        verse: None,
                        paragraph,
                    },
                    exact,
                };
                let found = match location.doc_id {
                    Some(doc_id) => find_document(publication, doc_id)?,
                    None => return Ok(at(start_document(publication)?, None, true)),
                };
                let Some(summary) = found else {
                    return Ok(at(start_document(publication)?, None, false));
                };
                let (paragraph, exact) = match location.paragraph {
                    Some(p) => locate_paragraph(publication, summary.document_id, p)?,
                    None => (None, true),
                };
                Ok(at(location.doc_id, paragraph, exact))
            })
    }

    /// Resolve a citation or `jwpub://` link to the span of locations it
    /// names, or an `http://`, `https://` or `mailto:` link to
    /// [`Resolved::External`]; see the module docs for the forms accepted.
    pub fn resolve(&self, reference: &str) -> Result<Resolved, CoreError> {
        let reference = reference.trim();
        if is_external(reference) {
            return Ok(Resolved::External {
                url: reference.to_string(),
            });
        }
        self.resolve_span(reference)
            .map(|span| Resolved::Span { span })
    }

    fn resolve_span(&self, reference: &str) -> Result<LocationSpan, CoreError> {
        match reference.strip_prefix("jwpub://") {
            Some(link) => {
                if let Some(rest) = link.strip_prefix("b/") {
                    self.resolve_bible_link(reference, rest)
                } else if let Some(rest) = link.strip_prefix("p/") {
                    self.resolve_document_link(reference, rest)
                } else {
                    Err(CoreError::Invalid(format!(
                        "unsupported link {reference:?}"
                    )))
                }
            }
            None => self.resolve_citation(reference),
        }
    }

    /// What the Research Guide in the Bible's language cites for the verse
    /// at `location`; see the module docs.
    ///
    /// `location` must name a verse of an installed Bible: its key, `book`,
    /// `chapter` and `verse`, and no `paragraph` (`doc_id` is not read).
    /// Anything else => `Invalid`; a Bible that is not installed, or an
    /// unknown chapter or verse => `NotFound`. When the guide is not
    /// installed, the catalog's newest `rsg` in the language is returned as
    /// [`StudyAvailability::NotInstalled`]; if the catalog lists none (or
    /// there is no catalog), as [`StudyAvailability::Unavailable`]; either
    /// way with no items. A guide entry for another verse,
    /// or one not shaped as described => `Corrupt`.
    pub fn study_references(&self, location: &Location) -> Result<StudyReferences, CoreError> {
        let (Some(book), Some(chapter), Some(verse), None) = (
            location.book,
            location.chapter,
            location.verse,
            location.paragraph,
        ) else {
            return Err(CoreError::Invalid(format!("{NOT_A_VERSE}: {location:?}")));
        };
        let library = self.library();
        let (installed, verse_id, language) =
            library.with_publication(&location.pub_key, |bible| {
                let installed = library.installed()?;
                if !installed
                    .iter()
                    .any(|p| p.pub_key == location.pub_key && p.kind == PubKind::Bible)
                {
                    return Err(CoreError::Invalid(format!("{NOT_A_VERSE}: {location:?}")));
                }
                let verse_id = bible_verse_id(bible, book, chapter, verse)?;
                Ok((installed, verse_id, bible.meta().meps_language))
            })?;

        let guide = installed
            .iter()
            .find(|p| p.symbol == GUIDE && p.meps_language == language);
        let Some(guide) = guide else {
            let filter = CatalogFilter {
                meps_language: Some(language),
                key_symbol: Some(GUIDE.into()),
                ..CatalogFilter::default()
            };
            let listed = self
                .catalog()
                .publications(&filter)?
                .into_iter()
                .find(|p| p.symbol == GUIDE);
            return Ok(StudyReferences {
                availability: listed_availability(listed.map(|p| p.pub_key)),
                items: Vec::new(),
            });
        };

        let items = library.with_publication(&guide.pub_key, |guide| {
            let mut items = Vec::new();
            for entry in guide.verse_commentaries_for(verse_id)? {
                let header = entry.label.as_deref().ok_or(CoreError::Corrupt)?;
                if entry_verse(header) != Some((book, chapter, verse)) {
                    return Err(CoreError::Corrupt);
                }
                let html = guide.decrypt(entry.content.as_deref().ok_or(CoreError::Corrupt)?)?;
                for link in study_links(&html)? {
                    items.push(StudyReference {
                        label: plain_text(link.text).trim().to_string(),
                        source: plain_text(link.source).trim().to_string(),
                        html: html[link.begin..link.end].to_string(),
                        target: study_target(guide, &link)?,
                    });
                }
            }
            Ok(items)
        })?;
        Ok(StudyReferences {
            availability: StudyAvailability::Installed,
            items,
        })
    }

    /// The footnotes, cross references and study notes of the verse at
    /// `location`; see the module docs.
    ///
    /// `location` must name a verse of an installed Bible: its key, `book`,
    /// `chapter` and verse, and no `paragraph` (`doc_id` is not read).
    /// Anything else => `Invalid`; a Bible that is not installed, or an
    /// unknown chapter or verse => `NotFound`. When the NWT Study Edition in
    /// the Bible's language is not installed, the catalog's newest `nwtsty`
    /// in the language is returned as [`StudyAvailability::NotInstalled`]
    /// with no study notes; if the catalog lists none (or there is no
    /// catalog), as [`StudyAvailability::Unavailable`] with no study notes,
    /// as for [`Reader::study_references`]. Either way the footnotes and
    /// cross references are there. Data not shaped as described =>
    /// `Corrupt`.
    pub fn verse_study(&self, location: &Location) -> Result<VerseStudy, CoreError> {
        let (Some(book), Some(chapter), Some(verse), None) = (
            location.book,
            location.chapter,
            location.verse,
            location.paragraph,
        ) else {
            return Err(CoreError::Invalid(format!(
                "{NOT_A_STUDY_VERSE}: {location:?}"
            )));
        };
        let bible_key = &location.pub_key;
        let library = self.library();
        let (study_bible, language, footnotes, cross_refs) =
            library.with_publication(bible_key, |bible| {
                let study_bible = study_bible(&library, bible, bible_key)?;
                let markers = chapter_markers(bible, book, chapter)?
                    .into_iter()
                    .find(|m| m.verse == verse)
                    .ok_or(CoreError::NotFound)?;
                let footnotes = markers
                    .footnotes
                    .into_iter()
                    .map(|(marker, row)| {
                        let html =
                            bible.decrypt(row.content.as_deref().ok_or(CoreError::Corrupt)?)?;
                        Ok(Footnote {
                            marker,
                            text: plain_text(&html).trim().to_string(),
                        })
                    })
                    .collect::<Result<_, CoreError>>()?;
                let books = bible.bible_books()?;
                let documents = documents_by_id(bible)?;
                let cross_refs = markers
                    .cross_refs
                    .into_iter()
                    .map(|(label, row)| {
                        let (target, snippet) =
                            cross_ref_target(bible, bible_key, &books, &documents, &row)?;
                        Ok(CrossRef {
                            label,
                            target,
                            snippet,
                        })
                    })
                    .collect::<Result<_, CoreError>>()?;
                Ok((
                    study_bible,
                    bible.meta().meps_language,
                    footnotes,
                    cross_refs,
                ))
            })?;

        let Some(study_bible) = study_bible else {
            let filter = CatalogFilter {
                meps_language: Some(language),
                key_symbol: Some(STUDY_BIBLE.into()),
                ..CatalogFilter::default()
            };
            let listed = self
                .catalog()
                .publications(&filter)?
                .into_iter()
                .find(|p| p.symbol == STUDY_BIBLE);
            return Ok(VerseStudy {
                study_notes: Vec::new(),
                cross_refs,
                footnotes,
                availability: listed_availability(listed.map(|p| p.pub_key)),
            });
        };
        let study_notes = library.with_publication(&study_bible, |sty| {
            Ok(chapter_study_notes(sty, book, chapter)?
                .remove(&verse)
                .unwrap_or_default())
        })?;
        Ok(VerseStudy {
            study_notes,
            cross_refs,
            footnotes,
            availability: StudyAvailability::Installed,
        })
    }

    /// How many study notes, cross references and footnotes
    /// [`Reader::verse_study`] gives for each verse of chapter `chapter` of
    /// book `book` of the installed Bible `bible`: one entry per verse that
    /// has any, in verse order. Study notes count as none when the NWT Study
    /// Edition in the Bible's language is not installed; the catalog is not
    /// read. Malformed key, or not a Bible => `Invalid`; not installed, or
    /// no such chapter => `NotFound`; data not shaped as described =>
    /// `Corrupt`.
    pub fn chapter_study_markers(
        &self,
        bible: &str,
        book: u32,
        chapter: u32,
    ) -> Result<Vec<VerseStudyCounts>, CoreError> {
        let library = self.library();
        let (study_bible, markers) = library.with_publication(bible, |publication| {
            let study_bible = study_bible(&library, publication, bible)?;
            Ok((study_bible, chapter_markers(publication, book, chapter)?))
        })?;
        let notes = match study_bible {
            Some(key) => {
                library.with_publication(&key, |sty| chapter_study_notes(sty, book, chapter))?
            }
            None => HashMap::new(),
        };
        let count = |n: usize| u32::try_from(n).map_err(|_| CoreError::Corrupt);
        let mut counts = Vec::new();
        for m in markers {
            let entry = VerseStudyCounts {
                verse: m.verse,
                study_notes: count(notes.get(&m.verse).map_or(0, Vec::len))?,
                cross_refs: count(m.cross_refs.len())?,
                footnotes: count(m.footnotes.len())?,
            };
            if entry.study_notes + entry.cross_refs + entry.footnotes > 0 {
                counts.push(entry);
            }
        }
        Ok(counts)
    }

    fn resolve_citation(&self, reference: &str) -> Result<LocationSpan, CoreError> {
        let citation = parse_citation(reference)?;
        for summary in self.installed(|p| p.kind == PubKind::Bible)? {
            let found = self
                .library()
                .with_publication(&summary.pub_key, |publication| {
                    let documents = documents_by_id(publication)?;
                    for book in publication.bible_books()? {
                        let doc = documents
                            .get(&book.book_document_id)
                            .ok_or(CoreError::Corrupt)?;
                        let matches = std::iter::once(doc.title.as_str())
                            .chain(chapter_name(&book))
                            .any(|name| fold(name) == citation.book);
                        if !matches {
                            continue;
                        }
                        let number =
                            u32::try_from(book.bible_book_id).map_err(|_| CoreError::Corrupt)?;
                        let (mut start, mut end) = (citation.start, citation.end);
                        // In a book of one chapter a lone number is a verse.
                        if start.1.is_none() && publication.bible_chapter(number, 2)?.is_none() {
                            start = (1, Some(start.0));
                            end = (1, Some(end.0));
                        }
                        if start.1.is_none() && start != end {
                            // A chapter range: the first verse of the first chapter
                            // through the last verse of the last.
                            let edge = |chapter, last: bool| -> Result<Location, CoreError> {
                                let read =
                                    read_chapter(publication, &summary.pub_key, number, chapter)?;
                                let verse = if last {
                                    read.verses.last()
                                } else {
                                    read.verses.first()
                                };
                                let verse = verse.ok_or(CoreError::Corrupt)?.verse;
                                Ok(bible_point(
                                    &summary.pub_key,
                                    doc,
                                    number,
                                    chapter,
                                    Some(verse),
                                ))
                            };
                            return Ok(Some(LocationSpan {
                                start: edge(start.0, false)?,
                                end: edge(end.0, true)?,
                            }));
                        }
                        let at = |(chapter, verse): (u32, Option<u32>)| {
                            bible_location(
                                publication,
                                &summary.pub_key,
                                &book,
                                doc,
                                chapter,
                                verse,
                            )
                        };
                        return span(at(start)?, || at(end), start == end).map(Some);
                    }
                    Ok(None)
                })?;
            if let Some(found) = found {
                return Ok(found);
            }
        }
        Err(CoreError::NotFound)
    }

    fn resolve_bible_link(&self, link: &str, rest: &str) -> Result<LocationSpan, CoreError> {
        let invalid = || CoreError::Invalid(format!("malformed Bible link {link:?}"));
        let (symbol, start, end) = bible_link(rest).ok_or_else(invalid)?;
        if end < start {
            return Err(CoreError::Invalid(format!("{REVERSED}: {link:?}")));
        }
        if end.0 != start.0 {
            return Err(CoreError::Invalid(format!("{ONE_BOOK}: {link:?}")));
        }
        let symbol = match symbol {
            "NWTR" => "nwt",
            _ => return Err(CoreError::NotFound),
        };
        let summary = self
            .installed(|p| p.kind == PubKind::Bible && p.symbol == symbol)?
            .into_iter()
            .next()
            .ok_or(CoreError::NotFound)?;
        self.library()
            .with_publication(&summary.pub_key, |publication| {
                let books = publication.bible_books()?;
                let documents = documents_by_id(publication)?;
                let at = |(book, chapter, verse): (u32, u32, u32)| {
                    let book_row = books
                        .iter()
                        .find(|b| b.bible_book_id == i64::from(book))
                        .ok_or(CoreError::NotFound)?;
                    let doc = documents
                        .get(&book_row.book_document_id)
                        .ok_or(CoreError::Corrupt)?;
                    bible_location(
                        publication,
                        &summary.pub_key,
                        book_row,
                        doc,
                        chapter,
                        Some(verse),
                    )
                };
                span(at(start)?, || at(end), start == end)
            })
    }

    fn resolve_document_link(&self, link: &str, rest: &str) -> Result<LocationSpan, CoreError> {
        let invalid = || CoreError::Invalid(format!("malformed document link {link:?}"));
        let (code, doc_id, paragraphs) = document_link(rest).ok_or_else(invalid)?;
        if paragraphs.is_some_and(|(first, last)| last < first) {
            return Err(CoreError::Invalid(format!("{REVERSED}: {link:?}")));
        }
        let language = languages::by_code(code).ok_or(CoreError::NotFound)?;
        for summary in self.installed(|p| p.meps_language == language.meps_id)? {
            let doc = self
                .library()
                .with_publication(&summary.pub_key, |publication| {
                    let Some(doc) = find_document(publication, doc_id)? else {
                        return Ok(None);
                    };
                    if let Some((first, last)) = paragraphs {
                        let rows = publication.document_paragraphs(doc.document_id)?;
                        let exists =
                            |p: u32| rows.iter().any(|r| r.paragraph_index == i64::from(p));
                        if !exists(first) || !exists(last) {
                            return Err(CoreError::NotFound);
                        }
                    }
                    Ok(Some(doc))
                })?;
            let Some(doc) = doc else {
                continue;
            };
            let at = |paragraph| Location {
                pub_key: summary.pub_key.clone(),
                doc_id: Some(doc.meps_document_id),
                book: None,
                chapter: None,
                verse: None,
                paragraph,
            };
            return Ok(LocationSpan {
                start: at(paragraphs.map(|p| p.0)),
                end: at(paragraphs.map(|p| p.1)),
            });
        }
        Err(CoreError::NotFound)
    }

    /// Installed publications that pass `keep`, in key order.
    fn installed(
        &self,
        keep: impl Fn(&PublicationSummary) -> bool,
    ) -> Result<Vec<PublicationSummary>, CoreError> {
        Ok(self
            .library()
            .installed()?
            .into_iter()
            .filter(keep)
            .collect())
    }

    fn library(&self) -> Library {
        Library::new(self.inner.clone())
    }

    fn catalog(&self) -> Catalog {
        Catalog::new(self.inner.clone())
    }
}

/// A verse as `(book, chapter, verse)`.
type VerseRef = (u32, u32, u32);

/// A first and last paragraph.
type ParagraphRange = (u32, u32);

/// Whether `reference` starts with `http://`, `https://` or `mailto:` (in
/// any case) and has something after it.
pub(crate) fn is_external(reference: &str) -> bool {
    ["http://", "https://", "mailto:"].iter().any(|prefix| {
        reference.len() > prefix.len()
            && reference
                .get(..prefix.len())
                .is_some_and(|head| head.eq_ignore_ascii_case(prefix))
    })
}

/// Split the part of a Bible link after `jwpub://b/`,
/// `<symbol>/<book>:<chapter>:<verse>[-<book>:<chapter>:<verse>]`, into its
/// symbol and its first and last verse.
pub(crate) fn bible_link(rest: &str) -> Option<(&str, VerseRef, VerseRef)> {
    let verse_ref = |s: &str| -> Option<VerseRef> {
        let mut parts = s.split(':');
        let r = (
            number(parts.next()?)?,
            number(parts.next()?)?,
            number(parts.next()?)?,
        );
        parts.next().is_none().then_some(r)
    };
    let (symbol, range) = rest.split_once('/')?;
    let (start, end) = range.split_once('-').unwrap_or((range, range));
    Some((symbol, verse_ref(start)?, verse_ref(end)?))
}

/// Split the part of a document link after `jwpub://p/`,
/// `<code>:<doc_id>[/[<paragraph>[-<paragraph>]]]`, into its language code,
/// MEPS document id and first and last paragraph (in either order).
pub(crate) fn document_link(rest: &str) -> Option<(&str, i64, Option<ParagraphRange>)> {
    let rest = rest.strip_suffix('/').unwrap_or(rest);
    let (head, paragraphs) = match rest.split_once('/') {
        Some((head, paragraphs)) => (head, Some(paragraphs)),
        None => (rest, None),
    };
    let (code, doc_id) = head.split_once(':')?;
    let paragraphs = match paragraphs {
        None => None,
        Some(p) => {
            let (first, last) = p.split_once('-').unwrap_or((p, p));
            Some((number(first)?, number(last)?))
        }
    };
    Some((code, number(doc_id)?, paragraphs))
}

/// The `BibleVerseId` of a verse of `bible`. No such chapter or verse =>
/// `NotFound`.
fn bible_verse_id(
    bible: &Publication,
    book: u32,
    chapter: u32,
    verse: u32,
) -> Result<i64, CoreError> {
    let row = bible
        .bible_chapter(book, chapter)?
        .ok_or(CoreError::NotFound)?;
    for v in bible.bible_verses(row.first_verse_id, row.last_verse_id)? {
        let content = bible.decrypt(&v.content)?;
        if verse_number(&content, book, chapter).ok_or(CoreError::Corrupt)? == verse {
            return Ok(v.bible_verse_id);
        }
    }
    Err(CoreError::NotFound)
}

/// The verse a guide entry is for, from its header's
/// `href="jwpub://b/<symbol>/<b>:<c>:<v>-<b>:<c>:<v>"`; `None` unless that
/// names a single verse.
fn entry_verse(header: &str) -> Option<VerseRef> {
    const HREF: &str = "href=\"jwpub://b/";
    let rest = &header[header.find(HREF)? + HREF.len()..];
    let (_, start, end) = bible_link(&rest[..rest.find('"')?])?;
    (start == end).then_some(start)
}

/// The availability of a study publication that is not installed, from the
/// key the catalog lists it under (`None` when it lists none, or there is no
/// catalog).
fn listed_availability(pub_key: Option<String>) -> StudyAvailability {
    match pub_key {
        Some(pub_key) => StudyAvailability::NotInstalled { pub_key },
        None => StudyAvailability::Unavailable,
    }
}

/// One reference of a guide entry.
struct StudyLink<'a> {
    /// From the link `<div` through the source `</div>`, in bytes.
    begin: usize,
    end: usize,
    /// The link's content (HTML).
    text: &'a str,
    /// The source `<div>`, tags included (HTML).
    source: &'a str,
    /// The link's `data-xtid` and `href`, if it has them.
    xtid: Option<&'a str>,
    href: Option<&'a str>,
}

/// The references of a guide entry's content, in order: each a `<div>`
/// holding one `<a class="xt">` link, then a `<div>` naming the source, with
/// only whitespace and empty `<p>` elements around them. Anything else =>
/// `Corrupt`.
fn study_links(html: &str) -> Result<Vec<StudyLink<'_>>, CoreError> {
    let mut links = Vec::new();
    let mut at = skip_blank(html, 0);
    while at < html.len() {
        let link_end = div_end(html, at).ok_or(CoreError::Corrupt)?;
        let (tag, text) = xt_link(&html[at..link_end]).ok_or(CoreError::Corrupt)?;
        let source = skip_blank(html, link_end);
        let source_end = div_end(html, source).ok_or(CoreError::Corrupt)?;
        if html[source..source_end].contains("<a ") {
            return Err(CoreError::Corrupt);
        }
        links.push(StudyLink {
            begin: at,
            end: source_end,
            text,
            source: &html[source..source_end],
            xtid: attribute(tag, "data-xtid"),
            href: attribute(tag, "href"),
        });
        at = skip_blank(html, source_end);
    }
    Ok(links)
}

/// `at` moved past any whitespace and empty `<p ...></p>` elements.
fn skip_blank(html: &str, mut at: usize) -> usize {
    loop {
        at = html.len() - html[at..].trim_start().len();
        let rest = &html[at..];
        let empty_p = rest
            .starts_with("<p ")
            .then(|| rest.find('>'))
            .flatten()
            .filter(|&gt| rest[gt + 1..].starts_with("</p>"))
            .map(|gt| gt + 1 + "</p>".len());
        match empty_p {
            Some(len) => at += len,
            None => return at,
        }
    }
}

/// The end of the `<div>` element at `at`, if there is one.
fn div_end(html: &str, at: usize) -> Option<usize> {
    let rest = &html[at..];
    (rest.starts_with("<div ") || rest.starts_with("<div>"))
        .then(|| element_end(html, at, "div"))
        .flatten()
}

/// The opening tag and content of the only `<a>` in `div`, if it is
/// `class="xt"`.
fn xt_link(div: &str) -> Option<(&str, &str)> {
    let begin = div.find("<a ")?;
    let rest = &div[begin..];
    let tag = &rest[..rest.find('>')? + 1];
    let content = &rest[tag.len()..];
    let content = &content[..content.find("</a>")?];
    let only = !div[begin + 1..].contains("<a ");
    (only && attribute(tag, "class") == Some("xt")).then_some((tag, content))
}

/// The value of `name="..."` in an opening tag.
pub(crate) fn attribute<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let key = format!(" {name}=\"");
    let rest = &tag[tag.find(&key)? + key.len()..];
    Some(&rest[..rest.find('"')?])
}

/// Where a reference's link points: the first paragraph of its first
/// `$`-separated target, in the publication its `Extract` row's
/// `RefPublication` names. `None` when there is no such row or it names no
/// publication, or the link has no `data-xtid` or no `jwpub://p/` target. An
/// `Extract` for another document than the link's => `Corrupt`.
fn study_target(guide: &Publication, link: &StudyLink) -> Result<Option<Location>, CoreError> {
    let target = link
        .href
        .and_then(|h| h.strip_prefix("jwpub://"))
        .and_then(|h| h.split('$').next())
        .and_then(|h| h.strip_prefix("p/"))
        .and_then(document_link);
    let (Some(xtid), Some((_, doc_id, paragraphs))) = (link.xtid.and_then(number), target) else {
        return Ok(None);
    };
    let Some(extract) = guide.extract_ref(xtid)? else {
        return Ok(None);
    };
    match extract.ref_meps_document_id {
        Some(id) if id != doc_id => return Err(CoreError::Corrupt),
        Some(_) => {}
        None => return Ok(None),
    }
    let (Some(symbol), Some(lang), Some(issue)) =
        (extract.symbol, extract.meps_language, extract.issue_tag)
    else {
        return Ok(None);
    };
    Ok(Some(Location {
        pub_key: format_pub_key(&symbol, lang, issue),
        doc_id: Some(doc_id),
        book: None,
        chapter: None,
        verse: None,
        paragraph: paragraphs.map(|p| p.0),
    }))
}

/// The key of the NWT Study Edition to take `bible`'s study notes from:
/// `bible` itself if it is one, else the first installed in its language;
/// `None` if there is none. `bible` (installed as `bible_key`) not a Bible
/// => `Invalid`.
fn study_bible(
    library: &Library,
    bible: &Publication,
    bible_key: &str,
) -> Result<Option<String>, CoreError> {
    let installed = library.installed()?;
    if !installed
        .iter()
        .any(|p| p.pub_key == bible_key && p.kind == PubKind::Bible)
    {
        return Err(CoreError::Invalid(format!("not a Bible: {bible_key:?}")));
    }
    if bible.meta().symbol == STUDY_BIBLE {
        return Ok(Some(bible_key.to_string()));
    }
    let language = bible.meta().meps_language;
    Ok(installed
        .into_iter()
        .find(|p| p.symbol == STUDY_BIBLE && p.meps_language == language)
        .map(|p| p.pub_key))
}

/// The footnote and cross-reference markers of one verse, with the rows
/// they open.
struct VerseMarkers {
    verse: u32,
    /// Each footnote marker's letter and its `Footnote` row.
    footnotes: Vec<(String, jwpub::Footnote)>,
    /// Each cross-reference marker's letter with each of its `BibleCitation`
    /// rows, by `ElementNumber`.
    cross_refs: Vec<(String, jwpub::BibleCitation)>,
}

/// The markers of every verse of a chapter of `bible`, in verse order; see
/// the module docs. No such chapter => `NotFound`; a marker without its
/// rows, or with rows for another verse => `Corrupt`.
fn chapter_markers(
    bible: &Publication,
    book: u32,
    chapter: u32,
) -> Result<Vec<VerseMarkers>, CoreError> {
    let row = bible
        .bible_chapter(book, chapter)?
        .ok_or(CoreError::NotFound)?;
    let html = bible.decrypt(&row.content.ok_or(CoreError::NotFound)?)?;
    let document_id = bible
        .bible_books()?
        .into_iter()
        .find(|b| b.bible_book_id == i64::from(book))
        .ok_or(CoreError::Corrupt)?
        .book_document_id;
    let footnotes: HashMap<i64, jwpub::Footnote> = bible
        .footnotes(document_id)?
        .into_iter()
        .map(|f| (f.footnote_index, f))
        .collect();
    let mut citations: HashMap<i64, Vec<jwpub::BibleCitation>> = HashMap::new();
    for c in bible.bible_citations(document_id)? {
        if let Some(block) = c.block_number {
            citations.entry(block).or_default().push(c);
        }
    }
    for rows in citations.values_mut() {
        rows.sort_by_key(|c| c.element_number);
    }

    let ids = verse_ids(bible, book, chapter)?;
    let mut verses: Vec<VerseMarkers> = ids
        .iter()
        .map(|&(verse, _)| VerseMarkers {
            verse,
            footnotes: Vec::new(),
            cross_refs: Vec::new(),
        })
        .collect();
    for (verse, begin, end) in verse_parts(&html, book, chapter)? {
        let at = ids
            .iter()
            .position(|v| v.0 == verse)
            .ok_or(CoreError::Corrupt)?;
        let verse_id = Some(ids[at].1);
        for (cross_ref, id, letter) in markers(&html[begin..end])? {
            if cross_ref {
                let rows = citations.get(&id).ok_or(CoreError::Corrupt)?;
                if rows.iter().any(|r| r.bible_verse_id != verse_id) {
                    return Err(CoreError::Corrupt);
                }
                let mine = rows.iter().map(|r| (letter.clone(), r.clone()));
                verses[at].cross_refs.extend(mine);
            } else {
                let row = footnotes.get(&id).ok_or(CoreError::Corrupt)?;
                if row.bible_verse_id != verse_id {
                    return Err(CoreError::Corrupt);
                }
                verses[at].footnotes.push((letter, row.clone()));
            }
        }
    }
    Ok(verses)
}

/// The footnote (`fn`) and cross-reference (`m`) markers in a verse part's
/// HTML, the ones [`inline_run`] takes out, in order: whether it is a cross
/// reference, its `data-fnid` or `data-mid`, and its letter. A marker
/// without its id, or an unclosed `<span>` => `Corrupt`.
fn markers(html: &str) -> Result<Vec<(bool, i64, String)>, CoreError> {
    let mut found = Vec::new();
    let mut at = 0;
    while let Some(i) = html[at..].find("<span ") {
        let begin = at + i;
        let tag = &html[begin..begin + html[begin..].find('>').ok_or(CoreError::Corrupt)? + 1];
        let (cross_ref, id) = match attribute(tag, "class") {
            Some("fn" | "fn pr") => (false, "data-fnid"),
            Some("m" | "m pr") => (true, "data-mid"),
            _ => {
                at = begin + tag.len();
                continue;
            }
        };
        let id = attribute(tag, id)
            .and_then(number)
            .ok_or(CoreError::Corrupt)?;
        let end = element_end(html, begin, "span").ok_or(CoreError::Corrupt)?;
        found.push((
            cross_ref,
            id,
            plain_text(&html[begin..end]).trim().to_string(),
        ));
        at = end;
    }
    Ok(found)
}

/// The verses of a chapter of `bible` as `(verse, BibleVerseId)`, in
/// order. No such chapter => `NotFound`.
fn verse_ids(bible: &Publication, book: u32, chapter: u32) -> Result<Vec<(u32, i64)>, CoreError> {
    let row = bible
        .bible_chapter(book, chapter)?
        .ok_or(CoreError::NotFound)?;
    bible
        .bible_verses(row.first_verse_id, row.last_verse_id)?
        .into_iter()
        .map(|v| {
            let content = bible.decrypt(&v.content)?;
            let verse = verse_number(&content, book, chapter).ok_or(CoreError::Corrupt)?;
            Ok((verse, v.bible_verse_id))
        })
        .collect()
}

/// Where a cross reference's `BibleCitation` row points in `bible`
/// (installed as `pub_key`), from its `FirstBibleVerseId` through its
/// `LastBibleVerseId`, and the text of those verses. A verse the Bible does
/// not have, or a range that is reversed or crosses books => `Corrupt`.
fn cross_ref_target(
    bible: &Publication,
    pub_key: &str,
    books: &[jwpub::BibleBook],
    documents: &HashMap<i64, DocumentSummary>,
    row: &jwpub::BibleCitation,
) -> Result<(LocationSpan, Option<String>), CoreError> {
    let (Some(first), Some(last)) = (row.first_bible_verse_id, row.last_bible_verse_id) else {
        return Err(CoreError::Corrupt);
    };
    if last < first {
        return Err(CoreError::Corrupt);
    }
    let rows = bible.bible_verses(first, last)?;
    if i64::try_from(rows.len()).ok() != Some(last - first + 1) {
        return Err(CoreError::Corrupt);
    }
    let contents = rows
        .iter()
        .map(|v| bible.decrypt(&v.content))
        .collect::<Result<Vec<_>, _>>()?;
    let point = |id: i64, content: &str| -> Result<Location, CoreError> {
        let (book, chapter) = bible
            .bible_chapter_of_verse(id)?
            .ok_or(CoreError::Corrupt)?;
        let verse = verse_number(content, book, chapter).ok_or(CoreError::Corrupt)?;
        let doc = books
            .iter()
            .find(|b| b.bible_book_id == i64::from(book))
            .and_then(|b| documents.get(&b.book_document_id))
            .ok_or(CoreError::Corrupt)?;
        Ok(bible_point(pub_key, doc, book, chapter, Some(verse)))
    };
    let start = point(first, &contents[0])?;
    let end = point(last, &contents[contents.len() - 1])?;
    if start.book != end.book {
        return Err(CoreError::Corrupt);
    }
    let snippet = contents
        .iter()
        .map(|c| plain_text(c).trim().to_string())
        .filter(|t| !t.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    Ok((
        LocationSpan { start, end },
        (!snippet.is_empty()).then_some(snippet),
    ))
}

/// The study notes on the verses of a chapter of the NWT Study Edition
/// `sty`, by verse number (verses without notes left out); none if it has
/// no such chapter. An entry whose header names another verse, or one not
/// shaped as described => `Corrupt`.
fn chapter_study_notes(
    sty: &Publication,
    book: u32,
    chapter: u32,
) -> Result<HashMap<u32, Vec<StudyNote>>, CoreError> {
    let ids = match verse_ids(sty, book, chapter) {
        Err(CoreError::NotFound) => return Ok(HashMap::new()),
        ids => ids?,
    };
    let mut notes = HashMap::new();
    for (verse, verse_id) in ids {
        let mut mine = Vec::new();
        for entry in sty.verse_commentaries_for(verse_id)? {
            let header = entry.label.as_deref().ok_or(CoreError::Corrupt)?;
            if entry_verse(header) != Some((book, chapter, verse)) {
                return Err(CoreError::Corrupt);
            }
            let html = sty.decrypt(entry.content.as_deref().ok_or(CoreError::Corrupt)?)?;
            mine.extend(study_notes(&html)?);
        }
        if !mine.is_empty() {
            notes.insert(verse, mine);
        }
    }
    Ok(notes)
}

/// The notes of a Study Edition entry's content: `<p>` elements with only
/// whitespace between them. A paragraph that opens with a lemma (see
/// [`lemma`]) starts a note, the lemma its label and the rest its text; so
/// does a `p.sn` heading (`7:53`, a verse the Bible omits), with the
/// heading as its label. Any other paragraph continues the note before it
/// on a new line, or starts one with an empty label. Anything but a `<p>`,
/// or an unclosed one => `Corrupt`.
fn study_notes(html: &str) -> Result<Vec<StudyNote>, CoreError> {
    let mut notes: Vec<StudyNote> = Vec::new();
    let mut at = 0;
    loop {
        at = html.len() - html[at..].trim_start().len();
        if at == html.len() {
            return Ok(notes);
        }
        let rest = &html[at..];
        if !rest.starts_with("<p ") && !rest.starts_with("<p>") {
            return Err(CoreError::Corrupt);
        }
        let tag = &rest[..rest.find('>').ok_or(CoreError::Corrupt)? + 1];
        let end = element_end(html, at, "p").ok_or(CoreError::Corrupt)?;
        let content = &html[at + tag.len()..end - "</p>".len()];
        match lemma(content) {
            Some((label, body)) => notes.push(StudyNote {
                label,
                text: plain_text(body).trim().to_string(),
            }),
            None if attribute(tag, "class") == Some("sn") => notes.push(StudyNote {
                label: plain_text(content).trim().to_string(),
                text: String::new(),
            }),
            None => {
                let text = plain_text(content).trim().to_string();
                match notes.last_mut() {
                    _ if text.is_empty() => {}
                    Some(note) if !note.text.is_empty() => {
                        note.text.push('\n');
                        note.text.push_str(&text);
                    }
                    Some(note) => note.text = text,
                    None => notes.push(StudyNote {
                        label: String::new(),
                        text,
                    }),
                }
            }
        }
        at = end;
    }
}

/// A study-note paragraph's lemma, as plain text without its closing `:`,
/// and the rest of the paragraph. The paragraph must open with `<strong>`
/// (after any zero-width space); the lemma runs through the first
/// `</strong>` its text ends with `:` at, so a lemma split across bold runs
/// (`<strong>He is</strong> . . . <strong>the firstborn:</strong>`) is kept
/// whole. `None` without one: a quotation that opens with a bold verse
/// number is not a lemma.
fn lemma(content: &str) -> Option<(String, &str)> {
    let content = content.trim_start_matches(|c: char| c.is_whitespace() || c == '\u{200b}');
    if !content.starts_with("<strong>") {
        return None;
    }
    content.match_indices("</strong>").find_map(|(i, close)| {
        let end = i + close.len();
        let text = plain_text(&content[..end]);
        let label = text.trim_end().strip_suffix(':')?;
        Some((label.trim().to_string(), &content[end..]))
    })
}

/// The publication's table of contents; see [`Reader::toc`].
fn toc(publication: &Publication) -> Result<Vec<TocEntry>, CoreError> {
    let view = publication
        .publication_views()?
        .into_iter()
        .find(|v| v.symbol == TOC_VIEW)
        .ok_or(CoreError::Corrupt)?;
    let items = publication.publication_view_items(view.publication_view_id)?;
    let documents = documents_by_id(publication)?;

    let mut children: HashMap<i64, Vec<&PublicationViewItem>> = HashMap::new();
    for item in &items {
        if item.publication_view_item_id == -1 {
            return Err(CoreError::Corrupt);
        }
        children
            .entry(item.parent_publication_view_item_id)
            .or_default()
            .push(item);
    }
    let mut entries = Vec::with_capacity(items.len());
    toc_walk(&children, &documents, -1, 0, &mut entries)?;
    // Items not reached from the top level would be silently lost.
    if entries.len() != items.len() {
        return Err(CoreError::Corrupt);
    }
    Ok(entries)
}

/// The document a whole publication opens at: the first entry of its table
/// of contents that has a document (for a Watchtower issue, its cover).
/// `None` when no entry has one.
fn start_document(publication: &Publication) -> Result<Option<i64>, CoreError> {
    Ok(toc(publication)?.into_iter().find_map(|e| e.doc_id))
}

/// Where paragraph `paragraph` of the document with local id `document_id`
/// is now, and whether that is exact; see [`Reader::locate`].
fn locate_paragraph(
    publication: &Publication,
    document_id: i64,
    paragraph: u32,
) -> Result<(Option<u32>, bool), CoreError> {
    let mut positioned = Vec::new();
    for p in publication.document_paragraphs(document_id)? {
        if let Some(begin) = p.begin_position {
            let pid = u32::try_from(p.paragraph_index).map_err(|_| CoreError::Corrupt)?;
            positioned.push((pid, begin));
        }
    }
    if positioned.iter().any(|p| p.0 == paragraph) {
        return Ok((Some(paragraph), true));
    }
    let earlier = positioned
        .iter()
        .filter(|p| p.0 < paragraph)
        .map(|p| p.0)
        .max();
    let first = || positioned.iter().min_by_key(|p| p.1).map(|p| p.0);
    Ok((earlier.or_else(first), false))
}

/// Where the Bible location `location` (with a book) is now in `bible`;
/// see [`Reader::locate`].
fn locate_verse(bible: &Publication, location: &Location) -> Result<Located, CoreError> {
    let found = |location: Location, exact| Ok(Located { location, exact });
    let Some(book) = location.book else {
        return Err(CoreError::Invalid(format!(
            "not a Bible location: {location:?}"
        )));
    };
    let chapters: Vec<u32> = bible
        .bible_chapter_numbers()?
        .into_iter()
        .filter(|c| c.0 == book)
        .map(|c| c.1)
        .collect();
    let Some(&first_chapter) = chapters.first() else {
        let publication = Location {
            pub_key: location.pub_key.clone(),
            doc_id: None,
            book: None,
            chapter: None,
            verse: None,
            paragraph: None,
        };
        return found(publication, false);
    };
    let Some(chapter) = location.chapter else {
        return found(location.clone(), true);
    };
    if !chapters.contains(&chapter) {
        let first = Location {
            chapter: Some(first_chapter),
            verse: None,
            ..location.clone()
        };
        return found(first, false);
    }
    let Some(verse) = location.verse else {
        return found(location.clone(), true);
    };
    let verses: Vec<u32> = read_chapter(bible, &location.pub_key, book, chapter)?
        .verses
        .iter()
        .map(|v| v.verse)
        .collect();
    if verses.contains(&verse) {
        return found(location.clone(), true);
    }
    let earlier = verses.iter().copied().filter(|&v| v < verse).max();
    let verse = earlier.or(verses.first().copied());
    found(
        Location {
            verse,
            ..location.clone()
        },
        false,
    )
}

/// Append the entries under `parent`, and their descendants, to `out`.
fn toc_walk(
    children: &HashMap<i64, Vec<&PublicationViewItem>>,
    documents: &HashMap<i64, DocumentSummary>,
    parent: i64,
    depth: u32,
    out: &mut Vec<TocEntry>,
) -> Result<(), CoreError> {
    for item in children.get(&parent).into_iter().flatten() {
        let doc_id = match item.default_document_id {
            -1 => None,
            id => Some(
                documents
                    .get(&id)
                    .ok_or(CoreError::Corrupt)?
                    .meps_document_id,
            ),
        };
        out.push(TocEntry {
            title: item.title.trim().to_string(),
            doc_id,
            depth,
        });
        toc_walk(
            children,
            documents,
            item.publication_view_item_id,
            depth + 1,
            out,
        )?;
    }
    Ok(())
}

/// The publication's documents by local `DocumentId`.
pub(crate) fn documents_by_id(
    publication: &Publication,
) -> Result<HashMap<i64, DocumentSummary>, CoreError> {
    Ok(publication
        .documents()?
        .into_iter()
        .map(|d| (d.document_id, d))
        .collect())
}

/// A book's `ChapterDisplayTitle` when it is a single word (`Psalm`, not
/// `According to John`).
fn chapter_name(book: &jwpub::BibleBook) -> Option<&str> {
    book.chapter_display_title
        .as_deref()
        .filter(|t| t.split_whitespace().count() == 1)
}

/// The document with MEPS id `doc_id`, if the publication has it.
fn find_document(
    publication: &Publication,
    doc_id: i64,
) -> Result<Option<DocumentSummary>, CoreError> {
    let mut found = publication.documents_with_meps_id(doc_id)?;
    if found.len() > 1 {
        return Err(CoreError::Corrupt);
    }
    Ok(found.pop())
}

pub(crate) fn paragraph_anchor(
    html: &str,
    p: DocumentParagraph,
) -> Result<ParagraphAnchor, CoreError> {
    let paragraph = u32::try_from(p.paragraph_index).map_err(|_| CoreError::Corrupt)?;
    let (begin, end) = match (p.begin_position, p.end_position) {
        (Some(begin), Some(end)) => {
            let (begin, end) = paragraph_range(html, paragraph, begin, end)?;
            (Some(begin), Some(end))
        }
        (None, None) => (None, None),
        _ => return Err(CoreError::Corrupt),
    };
    Ok(ParagraphAnchor {
        paragraph,
        label: p.paragraph_number_label.map(|n| n.to_string()),
        begin,
        end,
        text: String::new(),
    })
}

/// Normalize a paragraph's recorded range to its whole element, from the `<`
/// of the opening tag carrying `data-pid="{paragraph}"` through the `>` of
/// its matching closing tag. Publications record either that, or (ll) the
/// element's content: from just after the opening tag to just before the
/// closing tag. Any other range is `Corrupt`.
fn paragraph_range(
    html: &str,
    paragraph: u32,
    begin: i64,
    end: i64,
) -> Result<(u32, u32), CoreError> {
    let (begin, end) = byte_range(html, begin, end)?;
    let (begin, end) = (begin as usize, end as usize);
    let attr = format!(" data-pid=\"{paragraph}\"");
    // The paragraph's opening tag at `at`: its end and element name.
    let opening = |at: usize| -> Option<(usize, &str)> {
        let tag = &html[at..at + html[at..].find('>')? + 1];
        let name = tag.strip_prefix('<')?;
        let name = &name[..name.find(|c: char| !c.is_ascii_alphanumeric())?];
        (!name.is_empty() && tag.contains(&attr)).then_some((at + tag.len(), name))
    };
    let (start, name) = match opening(begin) {
        Some((_, name)) => (begin, name),
        None => {
            let at = html[..begin].rfind('<').ok_or(CoreError::Corrupt)?;
            match opening(at) {
                Some((tag_end, name)) if tag_end == begin => (at, name),
                _ => return Err(CoreError::Corrupt),
            }
        }
    };
    let stop = element_end(html, start, name).ok_or(CoreError::Corrupt)?;
    let close_start = stop - name.len() - "</>".len();
    if end != stop && end != close_start {
        return Err(CoreError::Corrupt);
    }
    let ok = |n: usize| u32::try_from(n).map_err(|_| CoreError::Corrupt);
    Ok((ok(start)?, ok(stop)?))
}

/// Check `begin..end` is a range of whole characters of `html`.
fn byte_range(html: &str, begin: i64, end: i64) -> Result<(u32, u32), CoreError> {
    let ok = |n: i64| {
        usize::try_from(n)
            .ok()
            .filter(|&n| html.is_char_boundary(n))
            .and_then(|n| u32::try_from(n).ok())
    };
    match (ok(begin), ok(end)) {
        (Some(b), Some(e)) if b <= e => Ok((b, e)),
        _ => Err(CoreError::Corrupt),
    }
}

/// The span from `start` to `end()`; `end` is only looked up when `single`
/// is false.
fn span(
    start: Location,
    end: impl FnOnce() -> Result<Location, CoreError>,
    single: bool,
) -> Result<LocationSpan, CoreError> {
    let end = if single { start.clone() } else { end()? };
    Ok(LocationSpan { start, end })
}

/// A Bible location, once its chapter (and verse, if given) is known to
/// exist.
fn bible_location(
    publication: &Publication,
    pub_key: &str,
    book: &jwpub::BibleBook,
    doc: &DocumentSummary,
    chapter: u32,
    verse: Option<u32>,
) -> Result<Location, CoreError> {
    let book = u32::try_from(book.bible_book_id).map_err(|_| CoreError::Corrupt)?;
    let read = read_chapter(publication, pub_key, book, chapter)?;
    if let Some(v) = verse {
        if !read.verses.iter().any(|a| a.verse == v) {
            return Err(CoreError::NotFound);
        }
    }
    Ok(bible_point(pub_key, doc, book, chapter, verse))
}

/// The location of a Bible chapter or verse, unchecked.
fn bible_point(
    pub_key: &str,
    doc: &DocumentSummary,
    book: u32,
    chapter: u32,
    verse: Option<u32>,
) -> Location {
    Location {
        pub_key: pub_key.to_string(),
        doc_id: Some(doc.meps_document_id),
        book: Some(book),
        chapter: Some(chapter),
        verse,
        paragraph: None,
    }
}

pub(crate) fn read_chapter(
    publication: &Publication,
    pub_key: &str,
    book: u32,
    chapter: u32,
) -> Result<BibleChapter, CoreError> {
    let row = publication
        .bible_chapter(book, chapter)?
        .ok_or(CoreError::NotFound)?;
    let html = publication.decrypt(&row.content.ok_or(CoreError::NotFound)?)?;
    let parts = verse_parts(&html, book, chapter)?;

    let rows = publication.bible_verses(row.first_verse_id, row.last_verse_id)?;
    if i64::try_from(rows.len()).ok() != Some(row.last_verse_id - row.first_verse_id + 1) {
        return Err(CoreError::Corrupt);
    }
    let mut verses: Vec<VerseAnchor> = Vec::with_capacity(rows.len());
    for v in rows {
        let content = publication.decrypt(&v.content)?;
        let verse = verse_number(&content, book, chapter).ok_or(CoreError::Corrupt)?;
        if verses.last().is_some_and(|last| last.verse >= verse) {
            return Err(CoreError::Corrupt);
        }
        let mine = parts.iter().filter(|p| p.0 == verse);
        let begin = mine.clone().map(|p| p.1).min().ok_or(CoreError::Corrupt)?;
        let end = mine.map(|p| p.2).max().ok_or(CoreError::Corrupt)?;
        verses.push(VerseAnchor {
            verse,
            label: plain_text(&v.label).trim().to_string(),
            // Filled in from the blocks below.
            text: String::new(),
            begin: u32::try_from(begin).map_err(|_| CoreError::Corrupt)?,
            end: u32::try_from(end).map_err(|_| CoreError::Corrupt)?,
        });
    }
    if parts.iter().any(|p| !verses.iter().any(|v| v.verse == p.0)) {
        return Err(CoreError::Corrupt);
    }
    let decrypt = |blob: Option<Vec<u8>>| match blob {
        Some(blob) => publication.decrypt(&blob),
        None => Ok(String::new()),
    };
    let verse_prefix = format!("<span id=\"v{book}-{chapter}-");
    let mut blocks = Vec::new();
    chapter_blocks(
        &decrypt(row.pre_content)?,
        &verse_prefix,
        false,
        &mut blocks,
    )?;
    chapter_blocks(&html, &verse_prefix, false, &mut blocks)?;
    chapter_blocks(
        &decrypt(row.post_content)?,
        &verse_prefix,
        true,
        &mut blocks,
    )?;
    for verse in &mut verses {
        let runs: Vec<&str> = blocks
            .iter()
            .filter_map(|b| match b {
                ChapterBlock::Paragraph { style, runs, .. } if *style != ParagraphStyle::Note => {
                    Some(runs)
                }
                _ => None,
            })
            .flatten()
            .filter(|r| r.verse == verse.verse)
            .map(|r| r.text.as_str())
            .collect();
        verse.text = runs.join(" ");
    }
    Ok(BibleChapter {
        pub_key: pub_key.to_string(),
        book,
        chapter,
        html,
        verses,
        blocks,
    })
}

/// Append the blocks of a chapter's `PreContent`, `Content` or (`post`)
/// `PostContent` HTML to `out`. Outside `PostContent`: `<header>` and
/// classless `<div>` wrappers are looked into, the footnotes'
/// `<div class="groupFootnote">` is skipped, `<h1>` and `p.ss` are headings,
/// and `p.sb`, `p.sl`, `p.sz` and `p.sw` hold verse parts (`verse_prefix`
/// opens one) with only whitespace and empty `pageNum` spans between them.
/// In `PostContent`, `p.ss` and `p.sd` are notes. Anything else, or text
/// between elements => `Corrupt`.
fn chapter_blocks(
    html: &str,
    verse_prefix: &str,
    post: bool,
    out: &mut Vec<ChapterBlock>,
) -> Result<(), CoreError> {
    let mut at = 0;
    loop {
        at = html.len() - html[at..].trim_start().len();
        if at == html.len() {
            return Ok(());
        }
        let rest = &html[at..];
        let tag = &rest[..rest.find('>').ok_or(CoreError::Corrupt)? + 1];
        let name = tag.strip_prefix('<').ok_or(CoreError::Corrupt)?;
        let name = &name[..name
            .find(|c: char| !c.is_ascii_alphanumeric())
            .ok_or(CoreError::Corrupt)?];
        let end = element_end(html, at, name).ok_or(CoreError::Corrupt)?;
        let content = &html[at + tag.len()..end - name.len() - "</>".len()];
        let paragraph = || {
            attribute(tag, "data-pid")
                .and_then(number)
                .ok_or(CoreError::Corrupt)
        };
        let class = attribute(tag, "class");
        match (post, name, class) {
            (false, "header", None) | (false, "div", None) => {
                chapter_blocks(content, verse_prefix, post, out)?
            }
            (false, "div", Some("groupFootnote")) => {}
            (false, "h1", _) | (false, "p", Some("ss")) => out.push(ChapterBlock::Heading {
                text: inline_run(content, 0)?.text,
            }),
            (true, "p", Some("ss" | "sd")) => out.push(ChapterBlock::Paragraph {
                paragraph: paragraph()?,
                style: ParagraphStyle::Note,
                runs: vec![VerseRun {
                    label: None,
                    ..inline_run(content, 0)?
                }],
            }),
            (false, "p", Some(class)) => {
                let style = match class {
                    "sb" => ParagraphStyle::Prose,
                    "sl" => ParagraphStyle::PoetryLine,
                    "sz" => ParagraphStyle::PoetryContinuation,
                    "sw" => ParagraphStyle::Superscription,
                    _ => return Err(CoreError::Corrupt),
                };
                out.push(ChapterBlock::Paragraph {
                    paragraph: paragraph()?,
                    style,
                    runs: verse_runs(content, verse_prefix)?,
                });
            }
            _ => return Err(CoreError::Corrupt),
        }
        at = end;
    }
}

/// The runs of a verse paragraph's content: one per verse part
/// (`<span id="v{book}-{chapter}-{verse}-{part}">`, opened by
/// `verse_prefix`). Only whitespace and empty `pageNum` spans may come
/// between them; anything else => `Corrupt`.
fn verse_runs(html: &str, verse_prefix: &str) -> Result<Vec<VerseRun>, CoreError> {
    let mut runs = Vec::new();
    let mut at = 0;
    loop {
        at = html.len() - html[at..].trim_start().len();
        if at == html.len() {
            return Ok(runs);
        }
        let rest = &html[at..];
        if !rest.starts_with("<span ") {
            return Err(CoreError::Corrupt);
        }
        let tag = &rest[..rest.find('>').ok_or(CoreError::Corrupt)? + 1];
        let end = element_end(html, at, "span").ok_or(CoreError::Corrupt)?;
        let content = &html[at + tag.len()..end - "</span>".len()];
        if let Some(id) = rest.strip_prefix(verse_prefix) {
            let verse = id.split(['-', '"']).next().and_then(number);
            runs.push(inline_run(content, verse.ok_or(CoreError::Corrupt)?)?);
        } else if !(attribute(tag, "class") == Some("pageNum") && content.is_empty()) {
            return Err(CoreError::Corrupt);
        }
        at = end;
    }
}

/// Inline HTML as a run of `verse`: its label (`cl`, `vl`) and its footnote
/// (`fn`) and cross-reference (`m`) markers taken out, the rest as plain
/// text with whitespace runs collapsed to one space and trimmed. An
/// unclosed `<span>` => `Corrupt`.
fn inline_run(html: &str, verse: u32) -> Result<VerseRun, CoreError> {
    let mut run = VerseRun {
        verse,
        label: None,
        text: String::new(),
        footnotes: Vec::new(),
        cross_refs: Vec::new(),
    };
    let mut kept = String::new();
    let mut at = 0;
    while let Some(i) = html[at..].find("<span ") {
        let begin = at + i;
        let tag_len = html[begin..].find('>').ok_or(CoreError::Corrupt)? + 1;
        let end = element_end(html, begin, "span").ok_or(CoreError::Corrupt)?;
        let visible = plain_text(&html[begin..end]).trim().to_string();
        match attribute(&html[begin..begin + tag_len], "class") {
            Some("cl" | "cl noLink" | "vl") => run.label = Some(visible),
            Some("fn" | "fn pr") => run.footnotes.push(visible),
            Some("m" | "m pr") => run.cross_refs.push(visible),
            _ => {
                kept.push_str(&html[at..begin + tag_len]);
                at = begin + tag_len;
                continue;
            }
        }
        kept.push_str(&html[at..begin]);
        at = end;
    }
    kept.push_str(&html[at..]);
    run.text = plain_text(&kept)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    Ok(run)
}

/// The verse parts in a chapter's HTML, `<span id="v{book}-{chapter}-{verse}-{part}">`,
/// as `(verse, begin, end)` byte ranges covering each part's whole element.
fn verse_parts(html: &str, book: u32, chapter: u32) -> Result<Vec<(u32, usize, usize)>, CoreError> {
    let prefix = format!("<span id=\"v{book}-{chapter}-");
    let mut parts = Vec::new();
    let mut from = 0;
    while let Some(i) = html[from..].find(&prefix) {
        let begin = from + i;
        let rest = &html[begin + prefix.len()..];
        let id = &rest[..rest.find('"').ok_or(CoreError::Corrupt)?];
        let (verse, part) = id.split_once('-').ok_or(CoreError::Corrupt)?;
        number::<u32>(part).ok_or(CoreError::Corrupt)?;
        let verse = number(verse).ok_or(CoreError::Corrupt)?;
        let end = element_end(html, begin, "span").ok_or(CoreError::Corrupt)?;
        parts.push((verse, begin, end));
        from = begin + prefix.len();
    }
    Ok(parts)
}

/// The end of the `<{name}>` element starting at `begin`, just past its
/// matching `</{name}>`.
pub(crate) fn element_end(html: &str, begin: usize, name: &str) -> Option<usize> {
    let open = format!("<{name}");
    let close = format!("</{name}>");
    let mut depth = 0usize;
    let mut i = begin;
    loop {
        let rest = &html[i..];
        let c = rest.find(&close)?;
        // The next opening tag of the same element before that close.
        let o = rest[..c].match_indices(&open).map(|(o, _)| o).find(|&o| {
            rest[o + open.len()..]
                .starts_with(|ch: char| ch.is_ascii_whitespace() || ch == '>' || ch == '/')
        });
        match o {
            Some(o) => {
                depth += 1;
                i += o + open.len();
            }
            None => {
                depth = depth.checked_sub(1)?;
                i += c + close.len();
                if depth == 0 {
                    return Some(i);
                }
            }
        }
    }
}

/// The verse number of a `BibleVerse.Content`, `<span id="v{book}-{chapter}-{verse}" ...>`.
fn verse_number(content: &str, book: u32, chapter: u32) -> Option<u32> {
    let rest = content.strip_prefix(&format!("<span id=\"v{book}-{chapter}-"))?;
    number(&rest[..rest.find('"')?])
}

/// HTML as plain text: tags dropped, character references decoded.
pub(crate) fn plain_text(html: &str) -> String {
    let mut text = String::new();
    let mut rest = html;
    while let Some(i) = rest.find('<') {
        text.push_str(&rest[..i]);
        rest = rest[i..].find('>').map_or("", |j| &rest[i + j + 1..]);
    }
    text.push_str(rest);
    decode_references(&text)
}

/// Decode `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`, `&nbsp;` and numeric
/// character references; anything else is left as written.
pub(crate) fn decode_references(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let decoded = rest.find(';').and_then(|end| {
            let name = &rest[1..end];
            let c = match name {
                "amp" => '&',
                "lt" => '<',
                "gt" => '>',
                "quot" => '"',
                "apos" => '\'',
                "nbsp" => '\u{a0}',
                _ => {
                    let code = match name.strip_prefix("#x").or(name.strip_prefix("#X")) {
                        Some(hex) => u32::from_str_radix(hex, 16).ok()?,
                        None => name.strip_prefix('#')?.parse().ok()?,
                    };
                    char::from_u32(code)?
                }
            };
            Some((c, end + 1))
        });
        match decoded {
            Some((c, len)) => {
                out.push(c);
                rest = &rest[len..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// A parsed citation; `book` is folded with [`fold`]. `start` and `end` are
/// `(chapter, verse)`, equal for a single verse or chapter; both have no
/// verse for a chapter range.
#[derive(Debug, PartialEq, Eq)]
struct Citation {
    book: String,
    start: (u32, Option<u32>),
    end: (u32, Option<u32>),
}

/// Parse `<book> <chapter>[:<verse>]`, `<book> <chapter>:<verse>-<verse>`,
/// `<book> <chapter>:<verse>-<chapter>:<verse>` or `<book> <chapter>-<chapter>`
/// (an en or em dash also separates a range). Whether a lone number is a
/// chapter or, in a book of one chapter, a verse is for the caller to decide. The book is every word before the first word that
/// starts with a digit and from which on only digits and verse punctuation
/// follow, so `1 John 3:16` has the book `1 John`.
fn parse_citation(reference: &str) -> Result<Citation, CoreError> {
    let invalid = || CoreError::Invalid(format!("not a citation: {reference:?}"));
    let trimmed = reference.trim_end_matches(|c: char| c == '.' || c == ';' || c.is_whitespace());
    // `split_whitespace` also splits at non-breaking spaces.
    let words: Vec<&str> = trimmed.split_whitespace().collect();
    let is_ref = |w: &str| w.chars().all(|c| c.is_ascii_digit() || ":,-–—".contains(c));
    let at = (1..words.len())
        .find(|&i| {
            words[i].starts_with(|c: char| c.is_ascii_digit())
                && words[i..].iter().all(|w| is_ref(w))
        })
        .ok_or_else(invalid)?;
    let numbers = words[at..].join(" ");
    if numbers.contains(',') {
        return Err(CoreError::Invalid(format!("{LISTS}: {reference:?}")));
    }
    let point = |s: &str| -> Result<(u32, Option<u32>), CoreError> {
        Ok(match s.split_once(':') {
            Some((chapter, verse)) => (
                number(chapter).ok_or_else(invalid)?,
                Some(number(verse).ok_or_else(invalid)?),
            ),
            None => (number(s).ok_or_else(invalid)?, None),
        })
    };
    let (start, end) = match numbers.split_once(['-', '–', '—']) {
        None => {
            let p = point(&numbers)?;
            (p, p)
        }
        Some((first, last)) => {
            let start = point(first)?;
            let end = match (start, last.contains(':')) {
                ((_, None), false) => (number(last).ok_or_else(invalid)?, None),
                ((_, None), true) => {
                    return Err(CoreError::Invalid(format!("{MIXED_RANGE}: {reference:?}")))
                }
                (_, true) => point(last)?,
                ((chapter, Some(_)), false) => (chapter, Some(number(last).ok_or_else(invalid)?)),
            };
            if end < start {
                return Err(CoreError::Invalid(format!("{REVERSED}: {reference:?}")));
            }
            (start, end)
        }
    };
    Ok(Citation {
        book: fold(&words[..at].join(" ")),
        start,
        end,
    })
}

/// A non-empty run of ASCII digits as a number.
pub(crate) fn number<T: std::str::FromStr>(s: &str) -> Option<T> {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok()
}

/// A book name for comparison: whitespace runs collapsed to one space,
/// lowercased, and Latin letters stripped of diacritics.
fn fold(name: &str) -> String {
    name.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .flat_map(char::to_lowercase)
        .map(strip_diacritic)
        .collect()
}

/// The base letter of a lowercase Latin letter with a diacritic.
fn strip_diacritic(c: char) -> char {
    match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ă' | 'ą' => 'a',
        'ç' | 'ć' | 'č' => 'c',
        'ď' => 'd',
        'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ė' | 'ę' | 'ě' => 'e',
        'ì' | 'í' | 'î' | 'ï' | 'ī' | 'į' => 'i',
        'ñ' | 'ń' | 'ň' => 'n',
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' | 'ő' => 'o',
        'ř' => 'r',
        'ś' | 'š' | 'ş' => 's',
        'ť' | 'ţ' => 't',
        'ù' | 'ú' | 'û' | 'ü' | 'ū' | 'ů' | 'ű' => 'u',
        'ý' | 'ÿ' => 'y',
        'ź' | 'ż' | 'ž' => 'z',
        c => c,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn citation(book: &str, chapter: u32, verse: Option<u32>) -> Citation {
        range(book, (chapter, verse), (chapter, verse))
    }

    fn range(book: &str, start: (u32, Option<u32>), end: (u32, Option<u32>)) -> Citation {
        Citation {
            book: book.into(),
            start,
            end,
        }
    }

    #[test]
    fn citations_parse() {
        assert_eq!(
            parse_citation("John 3:16").unwrap(),
            citation("john", 3, Some(16))
        );
        assert_eq!(
            parse_citation("  1\u{a0}John  3:16; ").unwrap(),
            citation("1 john", 3, Some(16))
        );
        assert_eq!(
            parse_citation("Psalm 23.").unwrap(),
            citation("psalm", 23, None)
        );
        assert_eq!(
            parse_citation("Génesis 1:1").unwrap(),
            citation("genesis", 1, Some(1))
        );
        assert_eq!(
            parse_citation("Song of Solomon 2:1").unwrap(),
            citation("song of solomon", 2, Some(1))
        );
    }

    #[test]
    fn ranges_parse() {
        for s in ["John 3:16-18", "John 3:16–18", "John 3:16—18"] {
            assert_eq!(
                parse_citation(s).unwrap(),
                range("john", (3, Some(16)), (3, Some(18))),
                "{s:?}"
            );
        }
        assert_eq!(
            parse_citation("John 3:36-4:2").unwrap(),
            range("john", (3, Some(36)), (4, Some(2)))
        );
        assert_eq!(
            parse_citation("John 3:16-3:16").unwrap(),
            citation("john", 3, Some(16))
        );
        assert_eq!(
            parse_citation("Psalm 72:0-20").unwrap(),
            range("psalm", (72, Some(0)), (72, Some(20)))
        );
        assert_eq!(
            parse_citation("John 3–4").unwrap(),
            range("john", (3, None), (4, None))
        );
        assert_eq!(
            parse_citation("John 3-3").unwrap(),
            citation("john", 3, None)
        );
    }

    #[test]
    fn bad_citations_are_invalid() {
        for s in [
            "",
            "3:16",
            "John",
            "John 3:",
            "John :16",
            "John 3:16:1",
            "John 3 16",
            "John x:1",
            "John 3:16a",
            "John 3:16-",
            "John 3:16-18-20",
            "John 3:16-4:",
            "John 3:16 - 18",
        ] {
            match parse_citation(s) {
                Err(CoreError::Invalid(msg)) => {
                    assert!(msg.starts_with("not a citation"), "{s:?}: {msg}")
                }
                other => panic!("{s:?}: {other:?}"),
            }
        }
        for (s, why) in [
            ("John 3:16, 17", LISTS),
            ("John 3:16,17", LISTS),
            ("John 3-4:2", MIXED_RANGE),
            ("John 4-3", REVERSED),
            ("John 3:18-16", REVERSED),
            ("John 4:2-3:36", REVERSED),
        ] {
            match parse_citation(s) {
                Err(CoreError::Invalid(msg)) => assert!(msg.starts_with(why), "{s:?}: {msg}"),
                other => panic!("{s:?}: {other:?}"),
            }
        }
    }

    #[test]
    fn folding() {
        assert_eq!(fold("  Éxodo "), "exodo");
        assert_eq!(fold("NÚMEROS"), "numeros");
        assert_eq!(fold("1\u{a0}\u{a0}Juan"), "1 juan");
    }

    #[test]
    fn spans_end_at_their_matching_close() {
        let html = r#"<p><span id="a">x<span>y</span>z</span> tail</span>"#;
        let begin = html.find("<span").unwrap();
        let end = element_end(html, begin, "span").unwrap();
        assert_eq!(&html[begin..end], r#"<span id="a">x<span>y</span>z</span>"#);
        assert_eq!(element_end("<span>open", 0, "span"), None);
        // `<spanner>` is not a `<span>`.
        let html = "<span><spanner></span>";
        assert_eq!(element_end(html, 0, "span"), Some(html.len()));
    }

    #[test]
    fn paragraph_ranges_cover_the_whole_element() {
        let html =
            r#"<div><p id="p1" data-pid="1"><span>a</span><p>b</p></p><p data-pid="2"></p></div>"#;
        let p1 = html.find("<p id").unwrap();
        let p1_end = html.find("<p data-pid").unwrap();
        let inner = html.find("<span").unwrap();
        let close = p1_end - "</p>".len();
        let p2 = p1_end;
        let p2_inner = p2 + r#"<p data-pid="2">"#.len();
        let r = |pid, b: usize, e: usize| paragraph_range(html, pid, b as i64, e as i64);
        let whole = Some((p1 as u32, p1_end as u32));
        // Whole element, content only, and either mix.
        assert_eq!(r(1, p1, p1_end).ok(), whole);
        assert_eq!(r(1, inner, close).ok(), whole);
        assert_eq!(r(1, p1, close).ok(), whole);
        assert_eq!(r(1, inner, p1_end).ok(), whole);
        // An empty element.
        assert_eq!(
            r(2, p2_inner, p2_inner).ok(),
            Some((p2 as u32, (p2_inner + 4) as u32))
        );
        for (pid, b, e) in [
            (2, p1, p1_end),       // another paragraph's element
            (1, p1 + 1, p1_end),   // inside the opening tag
            (1, inner + 1, close), // inside the content
            (1, p1, close - 1),    // not at the close
            (1, p1, p1_end + 1),   // past the close
            (1, 0, p1_end),        // the parent element
        ] {
            assert!(
                matches!(r(pid, b, e), Err(CoreError::Corrupt)),
                "{pid} {b}..{e}"
            );
        }
    }

    #[test]
    fn plain_text_strips_tags_and_decodes() {
        assert_eq!(
            plain_text(r#"<span id="v1">a <em>b</em> &amp; &#233;&#xE9; &bogus; &</span>"#),
            "a b & éé &bogus; &"
        );
    }

    const LINK: &str = r#"<div id="tt1" class="du-margin-children-bottom--0">
<p id="p2" data-pid="2" class="su"><a class="xt" data-xtid="7" href="jwpub://p/E:2024530/1-23$p/E:2024530/30-30">A &amp; B</a></p>
</div>"#;
    const SOURCE: &str = r#"<div id="tt2" class="du-color--textSubdued"><p id="p3" data-pid="3" class="su"><em>w24.08 p. 2</em></p></div>"#;
    const EMPTY: &str = r#"<p id="p1" data-pid="1" class="su"></p>"#;

    #[test]
    fn study_links_pair_each_link_with_its_source() {
        let html = format!("{EMPTY}\n{LINK}\n{SOURCE}\n{LINK}\n{SOURCE}\n{EMPTY}\n");
        let links = study_links(&html).unwrap();
        assert_eq!(links.len(), 2);
        for link in &links {
            assert_eq!(&html[link.begin..link.end], format!("{LINK}\n{SOURCE}"));
            assert_eq!(link.text, "A &amp; B");
            assert_eq!(link.source, SOURCE);
            assert_eq!(link.xtid, Some("7"));
            assert_eq!(
                link.href,
                Some("jwpub://p/E:2024530/1-23$p/E:2024530/30-30")
            );
        }
        assert!(study_links(&format!("{EMPTY}\n")).unwrap().is_empty());
    }

    #[test]
    fn malformed_study_entries_are_corrupt() {
        let two_links = LINK.replace("</a>", "</a><a class=\"xt\" href=\"x\">C</a>");
        let not_xt = LINK.replace("class=\"xt\"", "class=\"b\"");
        for html in [
            LINK.to_string(),                      // no source
            format!("{SOURCE}\n{LINK}"),           // source first
            format!("{LINK}\n{LINK}\n{SOURCE}"),   // link after link
            format!("{two_links}\n{SOURCE}"),      // two links in one div
            format!("{not_xt}\n{SOURCE}"),         // not an xt link
            format!("{LINK}\n{SOURCE}\ntext"),     // stray text
            format!("{LINK}\n<p>x</p>\n{SOURCE}"), // a non-empty paragraph
            LINK.replace("</div>", ""),            // unclosed div
        ] {
            assert!(
                matches!(study_links(&html), Err(CoreError::Corrupt)),
                "{html}"
            );
        }
    }

    #[test]
    fn entry_headers_name_one_verse() {
        let header = |href: &str| {
            format!(
                r#"<p id="p2" class="su"><a href="jwpub://b/NWTR/{href}" class="b"><strong>3:16</strong></a></p>"#
            )
        };
        assert_eq!(entry_verse(&header("43:3:16-43:3:16")), Some((43, 3, 16)));
        assert_eq!(entry_verse(&header("43:3:16")), Some((43, 3, 16)));
        assert_eq!(entry_verse(&header("43:3:16-43:3:17")), None);
        assert_eq!(entry_verse(&header("43:3")), None);
        assert_eq!(entry_verse("<p>3:16</p>"), None);
    }

    const VERSE: &str = r#"<span id="v1-1-2-1" class="v"><span data-vlid="2" class="vl">2 <span class="tt vl" data-rel-vlid="2"></span></span>Now<span data-fnid="1" class="fn pr">a<span id="footnotesource1" class="tt fn" data-rel-fnid="1"></span></span> the earth<span data-mid="5" class="m">c<span class="tt m" data-rel-mid="5"></span></span> </span>"#;

    fn blocks(html: &str, post: bool) -> Result<Vec<ChapterBlock>, CoreError> {
        let mut out = Vec::new();
        chapter_blocks(html, "<span id=\"v1-1-", post, &mut out).map(|()| out)
    }

    #[test]
    fn chapter_blocks_split_verse_parts_into_runs() {
        let page = r#"<span id="page2" class="pageNum" data-no="2"></span>"#;
        let html = format!(
            "<p id=\"p1\" data-pid=\"1\" class=\"ss\">A &amp; <em>B</em></p>\n\
             <div id=\"p2\" data-pid=\"2\"><p data-pid=\"2\" class=\"sl\">{page} {VERSE}</p></div>\
             <div class=\"groupFootnote\"><p>skipped</p></div>"
        );
        assert_eq!(
            blocks(&html, false).unwrap(),
            [
                ChapterBlock::Heading {
                    text: "A & B".into()
                },
                ChapterBlock::Paragraph {
                    paragraph: 2,
                    style: ParagraphStyle::PoetryLine,
                    runs: vec![VerseRun {
                        verse: 2,
                        label: Some("2".into()),
                        text: "Now the earth".into(),
                        footnotes: vec!["a".into()],
                        cross_refs: vec!["c".into()],
                    }],
                },
            ]
        );
        let note = r#"<p id="p9" data-pid="9" class="sd">The  end.</p>"#;
        assert!(matches!(
            &blocks(note, true).unwrap()[..],
            [ChapterBlock::Paragraph {
                paragraph: 9,
                style: ParagraphStyle::Note,
                runs,
            }] if runs[0].text == "The end." && runs[0].verse == 0
        ));
    }

    #[test]
    fn malformed_chapter_blocks_are_corrupt() {
        let p = |class: &str, content: &str| {
            format!("<p id=\"p1\" data-pid=\"1\" class=\"{class}\">{content}</p>")
        };
        for (html, post) in [
            (p("xx", VERSE), false),                                // unknown class
            (p("sb", &format!("text {VERSE}")), false),             // text outside a verse
            (p("sb", &format!("<em>x</em>{VERSE}")), false),        // a tag outside a verse
            (p("sb", &VERSE.replace("v1-1-", "v1-2-")), false),     // another chapter's verse
            (p("sb", VERSE).replace(" data-pid=\"1\"", ""), false), // no data-pid
            (p("sb", VERSE), true),                                 // a verse after the verses
            (format!("text{}", p("sb", VERSE)), false),             // text between paragraphs
            (p("sb", VERSE).replace("</p>", ""), false),            // unclosed paragraph
        ] {
            assert!(
                matches!(blocks(&html, post), Err(CoreError::Corrupt)),
                "{html}"
            );
        }
    }

    #[test]
    fn markers_are_the_letters_inline_run_takes_out() {
        assert_eq!(
            markers(VERSE).unwrap(),
            [(false, 1, "a".into()), (true, 5, "c".into())]
        );
        let run = inline_run(VERSE, 2).unwrap();
        assert_eq!(
            (run.footnotes, run.cross_refs),
            (vec!["a".into()], vec!["c".into()])
        );
        let no_id = VERSE.replace(" data-mid=\"5\"", "");
        assert!(matches!(markers(&no_id), Err(CoreError::Corrupt)));
    }

    fn note(label: &str, text: &str) -> StudyNote {
        StudyNote {
            label: label.into(),
            text: text.into(),
        }
    }

    #[test]
    fn study_notes_start_at_lemmas() {
        let p = |class: &str, content: &str| {
            format!("<p id=\"p1\" data-pid=\"1\" class=\"{class}\">{content}</p>\r\n")
        };
        let html = [
            p("s5", "Some manuscripts add &amp; read."),
            p("s5", "<strong>loved:</strong> The <em>verb</em>."),
            p("s5", "More on it."),
            p("s5", "<strong><sup>19</sup></strong> A quoted verse."),
            p(
                "s5",
                "\u{200b}<strong>He is</strong> . . . <strong>first:</strong> Body.",
            ),
            p("sn", "<strong>7:53</strong>"),
            p("s5", "On the passage."),
            p("s5", ""),
        ]
        .concat();
        assert_eq!(
            study_notes(&html).unwrap(),
            [
                note("", "Some manuscripts add & read."),
                note("loved", "The verb.\nMore on it.\n19 A quoted verse."),
                note("He is . . . first", "Body."),
                note("7:53", "On the passage."),
            ]
        );
        assert!(study_notes("").unwrap().is_empty());
        for bad in ["text", "<div>x</div>", "<p>unclosed"] {
            assert!(matches!(study_notes(bad), Err(CoreError::Corrupt)), "{bad}");
        }
    }

    #[test]
    fn byte_ranges_are_checked() {
        let html = "aé";
        assert_eq!(byte_range(html, 0, 3).unwrap(), (0, 3));
        for (b, e) in [(0, 2), (2, 1), (-1, 1), (0, 4)] {
            assert!(
                matches!(byte_range(html, b, e), Err(CoreError::Corrupt)),
                "{b}..{e}"
            );
        }
    }
}
