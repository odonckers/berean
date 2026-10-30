//! A publication document laid out as plain text: the block tree of
//! [`Document::blocks`](crate::reader::Document::blocks), its inline runs and
//! link targets. See `docs/design/document-blocks.md`.
//!
//! The blocks are scanned from the document's HTML, in HTML order. Each
//! element with a positioned paragraph anchor is one block (a heading, a
//! paragraph, a question, an answer field, an aside's title or a footnote);
//! the elements around them are looked into for the containers (figures,
//! asides, lists, tables, footnotes, rules, headings without a paragraph),
//! and every other element is a wrapper whose content is laid out in its
//! place. Inside a block, `strong` and `em` are pushed down onto the text
//! they hold, so a doc-only inline inside them splits the formatting around
//! it instead of sitting under a [`DocInline::Common`]. Any other inline
//! element is transparent: its text is kept. Text has runs of ASCII
//! whitespace collapsed to one space and is trimmed at the block's edges;
//! `label` and `textarea` text is dropped.
//!
//! Errors: an element carrying a `data-pid` that is not a positioned
//! paragraph => `Corrupt`. A shape the scanner does not know is laid out as
//! a wrapper or as plain text, never an error; a `data-rel-pid` naming no
//! question is ignored.

use std::collections::HashMap;
use std::ops::Range;
use std::path::Path;

use crate::jwpub::check_file_name;
use crate::notes::Inline;
use crate::reader::{
    attribute, bible_link, decode_references, document_link, element_end, number, plain_text,
    ParagraphAnchor,
};
use crate::CoreError;

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

impl DocLinkTarget {
    /// What `href` points at, from its text alone:
    /// `jwpub://b/<symbol>/<b>:<c>:<v>[-<b>:<c>:<v>]` is `Bible`;
    /// `jwpub://p/<code>:<doc>/[<p>[-<p>]]` is `Document`, a paragraph's word
    /// token (`360:4`) dropped and only the first of a `$` list taken;
    /// `jwpub://c/<code>:<doc>/<c>:<v>` is `StudyNote`; an `http`, `https`
    /// or `mailto` URL is `External`. Anything else is `Invalid`.
    pub fn from_href(href: &str) -> DocLinkTarget {
        let target = if let Some(rest) = href.strip_prefix("jwpub://b/") {
            bible_target(rest)
        } else if let Some(rest) = href.strip_prefix("jwpub://p/") {
            document_target(rest)
        } else if let Some(rest) = href.strip_prefix("jwpub://c/") {
            study_note_target(rest)
        } else {
            external_target(href)
        };
        target.unwrap_or(DocLinkTarget::Invalid)
    }
}

fn bible_target(rest: &str) -> Option<DocLinkTarget> {
    let (symbol, start, end) = bible_link(rest)?;
    let verse = |(book, chapter, verse)| DocVerse {
        book,
        chapter,
        verse,
    };
    (!symbol.is_empty()).then(|| DocLinkTarget::Bible {
        symbol: symbol.to_string(),
        start: verse(start),
        end: verse(end),
    })
}

fn document_target(rest: &str) -> Option<DocLinkTarget> {
    let first = rest.split('$').next().unwrap_or(rest);
    let (head, paragraphs) = first.split_once('/').unwrap_or((first, ""));
    let paragraphs: Vec<&str> = paragraphs
        .split('-')
        .map(|p| p.split(':').next().unwrap_or(p))
        .collect();
    let link = format!("{head}/{}", paragraphs.join("-"));
    let (code, doc_id, range) = document_link(&link)?;
    (!code.is_empty()).then(|| DocLinkTarget::Document {
        language: code.to_string(),
        doc_id,
        first: range.map(|r| r.0),
        last: range.map(|r| r.1),
    })
}

fn study_note_target(rest: &str) -> Option<DocLinkTarget> {
    let rest = rest.strip_suffix('/').unwrap_or(rest);
    let (head, verse) = rest.split_once('/')?;
    let (code, doc_id) = head.split_once(':')?;
    let (chapter, verse) = verse.split_once(':')?;
    (!code.is_empty()).then_some(DocLinkTarget::StudyNote {
        language: code.to_string(),
        doc_id: number(doc_id)?,
        chapter: number(chapter)?,
        verse: number(verse)?,
    })
}

fn external_target(href: &str) -> Option<DocLinkTarget> {
    let (scheme, _) = href.split_once(':')?;
    ["http", "https", "mailto"]
        .iter()
        .any(|s| scheme.eq_ignore_ascii_case(s))
        .then(|| DocLinkTarget::External {
            url: href.to_string(),
        })
}

/// Elements with no content and no closing tag.
const VOID: [&str; 13] = [
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track",
    "wbr",
];

/// Elements that sit inside a line of text, so outside any paragraph they
/// do not start a block of their own.
const INLINE: [&str; 13] = [
    "a", "abbr", "b", "br", "cite", "em", "i", "q", "small", "span", "strong", "sub", "sup",
];

/// Elements whose text is not part of the document (`label` and `textarea`
/// are the chrome of an answer field).
const DROPPED: [&str; 4] = ["label", "textarea", "script", "style"];

