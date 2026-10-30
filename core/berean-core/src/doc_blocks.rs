//! A publication document laid out as plain text: the block tree of
//! [`Document::blocks`](crate::reader::Document::blocks), its inline runs and
//! link targets. See `docs/design/document-blocks.md`.

use crate::notes::Inline;

/// One block of a [`Document`](crate::reader::Document)'s layout.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DocBlock {
    /// `h1`..`h3`. `paragraph` is `None` only for a heading outside any pid
    /// (rsg's section titles).
    Heading {
        level: u8,
        paragraph: Option<u32>,
        inlines: Vec<DocInline>,
    },
    Paragraph {
        paragraph: u32,
        /// The `data-pnum` of its `span.parNum` ("2"), `None` without one.
        number: Option<String>,
        role: ParagraphRole,
        inlines: Vec<DocInline>,
    },
    /// A study question (`p.qu`).
    Question {
        paragraph: u32,
        /// Its leading bold label without the dot ("6-7").
        number: String,
        /// The pids whose `data-rel-pid` names it, in reading order.
        for_paragraphs: Vec<u32>,
        inlines: Vec<DocInline>,
    },
    /// An answer box (`div.gen-field`).
    AnswerField {
        paragraph: u32,
        /// Its textarea's `name` ("textarea-4").
        tag: String,
    },
    Figure {
        image: DocImage,
        /// `Paragraph` blocks; empty without a figcaption.
        caption: Vec<DocBlock>,
    },
    /// A box: `blockTeach` or `boxSupplement` around an `aside`.
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

/// A [`DocBlock::Aside`]'s title (`div.boxTtl`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocTitle {
    pub paragraph: u32,
    pub inlines: Vec<DocInline>,
}

/// A [`DocBlock::Figure`]'s image.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocImage {
    /// The jwpub-media name: "2026520_univ_cnt_1.jpg".
    pub file: String,
    /// The absolute path in the install directory, at read time.
    pub path: String,
    pub alt: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocListItem {
    pub blocks: Vec<DocBlock>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocTableRow {
    pub cells: Vec<DocTableCell>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocTableCell {
    /// A `th`.
    pub header: bool,
    /// At least 1.
    pub colspan: u32,
    pub blocks: Vec<DocBlock>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocFootnote {
    /// Its `data-fnid`, matching [`DocInline::FootnoteRef`]'s `id`.
    pub id: u32,
    /// "a".
    pub marker: String,
    pub paragraph: Option<u32>,
    pub inlines: Vec<DocInline>,
}

/// How a [`DocBlock::Paragraph`] is styled. Any class not listed is `Body`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParagraphRole {
    Body,
    /// `st`.
    Title,
    /// `sd`.
    Summary,
    /// `contextTtl`, `featureTtl`.
    ContextTitle,
    /// `themeScrp`.
    ThemeScripture,
    /// `pubRefs`.
    PublicationReference,
    /// `byline`.
    Byline,
    /// `se`, `sm`, `sn` inside `groupTOC`.
    TocEntry,
}

/// Inline content of a document block. No doc-only case ever sits under a
/// `Common` node.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DocInline {
    /// A case notes can also express, rendered by the shared Inline renderer.
    /// Documents emit only `Text`, `Emphasis` and `Strong` here.
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
        /// The href as written; pass it to `Reader::resolve` on tap.
        url: String,
        target: DocLinkTarget,
    },
    FootnoteRef {
        id: u32,
        marker: String,
    },
    /// Zero width: page `page` of the printed edition starts here. Renderers
    /// may ignore it.
    PageMarker {
        page: String,
    },
}

/// What a [`DocInline::Link`] points at, parsed from its href only.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DocLinkTarget {
    /// `jwpub://b/NWTR/B:C:V-B:C:V`. Parsed only; no Bible is looked up.
    Bible {
        symbol: String,
        start: DocVerse,
        end: DocVerse,
    },
    /// `jwpub://p/E:DOC/[P[-P]]` (and the token and `$` forms). `language`
    /// is the JW code. `first` and `last` are both `None` for a
    /// whole-document link, or both set.
    Document {
        language: String,
        doc_id: i64,
        first: Option<u32>,
        last: Option<u32>,
    },
    /// `jwpub://c/E:DOC/C:V`, a study-note ("commentary") link.
    StudyNote {
        language: String,
        doc_id: i64,
        chapter: u32,
        verse: u32,
    },
    /// An `http`, `https` or `mailto` link.
    External { url: String },
    /// A malformed href, or a `#` href other than a footnote. Still drawn as
    /// a link; a tap shows "Can't open this link" without calling resolve.
    Invalid,
}

/// A verse in a [`DocLinkTarget::Bible`] range.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocVerse {
    pub book: u32,
    pub chapter: u32,
    pub verse: u32,
}
