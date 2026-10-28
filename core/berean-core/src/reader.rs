//! Reader: the table of contents, documents and Bible chapters of installed
//! publications, and resolving citations and `jwpub://` links to a
//! [`Location`].
//!
//! A document is named by its MEPS document id (`Document.MepsDocumentId`),
//! never by the publication's local `DocumentId`: the MEPS id stays the same
//! across reinstalls, and JW Library keys user data by it too. A MEPS id is
//! only unique within one publication, so [`Reader::document`] takes the
//! publication's key as well as the id.
//!
//! Anchors (`begin`, `end`) are byte offsets into the HTML they come with.
//!
//! # Resolving
//!
//! [`Reader::resolve`] takes one of:
//!
//! - A citation, `<book> <chapter>:<verse>` or `<book> <chapter>`. Book names
//!   come from each installed Bible's own tables: the title of the book's
//!   document (`John`, `Psalms`, `1 Juan`), plus its `ChapterDisplayTitle`
//!   when that is a single word (`Psalm`, `Salmos`). Names match ignoring
//!   case, runs of whitespace (non-breaking spaces included) and the
//!   diacritics of Latin letters. Installed Bibles are searched in key order;
//!   the first with a matching book name is used. A trailing `.` or `;` is
//!   ignored.
//! - `jwpub://b/<bible>/<book>:<chapter>:<verse>-<book>:<chapter>:<verse>`,
//!   a link to a Bible verse. The link names no language, so it resolves
//!   against the first installed Bible, in key order, with the link's symbol
//!   (`NWTR` is the `nwt` New World Translation; no other is known).
//! - `jwpub://p/<code>:<doc_id>/[<paragraph>]`, a link to a document, by JW
//!   language code and MEPS document id. It resolves to the first installed
//!   publication, in key order, in that language holding the document.
//!
//! A [`Location`] is a single point, so a verse or paragraph span
//! (`John 3:16-18`, `John 3:16, 17`, a link whose ends differ) is `Invalid`
//! for now.
//!
//! Errors: a malformed key, citation or link => `Invalid`; a publication that
//! is not installed, or an unknown document, book, chapter, verse or
//! paragraph => `NotFound`; publication data that contradicts itself (an
//! anchor out of range, a verse missing from its chapter, a table of
//! contents that is not a tree) => `Corrupt`.

use std::collections::HashMap;
use std::sync::Arc;

use crate::jwpub::{
    BibleBook, DocumentParagraph, DocumentSummary, Publication, PublicationViewItem,
};
use crate::languages;
use crate::library::{Library, PubKind, PublicationSummary};
use crate::{CoreError, Inner};

/// The `PublicationView` whose items are the table of contents.
const TOC_VIEW: &str = "jwpub";