/// The blocks of a document's `html`, given its paragraph anchors (from
/// [`paragraph_anchor`](crate::reader::paragraph_anchor), so each positioned
/// one covers its whole element). `dir` is the directory the publication is
/// installed in, holding its images. See the module docs.
pub(crate) fn document_blocks(
    html: &str,
    paragraphs: &[ParagraphAnchor],
    dir: &Path,
) -> Result<Vec<DocBlock>, CoreError> {
    let mut anchors: Vec<(usize, u32)> = paragraphs
        .iter()
        .filter_map(|p| Some((p.begin? as usize, p.paragraph)))
        .collect();
    anchors.sort_unstable();
    let mut scanner = Scanner {
        html,
        anchors,
        dir,
        questions: Vec::new(),
        title: None,
        pending: Vec::new(),
    };
    let mut blocks = scanner.blocks(0..html.len(), Context::default())?;

    let mut covers: HashMap<u32, Vec<u32>> = HashMap::new();
    for (paragraph, question) in scanner.questions {
        covers.entry(question).or_default().push(paragraph);
    }
    for_each_block(&mut blocks, &mut |block| {
        if let DocBlock::Question {
            paragraph,
            for_paragraphs,
            ..
        } = block
        {
            *for_paragraphs = covers.remove(paragraph).unwrap_or_default();
        }
    });
    Ok(blocks)
}

/// Call `f` on every block in `blocks`, nested ones included.
fn for_each_block(blocks: &mut [DocBlock], f: &mut impl FnMut(&mut DocBlock)) {
    for block in blocks {
        f(block);
        match block {
            DocBlock::Figure { caption, .. } => for_each_block(caption, f),
            DocBlock::Aside { blocks, .. } => for_each_block(blocks, f),
            DocBlock::List { items, .. } => {
                for item in items {
                    for_each_block(&mut item.blocks, f);
                }
            }
            DocBlock::Table { rows } => {
                for cell in rows.iter_mut().flat_map(|r| &mut r.cells) {
                    for_each_block(&mut cell.blocks, f);
                }
            }
            _ => {}
        }
    }
}

/// One piece of HTML: a run of text, an element (or a void or self-closing
/// tag), or something without content (a comment, a stray closing tag).
enum Node<'a> {
    Text(Range<usize>),
    Element(Element<'a>),
    Skip(Range<usize>),
}

struct Element<'a> {
    name: &'a str,
    /// The opening tag.
    tag: &'a str,
    /// The whole element.
    range: Range<usize>,
    /// Its content, between the tags.
    inner: Range<usize>,
}

impl Node<'_> {
    fn range(&self) -> Range<usize> {
        match self {
            Node::Text(r) | Node::Skip(r) => r.clone(),
            Node::Element(e) => e.range.clone(),
        }
    }
}

impl Element<'_> {
    fn has_class(&self, class: &str) -> bool {
        classes(self.tag).any(|c| c == class)
    }
}

fn classes(tag: &str) -> impl Iterator<Item = &str> {
    attribute(tag, "class")
        .unwrap_or("")
        .split_ascii_whitespace()
}

/// The node at `at` in `html[..end]`. An element whose closing tag is
/// missing (or past `end`) runs to `end`.
fn node(html: &str, at: usize, end: usize) -> Node<'_> {
    let rest = &html[at..end];
    if !rest.starts_with('<') {
        return Node::Text(at..at + rest.find('<').unwrap_or(rest.len()));
    }
    if let Some(comment) = rest.strip_prefix("<!--") {
        let len = comment
            .find("-->")
            .map_or(rest.len(), |i| "<!--".len() + i + "-->".len());
        return Node::Skip(at..at + len);
    }
    let name_len = rest[1..]
        .find(|c: char| !c.is_ascii_alphanumeric())
        .unwrap_or(rest.len() - 1);
    let Some(gt) = rest.find('>') else {
        return Node::Text(at..end);
    };
    if name_len == 0 {
        // A closing tag, `<!...>` or `<?...>`; otherwise a `<` in the text.
        return match rest[1..].starts_with(['/', '!', '?']) {
            true => Node::Skip(at..at + gt + 1),
            false => Node::Text(at..at + 1),
        };
    }
    let name = &rest[1..1 + name_len];
    let tag = &rest[..gt + 1];
    let tag_end = at + tag.len();
    let (range, inner) = if VOID.contains(&name) || tag.ends_with("/>") {
        (at..tag_end, tag_end..tag_end)
    } else {
        match element_end(html, at, name).filter(|&e| e <= end) {
            Some(e) => (at..e, tag_end..e - name.len() - "</>".len()),
            None => (at..end, tag_end..end),
        }
    };
    Node::Element(Element {
        name,
        tag,
        range,
        inner,
    })
}

/// What the elements around a block say about it.
#[derive(Clone, Copy, Default)]
struct Context {
    /// Inside `div.groupTOC`.
    toc: bool,
    /// Inside `div.copyrightInfo`.
    copyright: bool,
}

struct Scanner<'a> {
    html: &'a str,
    /// The positioned paragraphs, `(begin, paragraph)` sorted by `begin`.
    anchors: Vec<(usize, u32)>,
    dir: &'a Path,
    /// `(paragraph, question)` for each `data-rel-pid`, in reading order.
    questions: Vec<(u32, u32)>,
    /// Inside an aside, its title once its `div.boxTtl` is seen.
    title: Option<Option<DocTitle>>,
    /// Page markers outside any paragraph, for the next block's inlines.
    pending: Vec<DocInline>,
}

impl<'a> Scanner<'a> {
    /// The paragraph whose element starts at `at`.
    fn paragraph_at(&self, at: usize) -> Option<u32> {
        let i = self.anchors.binary_search_by_key(&at, |a| a.0).ok()?;
        Some(self.anchors[i].1)
    }

