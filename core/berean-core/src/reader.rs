//! Reader: the table of contents, documents and Bible chapters of installed
//! publications, and resolving citations and `jwpub://` links to a
//! [`LocationSpan`].
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
//! [`Reader::resolve`] returns a [`LocationSpan`], from its `start` through
//! its `end`; a single verse, chapter, document or paragraph gives
//! `start == end`. It takes one of:
//!
//! - A citation: `<book> <chapter>`, `<book> <chapter>:<verse>`, a verse range
//!   in one chapter `<book> <chapter>:<verse>-<verse>`, or one across
//!   chapters `<book> <chapter>:<verse>-<chapter>:<verse>` (an en or em dash
//!   works as well as `-`). A chapter alone (`Psalm 23`) gives a location
//!   with `verse: None` as both start and end. Book names come from each
//!   installed Bible's own tables: the title of the book's document (`John`,
//!   `Psalms`, `1 Juan`), plus its `ChapterDisplayTitle` when that is a
//!   single word (`Psalm`, `Salmos`). Names match ignoring case, runs of
//!   whitespace (non-breaking spaces included) and the diacritics of Latin
//!   letters. Installed Bibles are searched in key order; the first with a
//!   matching book name is used. A trailing `.` or `;` is ignored.
//! - `jwpub://b/<bible>/<book>:<chapter>:<verse>-<book>:<chapter>:<verse>`,
//!   a link to a Bible verse or range of verses (possibly across chapters).
//!   The link names no language, so it resolves against the first installed
//!   Bible, in key order, with the link's symbol (`NWTR` is the `nwt` New
//!   World Translation; no other is known).
//! - `jwpub://p/<code>:<doc_id>/[<paragraph>[-<paragraph>]]`, a link to a
//!   document, or a paragraph or range of paragraphs of it, by JW language
//!   code and MEPS document id. It resolves to the first installed
//!   publication, in key order, in that language holding the document.
//!
//! Both ends of a range must exist, and the end may not come before the
//! start (in Bible order: book, chapter, verse; or paragraph order). Not a
//! single span, and so `Invalid`: a list (`John 3:16, 17`; resolve each part
//! on its own) and a chapter range (`John 3-4`).
//!
//! Errors: a malformed key, citation or link, or a reversed range =>
//! `Invalid`; a publication that is not installed, or an unknown document,
//! book, chapter, verse or paragraph => `NotFound`; publication data that
//! contradicts itself (an anchor out of range or not on its paragraph's
//! element, a verse missing from its chapter, a table of contents that is not
//! a tree) => `Corrupt`.
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
//! (e.g. `w24.08 pp. 2-6`). Empty `<p>` elements between them are skipped;
//! anything else => `Corrupt`. A link's target is the first paragraph of its
//! first `$`-separated `jwpub://p/` target, in the publication its
//! `Extract` row's `RefPublication` names.

use std::collections::HashMap;
use std::sync::Arc;

use crate::catalog::{Catalog, CatalogFilter};
use crate::jwpub::{
    BibleBook, DocumentParagraph, DocumentSummary, Publication, PublicationViewItem,
};
use crate::languages;
use crate::library::{format_pub_key, Library, PubKind, PublicationSummary};
use crate::{CoreError, Inner};

/// The `PublicationView` whose items are the table of contents.
const TOC_VIEW: &str = "jwpub";

const LISTS: &str = "a list of references is not a single span; resolve each part on its own";
const REVERSED: &str = "range ends before it starts";
const CHAPTER_RANGES: &str = "chapter ranges are not supported";
const NOT_A_VERSE: &str =
    "study references need a Bible verse: a Bible's key, book, chapter and verse, no paragraph";

/// The Research Guide's publication symbol.
const GUIDE: &str = "rsg";

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
}

/// One verse of a [`BibleChapter`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerseAnchor {
    pub verse: u32,
    /// The label printed at the verse: its number, the chapter number for a
    /// chapter's first verse, empty for a superscription.
    pub label: String,
    /// The verse as plain text.
    pub text: String,
    /// The byte range in the chapter's HTML from the start of the verse's
    /// first part to the end of its last (a verse may be split across
    /// paragraphs).
    pub begin: u32,
    pub end: u32,
}