const SPANS: &str = "verse and paragraph spans are not supported yet";

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
    /// The paragraph's byte range in the HTML, as the publication records it
    /// (`DocumentParagraph.BeginPosition`/`EndPosition`). Depending on the
    /// publication it covers the paragraph's whole element, or starts just
    /// after the element's opening tag. Both are `None` for a paragraph the
    /// publication gives no position for (it does not appear in the HTML).
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
        let publication = self.library().publication(pub_key)?;
        let view = publication
            .publication_views()?
            .into_iter()
            .find(|v| v.symbol == TOC_VIEW)
            .ok_or(CoreError::Corrupt)?;
        let items = publication.publication_view_items(view.publication_view_id)?;
        let documents = documents_by_id(&publication)?;

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

    /// The document with MEPS id `doc_id` in the installed publication
    /// `pub_key`. Malformed key => `Invalid`; not installed, or no such
    /// document (or one without content) => `NotFound`.
    pub fn document(&self, pub_key: &str, doc_id: i64) -> Result<Document, CoreError> {
        let publication = self.library().publication(pub_key)?;
        let summary = find_document(&publication, doc_id)?.ok_or(CoreError::NotFound)?;
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
        let publication = self.library().publication(bible)?;
        read_chapter(&publication, bible, book, chapter)
    }

    /// Resolve a citation or `jwpub://` link to a location; see the module
    /// docs for the forms accepted.
    pub fn resolve(&self, reference: &str) -> Result<Location, CoreError> {
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

    fn resolve_citation(&self, reference: &str) -> Result<Location, CoreError> {
        let citation = parse_citation(reference)?;
        for summary in self.installed(|p| p.kind == PubKind::Bible)? {
            let publication = self.library().publication(&summary.pub_key)?;
            let documents = documents_by_id(&publication)?;
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
                    return bible_location(
                        &publication,
                        &summary.pub_key,
                        &book,
                        doc,
                        citation.chapter,
                        citation.verse,
                    );
                }
            }
        }
        Err(CoreError::NotFound)
    }

    fn resolve_bible_link(&self, link: &str, rest: &str) -> Result<Location, CoreError> {
        let invalid = || CoreError::Invalid(format!("malformed Bible link {link:?}"));
        let (symbol, range) = rest.split_once('/').ok_or_else(invalid)?;
        let (start, end) = range.split_once('-').unwrap_or((range, range));
        let verse_ref = |s: &str| -> Option<(u32, u32, u32)> {
            let mut parts = s.split(':');
            let r = (
                number(parts.next()?)?,
                number(parts.next()?)?,
                number(parts.next()?)?,
            );
            parts.next().is_none().then_some(r)
        };
        let (book, chapter, verse) = verse_ref(start).ok_or_else(invalid)?;
        if verse_ref(end).ok_or_else(invalid)? != (book, chapter, verse) {
            return Err(CoreError::Invalid(SPANS.into()));
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
        let publication = self.library().publication(&summary.pub_key)?;
        let book_row = publication
            .bible_books()?
            .into_iter()
            .find(|b| b.bible_book_id == i64::from(book))
            .ok_or(CoreError::NotFound)?;
        let documents = documents_by_id(&publication)?;
        let doc = documents
            .get(&book_row.book_document_id)
            .ok_or(CoreError::Corrupt)?;
        bible_location(
            &publication,
            &summary.pub_key,
            &book_row,
            doc,
            chapter,
            Some(verse),
        )
    }

    fn resolve_document_link(&self, link: &str, rest: &str) -> Result<Location, CoreError> {
        let invalid = || CoreError::Invalid(format!("malformed document link {link:?}"));
        let rest = rest.strip_suffix('/').unwrap_or(rest);
        let (head, paragraph) = match rest.split_once('/') {
            Some((head, paragraph)) => (head, Some(paragraph)),
            None => (rest, None),
        };
        let (code, doc_id) = head.split_once(':').ok_or_else(invalid)?;
        let doc_id: i64 = number(doc_id).ok_or_else(invalid)?;
        let paragraph = match paragraph {
            None => None,
            Some(p) => {
                let (first, last) = p.split_once('-').unwrap_or((p, p));
                let first: u32 = number(first).ok_or_else(invalid)?;
                if number::<u32>(last).ok_or_else(invalid)? != first {
                    return Err(CoreError::Invalid(SPANS.into()));
                }
                Some(first)
            }
        };
        let language = languages::by_code(code).ok_or(CoreError::NotFound)?;
        for summary in self.installed(|p| p.meps_language == language.meps_id)? {
            let publication = self.library().publication(&summary.pub_key)?;
            let Some(doc) = find_document(&publication, doc_id)? else {
                continue;
            };
            if let Some(p) = paragraph {
                let paragraphs = publication.document_paragraphs(doc.document_id)?;
                if !paragraphs.iter().any(|r| r.paragraph_index == i64::from(p)) {
                    return Err(CoreError::NotFound);
                }
            }
            return Ok(Location {
                pub_key: summary.pub_key,
                doc_id: Some(doc.meps_document_id),
                book: None,
                chapter: None,
                verse: None,
                paragraph,
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
    let (begin, end) = match (p.begin_position, p.end_position) {
        (Some(begin), Some(end)) => {
            let (begin, end) = byte_range(html, begin, end)?;
            (Some(begin), Some(end))
        }
        (None, None) => (None, None),
        _ => return Err(CoreError::Corrupt),
    };
    Ok(ParagraphAnchor {
        paragraph: u32::try_from(p.paragraph_index).map_err(|_| CoreError::Corrupt)?,
        label: p.paragraph_number_label.map(|n| n.to_string()),
        begin,
        end,
    })
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
        let end = span_end(html, begin).ok_or(CoreError::Corrupt)?;
        parts.push((verse, begin, end));
        from = begin + prefix.len();
    }
    Ok(parts)
}

/// The end of the `<span>` element starting at `begin`, just past its
/// matching `</span>`.
fn span_end(html: &str, begin: usize) -> Option<usize> {
    const OPEN: &str = "<span";
    const CLOSE: &str = "</span>";
    let mut depth = 0usize;
    let mut i = begin;
    loop {
        let rest = &html[i..];
        match (rest.find(OPEN), rest.find(CLOSE)) {
            (Some(o), Some(c)) if o < c => {
                depth += 1;
                i += o + OPEN.len();
            }
            (_, Some(c)) => {
                depth = depth.checked_sub(1)?;
                i += c + CLOSE.len();
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => return None,
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

/// A parsed citation; `book` is folded with [`fold`].
#[derive(Debug, PartialEq, Eq)]
struct Citation {
    book: String,
    chapter: u32,
    verse: Option<u32>,
}

/// Parse `<book> <chapter>[:<verse>]`. The book is every word before the
/// first word that starts with a digit and from which on only digits and
/// verse punctuation follow, so `1 John 3:16` has the book `1 John`.
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
    if numbers.contains([',', '-', '–', '—']) {
        return Err(CoreError::Invalid(SPANS.into()));
    }
    let (chapter, verse) = match numbers.split_once(':') {
        Some((chapter, verse)) => (chapter, Some(verse)),
        None => (numbers.as_str(), None),
    };
    Ok(Citation {
        book: fold(&words[..at].join(" ")),
        chapter: number(chapter).ok_or_else(invalid)?,
        verse: verse.map(|v| number(v).ok_or_else(invalid)).transpose()?,
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
        Citation {
            book: book.into(),
            chapter,
            verse,
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
        ] {
            assert!(
                matches!(parse_citation(s), Err(CoreError::Invalid(_))),
                "{s:?}"
            );
        }
        for s in ["John 3:16-18", "John 3:16, 17", "John 3:16–18", "John 3-4"] {
            match parse_citation(s) {
                Err(CoreError::Invalid(msg)) => assert_eq!(msg, SPANS, "{s:?}"),
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
        let end = span_end(html, begin).unwrap();
        assert_eq!(&html[begin..end], r#"<span id="a">x<span>y</span>z</span>"#);
        assert_eq!(span_end("<span>open", 0), None);
    }

    #[test]
    fn plain_text_strips_tags_and_decodes() {
        assert_eq!(
            plain_text(r#"<span id="v1">a <em>b</em> &amp; &#233;&#xE9; &bogus; &</span>"#),
            "a b & éé &bogus; &"
        );
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