    /// Whether a paragraph's element starts in `range`.
    fn has_paragraph(&self, range: &Range<usize>) -> bool {
        let i = self.anchors.partition_point(|a| a.0 < range.start);
        self.anchors.get(i).is_some_and(|a| a.0 < range.end)
    }

    /// The nodes of `range`, without blank text and comments.
    fn children(&self, range: Range<usize>) -> Vec<Node<'a>> {
        let mut nodes = Vec::new();
        let mut at = range.start;
        while at < range.end {
            let node = node(self.html, at, range.end);
            at = node.range().end;
            let blank = match &node {
                Node::Text(r) => self.html[r.clone()].trim_ascii().is_empty(),
                Node::Skip(_) => true,
                Node::Element(_) => false,
            };
            if !blank {
                nodes.push(node);
            }
        }
        nodes
    }

    /// The `name` element that is the only node in `range`, if it is one.
    fn only_child(&self, range: Range<usize>, name: &str) -> Option<Element<'a>> {
        let mut children = self.children(range);
        match (children.pop(), children.is_empty()) {
            (Some(Node::Element(e)), true) if e.name == name => Some(e),
            _ => None,
        }
    }

    /// The blocks of `range`.
    fn blocks(&mut self, range: Range<usize>, ctx: Context) -> Result<Vec<DocBlock>, CoreError> {
        let mut out = Vec::new();
        // Where the run of inline content before `at`, outside any
        // paragraph, starts.
        let mut loose: Option<usize> = None;
        let mut at = range.start;
        while at < range.end {
            let node = node(self.html, at, range.end);
            let end = node.range().end;
            if let Node::Element(e) = node {
                let inline = INLINE.contains(&e.name)
                    && attribute(e.tag, "data-pid").is_none()
                    && !self.has_paragraph(&e.range);
                if !inline {
                    if let Some(start) = loose.take() {
                        self.loose(start..at, &mut out);
                    }
                    self.block(e, ctx, &mut out)?;
                    at = end;
                    continue;
                }
            }
            loose.get_or_insert(at);
            at = end;
        }
        if let Some(start) = loose {
            self.loose(start..range.end, &mut out);
        }
        Ok(out)
    }

    /// Inline content outside any paragraph. Page markers alone (it has
    /// them just before a paragraph) start the next block's inlines; blank
    /// text (an empty table cell's no-break space) is dropped; and any words
    /// are a heading of no paragraph, so none is lost.
    fn loose(&mut self, range: Range<usize>, out: &mut Vec<DocBlock>) {
        let inlines = self.inlines(range, false).inlines;
        let mut words = false;
        let mut markers = Vec::new();
        for inline in inlines.iter() {
            match inline {
                DocInline::PageMarker { .. } => markers.push(inline.clone()),
                DocInline::Common {
                    inline: Inline::Text { text },
                } if text.trim().is_empty() => {}
                _ => words = true,
            }
        }
        if words {
            out.push(DocBlock::Heading {
                level: 3,
                paragraph: None,
                inlines,
            });
        } else {
            self.pending.extend(markers);
        }
    }

    /// Append the block or blocks of element `e` to `out`.
    fn block(
        &mut self,
        e: Element<'_>,
        mut ctx: Context,
        out: &mut Vec<DocBlock>,
    ) -> Result<(), CoreError> {
        if let Some(paragraph) = self.paragraph_at(e.range.start) {
            out.extend(self.paragraph(&e, paragraph, ctx));
            return Ok(());
        }
        if attribute(e.tag, "data-pid").is_some() {
            return Err(CoreError::Corrupt);
        }
        match e.name {
            "hr" => out.push(DocBlock::Rule),
            "img" => out.extend(self.image(e.tag)?.map(|image| DocBlock::Figure {
                image,
                caption: Vec::new(),
            })),
            "figure" => self.figure(&e, ctx, out)?,
            "ul" | "ol" => out.push(self.list(&e, ctx)?),
            "table" => {
                let mut rows = Vec::new();
                self.rows(e.inner, ctx, &mut rows)?;
                out.push(DocBlock::Table { rows });
            }
            name if DROPPED.contains(&name) => {}
            name if (heading_level(name).is_some() || name == "summary")
                && !self.has_paragraph(&e.range) =>
            {
                out.push(DocBlock::Heading {
                    // A `summary` titles a section of the article.
                    level: heading_level(name).unwrap_or(2),
                    paragraph: None,
                    inlines: self.inlines(e.inner, false).inlines,
                })
            }
            "div" if e.has_class("groupFootnote") => self.footnotes(&e, ctx, out)?,
            "div" if e.has_class("blockTeach") || e.has_class("boxSupplement") => {
                match self.only_child(e.inner.clone(), "aside") {
                    Some(aside) => out.push(self.aside(aside.inner, ctx)?),
                    None => out.extend(self.blocks(e.inner, ctx)?),
                }
            }
            _ => {
                ctx.toc |= e.has_class("groupTOC");
                ctx.copyright |= e.has_class("copyrightInfo");
                out.extend(self.blocks(e.inner, ctx)?);
            }
        }
        Ok(())
    }

    /// The block of paragraph `paragraph`'s element `e`; `None` for an
    /// aside's title, which is kept in `self.title`.
    fn paragraph(&mut self, e: &Element<'_>, paragraph: u32, ctx: Context) -> Option<DocBlock> {
        if let Some(rel) = attribute(e.tag, "data-rel-pid") {
            let list = rel.trim_start_matches('[').trim_end_matches(']');
            for question in list.split(',').filter_map(|q| number(q.trim())) {
                self.questions.push((paragraph, question));
            }
        }
        if let Some(level) = heading_level(e.name) {
            return Some(DocBlock::Heading {
                level,
                paragraph: Some(paragraph),
                inlines: self.inlines(e.inner.clone(), false).inlines,
            });
        }
        if e.name == "div" && e.has_class("gen-field") {
            if let Some(tag) = self.textarea_name(e) {
                return Some(DocBlock::AnswerField { paragraph, tag });
            }
        }
        if e.name == "div" && e.has_class("boxTtl") && matches!(self.title, Some(None)) {
            let inlines = self.inlines(e.inner.clone(), false).inlines;
            self.title = Some(Some(DocTitle { paragraph, inlines }));
            return None;
        }
        let run = self.inlines(e.inner.clone(), false);
        if e.name == "p" && e.has_class("qu") {
            let (number, inlines) = question_number(run.inlines);
            return Some(DocBlock::Question {
                paragraph,
                number,
                for_paragraphs: Vec::new(),
                inlines,
            });
        }
        Some(DocBlock::Paragraph {
            paragraph,
            number: run.number,
            role: role(e, ctx),
            inlines: run.inlines,
        })
    }

    /// The `name` of the `textarea` in answer field `e`.
    fn textarea_name(&self, e: &Element<'_>) -> Option<String> {
        let content = &self.html[e.inner.clone()];
        let at = content.find("<textarea")?;
        let tag = &content[at..at + content[at..].find('>')? + 1];
        attribute(tag, "name").map(decode_references)
    }

    /// The image of an `img` tag, if its `src` is a `jwpub-media://` file.
    fn image(&self, tag: &str) -> Result<Option<DocImage>, CoreError> {
        let Some(file) = attribute(tag, "src").and_then(|s| s.strip_prefix("jwpub-media://"))
        else {
            return Ok(None);
        };
        let file = decode_references(file);
        if check_file_name(&file).is_err() {
            return Ok(None);
        }
        let path = std::path::absolute(self.dir.join(&file))?
            .into_os_string()
            .into_string()
            .map_err(|_| CoreError::Io("publication directory is not UTF-8".into()))?;
        Ok(Some(DocImage {
            file,
            path,
            alt: attribute(tag, "alt")
                .map(decode_references)
                .unwrap_or_default(),
            width: attribute(tag, "width").and_then(number),
            height: attribute(tag, "height").and_then(number),
        }))
    }

    /// A `figure`: its `img` (a child) and the rest as its caption. Without
    /// an image, its content is laid out in its place.
    fn figure(
        &mut self,
        e: &Element<'_>,
        ctx: Context,
        out: &mut Vec<DocBlock>,
    ) -> Result<(), CoreError> {
        let img = self
            .children(e.inner.clone())
            .into_iter()
            .find_map(|n| match n {
                Node::Element(img) if img.name == "img" => Some(img),
                _ => None,
            });
        let image = match &img {
            Some(img) => self.image(img.tag)?,
            None => None,
        };
        let (Some(img), Some(image)) = (img, image) else {
            out.extend(self.blocks(e.inner.clone(), ctx)?);
            return Ok(());
        };
        let range = img.range;
        let mut caption = self.blocks(e.inner.start..range.start, ctx)?;
        caption.extend(self.blocks(range.end..e.inner.end, ctx)?);
        out.push(DocBlock::Figure { image, caption });
        Ok(())
    }

    /// An `aside` with content `range`, titled by its first `div.boxTtl`.
    fn aside(&mut self, range: Range<usize>, ctx: Context) -> Result<DocBlock, CoreError> {
        let outer = self.title.replace(None);
        let blocks = self.blocks(range, ctx);
        let title = std::mem::replace(&mut self.title, outer).flatten();
        Ok(DocBlock::Aside {
            title,
            blocks: blocks?,
        })
    }

    /// A `ul` or `ol`. Content outside an `li` is an item of its own.
    fn list(&mut self, e: &Element<'_>, ctx: Context) -> Result<DocBlock, CoreError> {
        let mut items = Vec::new();
        for child in self.children(e.inner.clone()) {
            let range = match child {
                Node::Element(li) if li.name == "li" && !self.is_paragraph(&li) => li.inner,
                other => other.range(),
            };
            let blocks = self.blocks(range, ctx)?;
            if !blocks.is_empty() {
                items.push(DocListItem { blocks });
            }
        }
        Ok(DocBlock::List {
            ordered: e.name == "ol",
            items,
        })
    }

    fn is_paragraph(&self, e: &Element<'_>) -> bool {
        self.paragraph_at(e.range.start).is_some()
    }

    /// Append the rows of a `table` (or its `thead`, `tbody`, `tfoot`)
    /// content `range` to `rows`. Content outside a row is a row of one
    /// cell.
    fn rows(
        &mut self,
        range: Range<usize>,
        ctx: Context,
        rows: &mut Vec<DocTableRow>,
    ) -> Result<(), CoreError> {
        for child in self.children(range) {
            match child {
                Node::Element(tr) if tr.name == "tr" && !self.is_paragraph(&tr) => {
                    rows.push(DocTableRow {
                        cells: self.cells(tr.inner, ctx)?,
                    })
                }
                Node::Element(group)
                    if matches!(group.name, "thead" | "tbody" | "tfoot")
                        && !self.is_paragraph(&group) =>
                {
                    self.rows(group.inner, ctx, rows)?
                }
                other => {
                    let blocks = self.blocks(other.range(), ctx)?;
                    if !blocks.is_empty() {
                        rows.push(DocTableRow {
                            cells: vec![cell(false, 1, blocks)],
                        });
                    }
                }
            }
        }
        Ok(())
    }

    /// The cells of a `tr`'s content `range`. Content outside a cell is a
    /// cell of its own.
    fn cells(&mut self, range: Range<usize>, ctx: Context) -> Result<Vec<DocTableCell>, CoreError> {
        let mut cells = Vec::new();
        for child in self.children(range) {
            match child {
                Node::Element(td) if matches!(td.name, "td" | "th") && !self.is_paragraph(&td) => {
                    let colspan = attribute(td.tag, "colspan").and_then(number).unwrap_or(1);
                    cells.push(cell(td.name == "th", colspan, self.blocks(td.inner, ctx)?));
                }
                other => {
                    let blocks = self.blocks(other.range(), ctx)?;
                    if !blocks.is_empty() {
                        cells.push(cell(false, 1, blocks));
                    }
                }
            }
        }
        Ok(cells)
    }

    /// Append a `div.groupFootnote`'s footnotes to `out`. Content that is
    /// not a footnote is laid out in its place, between `Footnotes` blocks.
    fn footnotes(
        &mut self,
        e: &Element<'_>,
        ctx: Context,
        out: &mut Vec<DocBlock>,
    ) -> Result<(), CoreError> {
        let mut items = Vec::new();
        for child in self.children(e.inner.clone()) {
            if let Some(item) = self.footnote(&child) {
                items.push(item);
                continue;
            }
            if !items.is_empty() {
                out.push(DocBlock::Footnotes {
                    items: std::mem::take(&mut items),
                });
            }
            out.extend(self.blocks(child.range(), ctx)?);
        }
        if !items.is_empty() {
            out.push(DocBlock::Footnotes { items });
        }
        Ok(())
    }

    /// A `div.fn-ref` holding one paragraph, or text and no paragraph.
    fn footnote(&mut self, node: &Node<'_>) -> Option<DocFootnote> {
        let Node::Element(e) = node else {
            return None;
        };
        if e.name != "div" || !e.has_class("fn-ref") || self.is_paragraph(e) {
            return None;
        }
        let id = attribute(e.tag, "data-fnid").and_then(number)?;
        let (paragraph, range) = if self.has_paragraph(&e.inner) {
            let mut children = self.children(e.inner.clone());
            match (children.pop(), children.is_empty()) {
                (Some(Node::Element(p)), true) => {
                    (Some(self.paragraph_at(p.range.start)?), p.inner)
                }
                _ => return None,
            }
        } else {
            (None, e.inner.clone())
        };
        let run = self.inlines(range, true);
        Some(DocFootnote {
            id,
            marker: run.marker.unwrap_or_default(),
            paragraph,
            inlines: run.inlines,
        })
    }

    /// The inline content of `range`, trimmed. In a footnote
    /// (`footnote`), its `a.fn-symbol` is taken out as its marker.
    fn inlines(&mut self, range: Range<usize>, footnote: bool) -> Run {
        let mut run = Run {
            inlines: std::mem::take(&mut self.pending),
            space: true,
            number: None,
            marker: None,
            footnote,
        };
        for inline in self.inline_content(range, &mut Vec::new(), &mut run) {
            push(&mut run.inlines, inline);
        }
        trim(&mut run.inlines, false);
        run
    }

    /// The inlines of `range`, inside the formatting `format` (outermost
    /// first), which is pushed down onto its text.
    fn inline_content(
        &self,
        range: Range<usize>,
        format: &mut Vec<Format>,
        run: &mut Run,
    ) -> Vec<DocInline> {
        let mut out = Vec::new();
        let mut at = range.start;
        while at < range.end {
            let node = node(self.html, at, range.end);
            at = node.range().end;
            let e = match node {
                Node::Text(r) => {
                    run.text(&mut out, format, &decode_references(&self.html[r]));
                    continue;
                }
                Node::Skip(_) => continue,
                Node::Element(e) => e,
            };
            let inner = e.inner.clone();
            let span = |class| e.name == "span" && e.has_class(class);
            if e.name == "strong" || e.name == "em" {
                format.push(match e.name {
                    "strong" => Format::Strong,
                    _ => Format::Emphasis,
                });
                let children = self.inline_content(inner, format, run);
                format.pop();
                children.into_iter().for_each(|c| push(&mut out, c));
            } else if e.name == "sup" {
                let children = self.inline_content(inner, format, run);
                out.push(DocInline::Superscript { children });
            } else if e.name == "sub" {
                let children = self.inline_content(inner, format, run);
                out.push(DocInline::Subscript { children });
            } else if span("altsize") {
                let children = self.inline_content(inner, format, run);
                out.push(DocInline::SmallCaps { children });
            } else if span("parNum") {
                run.number = attribute(e.tag, "data-pnum")
                    .filter(|n| !n.is_empty())
                    .map(decode_references);
            } else if span("pageNum") {
                out.push(DocInline::PageMarker {
                    page: attribute(e.tag, "data-no")
                        .map(decode_references)
                        .unwrap_or_default(),
                });
                let children = self.inline_content(inner, format, run);
                children.into_iter().for_each(|c| push(&mut out, c));
            } else if let Some(id) = attribute(e.tag, "data-fnid")
                .and_then(number)
                .filter(|_| span("fn"))
            {
                let marker = collapse(&plain_text(&self.html[inner]));
                run.space = false;
                out.push(DocInline::FootnoteRef { id, marker });
            } else if run.footnote && e.name == "a" && e.has_class("fn-symbol") {
                run.marker = Some(collapse(&plain_text(&self.html[inner])));
            } else if let Some(href) = attribute(e.tag, "href").filter(|_| e.name == "a") {
                let url = decode_references(href);
                let children = self.inline_content(inner, format, run);
                out.push(DocInline::Link {
                    children,
                    target: DocLinkTarget::from_href(&url),
                    url,
                });
            } else if e.name == "br" {
                push(&mut out, common(format, "\n".to_string()));
                run.space = true;
            } else if !DROPPED.contains(&e.name) {
                let children = self.inline_content(inner, format, run);
                children.into_iter().for_each(|c| push(&mut out, c));
            }
        }
        out
    }
}