/// Whether the Research Guide in a Bible's language is installed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StudyAvailability {
    Installed,
    /// Not installed; the catalog lists it as `pub_key`, to download.
    NotInstalled {
        pub_key: String,
    },
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
    /// The guide's HTML for the reference: from the `<div` holding the link
    /// through the `</div>` of the one naming its source.
    pub html: String,
    /// The first paragraph the link targets, in the publication the guide
    /// says it quotes (which need not be installed). `None` when the guide
    /// does not say which publication that is.
    pub target: Option<Location>,
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
        self.library().with_publication(pub_key, |publication| {
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
        })
    }

    /// The document with MEPS id `doc_id` in the installed publication
    /// `pub_key`. Malformed key => `Invalid`; not installed, or no such
    /// document (or one without content) => `NotFound`.
    pub fn document(&self, pub_key: &str, doc_id: i64) -> Result<Document, CoreError> {
        self.library().with_publication(pub_key, |publication| {
            let summary = find_document(publication, doc_id)?.ok_or(CoreError::NotFound)?;
            let html = publication.document_html(summary.document_id)?;
            let paragraphs = publication
                .document_paragraphs(summary.document_id)?
                .into_iter()
                .map(|p| paragraph_anchor(&html, p))
                .collect::<Result<_, _>>()?;
            Ok(Document {
                doc_id,
                title: summary.title,
                html,
                paragraphs,
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

    /// Resolve a citation or `jwpub://` link to the span of locations it
    /// names; see the module docs for the forms accepted.
    pub fn resolve(&self, reference: &str) -> Result<LocationSpan, CoreError> {
        let reference = reference.trim();
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
    /// there is no catalog) => `NotFound`. A guide entry for another verse,
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
                .find(|p| p.symbol == GUIDE)
                .ok_or(CoreError::NotFound)?;
            return Ok(StudyReferences {
                availability: StudyAvailability::NotInstalled {
                    pub_key: listed.pub_key,
                },
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
                        let single_word = book
                            .chapter_display_title
                            .as_deref()
                            .filter(|t| t.split_whitespace().count() == 1);
                        let matches = std::iter::once(doc.title.as_str())
                            .chain(single_word)
                            .any(|name| fold(name) == citation.book);
                        if matches {
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
                            return span(
                                at(citation.start)?,
                                || at(citation.end),
                                citation.start == citation.end,
                            )
                            .map(Some);
                        }
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

/// Split the part of a Bible link after `jwpub://b/`,
/// `<symbol>/<book>:<chapter>:<verse>[-<book>:<chapter>:<verse>]`, into its
/// symbol and its first and last verse.
fn bible_link(rest: &str) -> Option<(&str, VerseRef, VerseRef)> {
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
fn document_link(rest: &str) -> Option<(&str, i64, Option<ParagraphRange>)> {
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

/// One reference of a guide entry.
struct StudyLink<'a> {
    /// From the link `<div` through the source `</div>`, in bytes.
    begin: usize,
    end: usize,
    /// The link's content (HTML).
    text: &'a str,
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
fn attribute<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
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
fn documents_by_id(publication: &Publication) -> Result<HashMap<i64, DocumentSummary>, CoreError> {
    Ok(publication
        .documents()?
        .into_iter()
        .map(|d| (d.document_id, d))
        .collect())
}

/// The document with MEPS id `doc_id`, if the publication has it.
fn find_document(
    publication: &Publication,
    doc_id: i64,
) -> Result<Option<DocumentSummary>, CoreError> {
    let mut found = publication
        .documents()?
        .into_iter()
        .filter(|d| d.meps_document_id == doc_id);
    let doc = found.next();
    if found.next().is_some() {
        return Err(CoreError::Corrupt);
    }
    Ok(doc)
}

fn paragraph_anchor(html: &str, p: DocumentParagraph) -> Result<ParagraphAnchor, CoreError> {
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
    book: &BibleBook,
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
    Ok(Location {
        pub_key: pub_key.to_string(),
        doc_id: Some(doc.meps_document_id),
        book: Some(book),
        chapter: Some(chapter),
        verse,
        paragraph: None,
    })
}

fn read_chapter(
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
            text: plain_text(&content).trim().to_string(),
            begin: u32::try_from(begin).map_err(|_| CoreError::Corrupt)?,
            end: u32::try_from(end).map_err(|_| CoreError::Corrupt)?,
        });
    }
    if parts.iter().any(|p| !verses.iter().any(|v| v.verse == p.0)) {
        return Err(CoreError::Corrupt);
    }
    Ok(BibleChapter {
        pub_key: pub_key.to_string(),
        book,
        chapter,
        html,
        verses,
    })
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
fn element_end(html: &str, begin: usize, name: &str) -> Option<usize> {
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
fn plain_text(html: &str) -> String {
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
fn decode_references(text: &str) -> String {
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
/// `(chapter, verse)`, equal for a single verse or chapter.
#[derive(Debug, PartialEq, Eq)]
struct Citation {
    book: String,
    start: (u32, Option<u32>),
    end: (u32, Option<u32>),
}

/// Parse `<book> <chapter>[:<verse>]`, `<book> <chapter>:<verse>-<verse>` or
/// `<book> <chapter>:<verse>-<chapter>:<verse>` (an en or em dash also
/// separates a range). The book is every word before the first word that
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
                ((_, None), _) => {
                    return Err(CoreError::Invalid(format!(
                        "{CHAPTER_RANGES}: {reference:?}"
                    )))
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
fn number<T: std::str::FromStr>(s: &str) -> Option<T> {
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
            ("John 3-4", CHAPTER_RANGES),
            ("John 3-4:2", CHAPTER_RANGES),
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