fn cell(header: bool, colspan: u32, blocks: Vec<DocBlock>) -> DocTableCell {
    DocTableCell {
        header,
        colspan: colspan.max(1),
        blocks,
    }
}

/// The level of an `h1`..`h6`.
fn heading_level(name: &str) -> Option<u8> {
    let level = name.strip_prefix('h')?.parse().ok()?;
    (1..=6).contains(&level).then_some(level)
}

/// A paragraph's role, from its classes (see [`ParagraphRole`]).
fn role(e: &Element<'_>, ctx: Context) -> ParagraphRole {
    if ctx.copyright {
        return ParagraphRole::Body;
    }
    for class in classes(e.tag) {
        let role = match class {
            "st" => ParagraphRole::Title,
            "sd" => ParagraphRole::Summary,
            "contextTtl" | "featureTtl" => ParagraphRole::ContextTitle,
            "themeScrp" => ParagraphRole::ThemeScripture,
            "pubRefs" => ParagraphRole::PublicationReference,
            "byline" => ParagraphRole::Byline,
            "se" | "sm" | "sn" if ctx.toc => ParagraphRole::TocEntry,
            _ => continue,
        };
        return role;
    }
    ParagraphRole::Body
}

/// A question's number (its leading bold `N.` or `N-M.`, or the same as
/// plain text) without the dot, and its inlines without it. No number
/// gives "".
fn question_number(mut inlines: Vec<DocInline>) -> (String, Vec<DocInline>) {
    let label = |text: &str| {
        let label = text.trim().strip_suffix('.')?;
        let (first, last) = label.split_once('-').unwrap_or((label, label));
        (number::<u32>(first).is_some() && number::<u32>(last).is_some()).then(|| label.to_string())
    };
    let found = match inlines.first_mut() {
        Some(DocInline::Common {
            inline: Inline::Strong { children },
        }) => match children.as_slice() {
            [Inline::Text { text }] => label(text).map(|n| (n, true)),
            _ => None,
        },
        Some(DocInline::Common {
            inline: Inline::Text { text },
        }) => {
            let (head, rest) = text.split_once(' ').unwrap_or((text, ""));
            let n = label(head);
            if n.is_some() {
                *text = rest.to_string();
            }
            n.map(|n| (n, text.is_empty()))
        }
        _ => None,
    };
    let Some((number, remove)) = found else {
        return (String::new(), inlines);
    };
    if remove {
        inlines.remove(0);
    }
    trim(&mut inlines, true);
    (number, inlines)
}

/// `em` or `strong`, pushed down onto text.
#[derive(Clone, Copy)]
enum Format {
    Emphasis,
    Strong,
}

/// The inline content of one block, as it is scanned.
struct Run {
    /// Pending page markers, then the content once it is scanned.
    inlines: Vec<DocInline>,
    /// Whether the text so far is empty or ends in a space, so whitespace
    /// next is dropped.
    space: bool,
    /// The `data-pnum` of its `span.parNum`.
    number: Option<String>,
    /// The text of its `a.fn-symbol`, in a footnote.
    marker: Option<String>,
    footnote: bool,
}

impl Run {
    /// Append `text` to `out` inside `format`, ASCII whitespace runs
    /// collapsed to one space (none at the start).
    fn text(&mut self, out: &mut Vec<DocInline>, format: &[Format], text: &str) {
        let mut kept = String::new();
        for c in text.chars() {
            if !c.is_ascii_whitespace() {
                kept.push(c);
                self.space = false;
            } else if !self.space {
                kept.push(' ');
                self.space = true;
            }
        }
        if !kept.is_empty() {
            push(out, common(format, kept));
        }
    }
}

/// Text inside `format` (outermost first).
fn common(format: &[Format], text: String) -> DocInline {
    let inline = format
        .iter()
        .rev()
        .fold(Inline::Text { text }, |inline, f| match f {
            Format::Emphasis => Inline::Emphasis {
                children: vec![inline],
            },
            Format::Strong => Inline::Strong {
                children: vec![inline],
            },
        });
    DocInline::Common { inline }
}

/// Append `next` to `out`, merging it into a `Common` before it when both
/// are text or have the same formatting.
fn push(out: &mut Vec<DocInline>, next: DocInline) {
    let next = match (out.last_mut(), next) {
        (Some(DocInline::Common { inline: last }), DocInline::Common { inline }) => {
            match join(last, inline) {
                Some(inline) => DocInline::Common { inline },
                None => return,
            }
        }
        (_, next) => next,
    };
    out.push(next);
}

/// Merge `next` into `last` if both are text, or both emphasis or both
/// strong; otherwise give it back.
fn join(last: &mut Inline, next: Inline) -> Option<Inline> {
    match (last, next) {
        (Inline::Text { text }, Inline::Text { text: more }) => text.push_str(&more),
        (Inline::Emphasis { children }, Inline::Emphasis { children: more })
        | (Inline::Strong { children }, Inline::Strong { children: more }) => {
            for inline in more {
                let unmerged = match children.last_mut() {
                    Some(last) => join(last, inline),
                    None => Some(inline),
                };
                children.extend(unmerged);
            }
        }
        (_, next) => return Some(next),
    }
    None
}

/// Drop a space from the start (`front`) or end of `inlines`.
fn trim(inlines: &mut Vec<DocInline>, front: bool) {
    let Some(i) = (if front {
        Some(0)
    } else {
        inlines.len().checked_sub(1)
    }) else {
        return;
    };
    let Some(edge) = inlines.get_mut(i) else {
        return;
    };
    match edge {
        DocInline::Common { inline } => {
            if trim_inline(inline, front) {
                inlines.remove(i);
            }
        }
        DocInline::Superscript { children }
        | DocInline::Subscript { children }
        | DocInline::SmallCaps { children }
        | DocInline::Link { children, .. } => trim(children, front),
        DocInline::FootnoteRef { .. } | DocInline::PageMarker { .. } => {}
    }
}

/// Drop a space from the start (`front`) or end of `inline`; whether it is
/// empty now.
fn trim_inline(inline: &mut Inline, front: bool) -> bool {
    match inline {
        Inline::Text { text } => {
            if front && text.starts_with(' ') {
                text.remove(0);
            } else if !front && text.ends_with(' ') {
                text.pop();
            }
            text.is_empty()
        }
        Inline::Emphasis { children } | Inline::Strong { children } => {
            let i = if front {
                0
            } else {
                children.len().saturating_sub(1)
            };
            if children.get_mut(i).is_some_and(|c| trim_inline(c, front)) {
                children.remove(i);
            }
            children.is_empty()
        }
        _ => false,
    }
}

/// `text` with whitespace runs collapsed to one space, and trimmed.
fn collapse(text: &str) -> String {
    text.split_ascii_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// An anchor for every `data-pid` element of `html`, as
    /// `paragraph_anchor` would give.
    fn anchors(html: &str) -> Vec<ParagraphAnchor> {
        const PID: &str = " data-pid=\"";
        let mut anchors = Vec::new();
        for (at, _) in html.match_indices(PID) {
            let begin = html[..at].rfind('<').unwrap();
            let name: String = html[begin + 1..]
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric())
                .collect();
            let rest = &html[at + PID.len()..];
            anchors.push(ParagraphAnchor {
                paragraph: rest[..rest.find('"').unwrap()].parse().unwrap(),
                label: None,
                begin: Some(begin as u32),
                end: Some(element_end(html, begin, &name).unwrap() as u32),
            });
        }
        anchors
    }

    fn blocks(html: &str) -> Vec<DocBlock> {
        document_blocks(html, &anchors(html), Path::new("/pub")).unwrap()
    }

    fn text(text: &str) -> DocInline {
        DocInline::Common {
            inline: Inline::Text { text: text.into() },
        }
    }

    fn emphasis(text: &str) -> DocInline {
        DocInline::Common {
            inline: Inline::Emphasis {
                children: vec![Inline::Text { text: text.into() }],
            },
        }
    }

    fn body(paragraph: u32, inlines: Vec<DocInline>) -> DocBlock {
        DocBlock::Paragraph {
            paragraph,
            number: None,
            role: ParagraphRole::Body,
            inlines,
        }
    }

    #[test]
    fn unknown_shapes_are_body_text() {
        let html = r#"<div data-pid="1" class="weird"><span>x</span>  <b>y</b></div>
<section><p data-pid="2" class="zz"><u>z</u></p></section>
<div class="boxTtl" data-pid="3"><h2>Not in an aside</h2></div>"#;
        assert_eq!(
            blocks(html),
            [
                body(1, vec![text("x y")]),
                body(2, vec![text("z")]),
                body(3, vec![text("Not in an aside")]),
            ]
        );
    }

    #[test]
    fn a_pid_without_a_paragraph_row_is_corrupt() {
        let html = r#"<p data-pid="1">a</p><div><p data-pid="2">b</p></div>"#;
        let mut anchors = anchors(html);
        anchors.pop();
        let corrupt = |anchors: &[_]| {
            matches!(
                document_blocks(html, anchors, Path::new("/pub")),
                Err(CoreError::Corrupt)
            )
        };
        assert!(corrupt(&anchors));
        // An unpositioned row is not in the HTML either.
        anchors.push(ParagraphAnchor {
            paragraph: 2,
            label: None,
            begin: None,
            end: None,
        });
        assert!(corrupt(&anchors));
    }

    #[test]
    fn questions_and_dangling_references() {
        let html = r#"<p data-pid="1" class="qu"> <strong>3-4.</strong> Why?</p>
<p data-pid="2" data-rel-pid="[9]">x<span data-fnid="4" class="fn">a<span class="tt fn" data-rel-fnid="4"></span></span></p>
<p data-pid="3" data-rel-pid="[1]">y</p>
<p data-pid="4" data-rel-pid="[1]">z</p>
<p data-pid="5" class="qu">5. Plain?</p>
<p data-pid="6" class="qu">No number?</p>"#;
        assert_eq!(
            blocks(html),
            [
                DocBlock::Question {
                    paragraph: 1,
                    number: "3-4".into(),
                    for_paragraphs: vec![3, 4],
                    inlines: vec![text("Why?")],
                },
                body(
                    2,
                    vec![
                        text("x"),
                        DocInline::FootnoteRef {
                            id: 4,
                            marker: "a".into()
                        }
                    ]
                ),
                body(3, vec![text("y")]),
                body(4, vec![text("z")]),
                DocBlock::Question {
                    paragraph: 5,
                    number: "5".into(),
                    for_paragraphs: vec![],
                    inlines: vec![text("Plain?")],
                },
                DocBlock::Question {
                    paragraph: 6,
                    number: "".into(),
                    for_paragraphs: vec![],
                    inlines: vec![text("No number?")],
                },
            ]
        );
    }

    #[test]
    fn paragraph_numbers_are_taken_out() {
        let html = r#"<p data-pid="7"><span class="parNum" data-pnum="2"><strong><sup>2</sup></strong></span> In</p>
<p data-pid="8"><span class="parNum" data-pnum=""></span>Drop cap</p>"#;
        assert_eq!(
            blocks(html),
            [
                DocBlock::Paragraph {
                    paragraph: 7,
                    number: Some("2".into()),
                    role: ParagraphRole::Body,
                    inlines: vec![text("In")],
                },
                body(8, vec![text("Drop cap")]),
            ]
        );
    }

    #[test]
    fn formatting_splits_around_doc_only_inlines() {
        let html = r#"<p data-pid="1"><em>b<sup>e</sup>rit</em> <strong>A <em>b</em><a href="https://x.org/">c</a></strong></p>"#;
        assert_eq!(
            blocks(html),
            [body(
                1,
                vec![
                    emphasis("b"),
                    DocInline::Superscript {
                        children: vec![emphasis("e")],
                    },
                    emphasis("rit"),
                    text(" "),
                    DocInline::Common {
                        inline: Inline::Strong {
                            children: vec![
                                Inline::Text { text: "A ".into() },
                                Inline::Emphasis {
                                    children: vec![Inline::Text { text: "b".into() }],
                                },
                            ],
                        },
                    },
                    DocInline::Link {
                        children: vec![DocInline::Common {
                            inline: Inline::Strong {
                                children: vec![Inline::Text { text: "c".into() }],
                            },
                        }],
                        url: "https://x.org/".into(),
                        target: DocLinkTarget::External {
                            url: "https://x.org/".into(),
                        },
                    },
                ]
            )]
        );
    }

    #[test]
    fn text_is_collapsed_decoded_and_trimmed() {
        let html = "<p data-pid=\"1\">\n  a&amp;b \t<em> c&nbsp;d </em> &#x2014;e<br/>f  </p>";
        assert_eq!(
            blocks(html),
            [body(
                1,
                vec![text("a&b "), emphasis("c\u{a0}d "), text("—e\nf")]
            )]
        );
    }

    #[test]
    fn content_outside_paragraphs() {
        let html = r#"<span class="pageNum" data-no="5"></span><p data-pid="1">x</p>
<div>&#160;</div><div>stray <em>words</em></div>"#;
        assert_eq!(
            blocks(html),
            [
                body(
                    1,
                    vec![DocInline::PageMarker { page: "5".into() }, text("x")]
                ),
                DocBlock::Heading {
                    level: 3,
                    paragraph: None,
                    inlines: vec![text("stray "), emphasis("words")],
                },
            ]
        );
    }

    #[test]
    fn figures_asides_lists_and_tables() {
        let html = r##"<figure><img src="jwpub-media://a.jpg" alt="A &amp; B" width="10"/>
<figcaption><p data-pid="1">cap</p></figcaption></figure>
<figure><img src="jwpub-media://../x.jpg"/></figure>
<div class="boxSupplement"><aside><div class="boxTtl" data-pid="2"><h2>T</h2></div>
<ol><li><p data-pid="3">one</p></li><p data-pid="4">loose</p></ol></aside></div>
<table><thead><tr><th colspan="2"><p data-pid="5">h</p></th></tr></thead>
<tr><td colspan="0"> </td><td><p data-pid="6">c</p></td></tr></table>
<div class="groupFootnote"><div class="fn-ref" data-fnid="1"><p data-pid="7"><a href="#footnotesource1" class="fn-symbol">a</a> Note</p></div></div>
<hr/>"##;
        let cell = |header, colspan, blocks| DocTableCell {
            header,
            colspan,
            blocks,
        };
        assert_eq!(
            blocks(html),
            [
                DocBlock::Figure {
                    image: DocImage {
                        file: "a.jpg".into(),
                        path: "/pub/a.jpg".into(),
                        alt: "A & B".into(),
                        width: Some(10),
                        height: None,
                    },
                    caption: vec![body(1, vec![text("cap")])],
                },
                DocBlock::Aside {
                    title: Some(DocTitle {
                        paragraph: 2,
                        inlines: vec![text("T")],
                    }),
                    blocks: vec![DocBlock::List {
                        ordered: true,
                        items: vec![
                            DocListItem {
                                blocks: vec![body(3, vec![text("one")])],
                            },
                            DocListItem {
                                blocks: vec![body(4, vec![text("loose")])],
                            },
                        ],
                    }],
                },
                DocBlock::Table {
                    rows: vec![
                        DocTableRow {
                            cells: vec![cell(true, 2, vec![body(5, vec![text("h")])])],
                        },
                        DocTableRow {
                            cells: vec![
                                cell(false, 1, vec![]),
                                cell(false, 1, vec![body(6, vec![text("c")])]),
                            ],
                        },
                    ],
                },
                DocBlock::Footnotes {
                    items: vec![DocFootnote {
                        id: 1,
                        marker: "a".into(),
                        paragraph: Some(7),
                        inlines: vec![text("Note")],
                    }],
                },
                DocBlock::Rule,
            ]
        );
    }
}
