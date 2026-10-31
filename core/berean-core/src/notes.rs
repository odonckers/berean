//! Note bodies: Markdown parsed into one shared tree every app draws, and the
//! `berean://` URLs of the app links in it.
//!
//! A note body is CommonMark with strikethrough and task lists, parsed by
//! `pulldown-cmark`. [`render`] walks its events into [`Block`]s and
//! [`Inline`]s:
//!
//! - Soft and hard line breaks are both [`Inline::LineBreak`], so plain-text
//!   notes keep their lines.
//! - Raw HTML, block or inline, is plain text; it is never interpreted.
//! - An image is its alt text. Nothing is fetched.
//! - A paragraph whose only content is one passage link is a
//!   [`Block::PassageCard`].
//! - `#name` is an [`Inline::Tag`] (see [`tag_tokens`]), except in code and
//!   link text, or where it isn't the source verbatim (`\#x`, entities).
//!
//! App links (see [`passage_url`], [`publication_url`]):
//!
//! - `berean://bible/{pub_key}/{book}/{chapter}[/{verse}][-{end}]`: a Bible
//!   passage within one book. With a verse, `end` is `{verse}` (same chapter)
//!   or `{chapter}/{verse}`; without one, `end` is a chapter.
//! - `berean://pub/{pub_key}[/{doc_id}[/{paragraph}]]`: a publication, a
//!   document of it or a paragraph of that.
//!
//! Numbers, not names, so a link works in any UI language. `http`, `https`
//! and `mailto` links are external; any other URL, or a malformed `berean://`
//! one, is [`LinkTarget::Invalid`].
//!
//! The Write view styles the source itself with [`markdown_spans`], from the
//! same parse.

mod spans;

pub use spans::{markdown_spans, SourceSpan, SpanKind};

use std::iter::Peekable;
use std::ops::Range;

use pulldown_cmark::{Event, LinkType, Options, Parser, Tag};

use crate::library::parse_pub_key;
use crate::reader::{Location, LocationSpan};
use crate::CoreError;

/// One block of a rendered note body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Block {
    /// `level` is 1..=6.
    Heading {
        level: u8,
        inlines: Vec<Inline>,
    },
    Paragraph {
        inlines: Vec<Inline>,
    },
    /// A paragraph whose only content is one passage link: drawn as a
    /// passage card. `text` is the link's visible text.
    PassageCard {
        text: String,
        span: LocationSpan,
        missing: bool,
    },
    /// `start` is `Some(n)` for a list numbered from `n`, `None` for bullets.
    List {
        start: Option<u32>,
        items: Vec<ListItem>,
    },
    Quote {
        blocks: Vec<Block>,
    },
    /// Fenced or indented; the info string is ignored.
    CodeBlock {
        text: String,
    },
    Rule,
}

/// One item of a [`Block::List`]; `task` is set for a checklist item.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListItem {
    pub task: Option<NoteTask>,
    pub blocks: Vec<Block>,
}

/// A checklist item. `index` counts task items in document order, from 0.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NoteTask {
    pub index: u32,
    pub checked: bool,
}

/// Inline content of a heading or paragraph.
#[derive(Debug, Clone, PartialEq, Eq)]
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
    /// `url` is the link's destination as written.
    Link {
        children: Vec<Inline>,
        url: String,
        target: LinkTarget,
    },
    /// An inline #tag (not inside code or a link). `name` is without the '#'.
    Tag {
        name: String,
    },
    LineBreak,
}

/// What a link points at.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkTarget {
    /// `missing`: the linked Bible (the span's `pub_key`) isn't installed.
    Passage { span: LocationSpan, missing: bool },
    /// `missing`: the linked publication isn't installed.
    Publication { location: Location, missing: bool },
    /// An `http`, `https` or `mailto` link.
    External { url: String },
    /// Any other URL, or a malformed `berean://` one.
    Invalid,
}

const BIBLE_PREFIX: &str = "berean://bible/";
const PUB_PREFIX: &str = "berean://pub/";

/// The `berean://bible/...` URL of `span`. A span that isn't a Bible
/// passage within one book => `Invalid`: both ends need the same `pub_key`
/// and book (1..=66), a chapter, a verse at both ends or neither, and no
/// paragraph, and the end can't be before the start. `doc_id` is not part of
/// the URL (the book names the document), so a span from `Reader::resolve`,
/// which sets it, links as is.
pub fn passage_url(span: &LocationSpan) -> Result<String, CoreError> {
    let invalid = || CoreError::Invalid(format!("not a Bible passage within one book: {span:?}"));
    let (start, end) = (&span.start, &span.end);
    if start.pub_key != end.pub_key
        || !valid_pub_key(&start.pub_key)
        || start.paragraph.is_some()
        || end.paragraph.is_some()
    {
        return Err(invalid());
    }
    let (Some(book), Some(chapter), Some(end_book), Some(end_chapter)) =
        (start.book, start.chapter, end.book, end.chapter)
    else {
        return Err(invalid());
    };
    if book != end_book || !(1..=66).contains(&book) || chapter == 0 {
        return Err(invalid());
    }
    let mut url = format!("{BIBLE_PREFIX}{}/{book}/{chapter}", start.pub_key);
    match (start.verse, end.verse) {
        (Some(verse), Some(end_verse)) => {
            if (end_chapter, end_verse) < (chapter, verse) {
                return Err(invalid());
            }
            url.push_str(&format!("/{verse}"));
            if end_chapter != chapter {
                url.push_str(&format!("-{end_chapter}/{end_verse}"));
            } else if end_verse != verse {
                url.push_str(&format!("-{end_verse}"));
            }
        }
        (None, None) => {
            if end_chapter < chapter {
                return Err(invalid());
            }
            if end_chapter != chapter {
                url.push_str(&format!("-{end_chapter}"));
            }
        }
        _ => return Err(invalid()),
    }
    Ok(url)
}

/// The `berean://pub/...` URL of `location`. A location that isn't a
/// publication location (a Bible book, chapter or verse set, or a paragraph
/// without a document) => `Invalid`.
pub fn publication_url(location: &Location) -> Result<String, CoreError> {
    let bible = location.book.is_some() || location.chapter.is_some() || location.verse.is_some();
    let stray_paragraph = location.paragraph.is_some() && location.doc_id.is_none();
    if bible || stray_paragraph || !valid_pub_key(&location.pub_key) {
        return Err(CoreError::Invalid(format!(
            "not a publication location: {location:?}"
        )));
    }
    let mut url = format!("{PUB_PREFIX}{}", location.pub_key);
    if let Some(doc_id) = location.doc_id {
        url.push_str(&format!("/{doc_id}"));
    }
    if let Some(paragraph) = location.paragraph {
        url.push_str(&format!("/{paragraph}"));
    }
    Ok(url)
}

/// A well-formed key that can stand as one URL path segment.
fn valid_pub_key(pub_key: &str) -> bool {
    !pub_key.contains('/') && parse_pub_key(pub_key).is_ok()
}

/// What `url` points at; `installed` says whether a `pub_key` is installed.
fn link_target(url: &str, installed: &dyn Fn(&str) -> bool) -> LinkTarget {
    let scheme = url.split_once(':').map_or("", |(scheme, _)| scheme);
    let is = |name: &str| scheme.eq_ignore_ascii_case(name);
    if is("http") || is("https") || is("mailto") {
        return LinkTarget::External {
            url: url.to_string(),
        };
    }
    if let Some(span) = parse_passage(url) {
        let missing = !installed(&span.start.pub_key);
        return LinkTarget::Passage { span, missing };
    }
    if let Some(location) = parse_publication(url) {
        let missing = !installed(&location.pub_key);
        return LinkTarget::Publication { location, missing };
    }
    LinkTarget::Invalid
}

/// A canonical decimal number: no sign, no leading zeros, so each URL has
/// one spelling.
fn number<T: std::str::FromStr + ToString>(s: &str) -> Option<T> {
    s.parse::<T>().ok().filter(|n| n.to_string() == s)
}

/// The span of a `berean://bible/...` URL; anything malformed => `None`.
fn parse_passage(url: &str) -> Option<LocationSpan> {
    let rest = url.strip_prefix(BIBLE_PREFIX)?;
    let (pub_key, path) = rest.split_once('/')?;
    if !valid_pub_key(pub_key) {
        return None;
    }
    let (first, last) = match path.split_once('-') {
        Some((first, last)) => (first, Some(last)),
        None => (path, None),
    };
    let first: Vec<u32> = first.split('/').map(number).collect::<Option<_>>()?;
    let last: Option<Vec<u32>> = match last {
        Some(last) => Some(last.split('/').map(number).collect::<Option<_>>()?),
        None => None,
    };
    let (book, start, end) = match (first.as_slice(), last.as_deref()) {
        (&[book, chapter], None) => (book, (chapter, None), (chapter, None)),
        (&[book, chapter], Some(&[end])) => (book, (chapter, None), (end, None)),
        (&[book, chapter, verse], None) => (book, (chapter, Some(verse)), (chapter, Some(verse))),
        (&[book, chapter, verse], Some(&[end])) => {
            (book, (chapter, Some(verse)), (chapter, Some(end)))
        }
        (&[book, chapter, verse], Some(&[end_chapter, end])) => {
            (book, (chapter, Some(verse)), (end_chapter, Some(end)))
        }
        _ => return None,
    };
    // Verse 0 is a psalm's superscription, so only books and chapters start
    // at 1.
    if !(1..=66).contains(&book) || start.0 == 0 || end < start {
        return None;
    }
    let at = |(chapter, verse)| Location {
        pub_key: pub_key.to_string(),
        doc_id: None,
        book: Some(book),
        chapter: Some(chapter),
        verse,
        paragraph: None,
    };
    Some(LocationSpan {
        start: at(start),
        end: at(end),
    })
}

/// The location of a `berean://pub/...` URL; anything malformed => `None`.
fn parse_publication(url: &str) -> Option<Location> {
    let mut parts = url.strip_prefix(PUB_PREFIX)?.split('/');
    let pub_key = parts.next().filter(|k| valid_pub_key(k))?;
    // A segment that is there must be a number.
    let doc_id = match parts.next() {
        Some(s) => Some(number::<i64>(s)?),
        None => None,
    };
    let paragraph = match parts.next() {
        Some(s) => Some(number::<u32>(s)?),
        None => None,
    };
    if parts.next().is_some() {
        return None;
    }
    Some(Location {
        pub_key: pub_key.to_string(),
        doc_id,
        book: None,
        chapter: None,
        verse: None,
        paragraph,
    })
}

/// Parse a note body into its blocks. `installed` says whether a `pub_key`
/// is installed, for the links' `missing` flags. Never fails: Markdown has
/// no syntax errors.
pub(crate) fn render(markdown: &str, installed: &dyn Fn(&str) -> bool) -> Vec<Block> {
    parse(markdown, installed).blocks
}

/// A parsed note body, with the source ranges edits need.
struct Parsed {
    blocks: Vec<Block>,
    /// Each task marker (`[ ]`, `[x]`), by [`NoteTask::index`].
    markers: Vec<Range<usize>>,
    /// Each tag token (`#name`) whose source is exactly its text, in
    /// document order. A token with an escape or entity in it isn't here.
    tags: Vec<Range<usize>>,
}

/// The Markdown note bodies are: CommonMark with strikethrough and task
/// lists.
fn options() -> Options {
    Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS
}

fn parse(markdown: &str, installed: &dyn Fn(&str) -> bool) -> Parsed {
    let mut builder = Builder {
        events: Parser::new_ext(markdown, options())
            .into_offset_iter()
            .peekable(),
        source: markdown,
        installed,
        tasks: 0,
        items: Vec::new(),
        depth: 0,
        markers: Vec::new(),
        tags: Vec::new(),
    };
    let blocks = builder.blocks();
    let mut tags = builder.tags;
    // Inner inlines finish before the text around them.
    tags.sort_by_key(|r| r.start);
    Parsed {
        blocks,
        markers: builder.markers,
        tags,
    }
}

/// Whether `name` is a whole inline tag name: one or more letters, digits,
/// `_` or `-`.
pub(crate) fn is_tag_name(name: &str) -> bool {
    !name.is_empty() && name.chars().all(is_tag_char)
}

/// `markdown` with every inline `#old` (matched ignoring case, whole
/// tokens only) rewritten to `#new`; all other bytes are kept. A `#old` in
/// code or link text isn't a tag, so it is kept too.
pub(crate) fn rename_inline_tag(markdown: &str, old: &str, new: &str) -> String {
    let old = old.to_lowercase();
    let mut out = String::with_capacity(markdown.len());
    let mut copied = 0;
    for token in parse(markdown, &|_| true).tags {
        if markdown[token.start + 1..token.end].to_lowercase() == old {
            out.push_str(&markdown[copied..token.start + 1]);
            out.push_str(new);
            copied = token.end;
        }
    }
    out.push_str(&markdown[copied..]);
    out
}

/// `markdown` with its task `index` (see [`NoteTask::index`]) checked or
/// unchecked. Only the character inside the marker's brackets changes, and
/// a checked `X` stays as is. Out of range => `None`.
pub(crate) fn set_task(markdown: &str, index: u32, checked: bool) -> Option<String> {
    let marker = parse(markdown, &|_| true)
        .markers
        .get(usize::try_from(index).ok()?)?
        .clone();
    let at = marker.start + markdown[marker].find('[')? + 1;
    let current = markdown[at..].chars().next()?;
    let mark = match (checked, current) {
        (true, 'x' | 'X') | (false, ' ') => current,
        (true, _) => 'x',
        (false, _) => ' ',
    };
    let mut out = String::with_capacity(markdown.len());
    out.push_str(&markdown[..at]);
    out.push(mark);
    out.push_str(&markdown[at + current.len_utf8()..]);
    Some(out)
}

/// The distinct inline #tag names of a note body, in document order. Uses
/// the same parse as [`render`], so code and link text have no tags.
pub(crate) fn inline_tags(markdown: &str) -> Vec<String> {
    let mut names = Vec::new();
    for block in render(markdown, &|_| true) {
        block_tags(&block, &mut names);
    }
    names
}

fn block_tags(block: &Block, names: &mut Vec<String>) {
    match block {
        Block::Heading { inlines, .. } | Block::Paragraph { inlines } => {
            inline_tag_names(inlines, names)
        }
        Block::List { items, .. } => {
            for block in items.iter().flat_map(|i| &i.blocks) {
                block_tags(block, names);
            }
        }
        Block::Quote { blocks } => {
            for block in blocks {
                block_tags(block, names);
            }
        }
        Block::PassageCard { .. } | Block::CodeBlock { .. } | Block::Rule => {}
    }
}

fn inline_tag_names(inlines: &[Inline], names: &mut Vec<String>) {
    for inline in inlines {
        match inline {
            Inline::Tag { name } if !names.contains(name) => names.push(name.clone()),
            Inline::Emphasis { children }
            | Inline::Strong { children }
            | Inline::Strikethrough { children } => inline_tag_names(children, names),
            _ => {}
        }
    }
}

fn is_tag_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '-'
}

/// The tag tokens (`#name`) of a run of text. A tag is `#` at the start of
/// the run or after anything but a letter, digit or `#` (so after
/// whitespace or punctuation), then one or more letters, digits, `_` or `-`.
fn tag_tokens(text: &str) -> Vec<Range<usize>> {
    let mut out = Vec::new();
    let mut prev: Option<char> = None;
    let mut chars = text.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        let starts = c == '#'
            && prev.is_none_or(|p| p != '#' && !p.is_alphanumeric())
            && chars.peek().is_some_and(|&(_, n)| is_tag_char(n));
        prev = Some(c);
        if !starts {
            continue;
        }
        let mut end = text.len();
        while let Some(&(j, n)) = chars.peek() {
            if !is_tag_char(n) {
                end = j;
                break;
            }
            prev = Some(n);
            chars.next();
        }
        out.push(i..end);
    }
    out
}

/// Split a run of text into `Text` and `Tag` inlines (see [`tag_tokens`]).
#[cfg(test)]
fn split_tags(text: &str) -> Vec<Inline> {
    split_at_tags(text, &tag_tokens(text))
}

/// Split `text` into `Text` and `Tag` inlines at `tokens` (in order).
fn split_at_tags(text: &str, tokens: &[Range<usize>]) -> Vec<Inline> {
    let mut out = Vec::new();
    // `plain` is where the current run of plain text began.
    let mut plain = 0;
    for token in tokens.iter().cloned() {
        if plain < token.start {
            out.push(text_inline(&text[plain..token.start]));
        }
        out.push(Inline::Tag {
            name: text[token.start + 1..token.end].to_string(),
        });
        plain = token.end;
    }
    if plain < text.len() {
        out.push(text_inline(&text[plain..]));
    }
    out
}

fn text_inline(text: &str) -> Inline {
    Inline::Text {
        text: text.to_string(),
    }
}

/// Inline content before its text runs are merged and scanned for tags.
enum Piece {
    /// Text; `scan` is false for raw HTML, which is never tag-scanned.
    Text {
        text: String,
        scan: bool,
        /// The parts of `text` that are verbatim source.
        sources: Vec<Source>,
    },
    Inline(Inline),
}

/// `text[at..at + range.len()]` is `source[range]`, byte for byte.
struct Source {
    at: usize,
    range: Range<usize>,
}

/// Append `more`, which starts at `offset` in the text, to `sources`,
/// joining parts adjacent in both (the parser splits text at characters
/// like `_` that can be inside a tag).
fn push_sources(sources: &mut Vec<Source>, more: &[Source], offset: usize) {
    for part in more {
        let at = part.at + offset;
        if let Some(last) = sources.last_mut() {
            if last.at + last.range.len() == at && last.range.end == part.range.start {
                last.range.end = part.range.end;
                continue;
            }
        }
        sources.push(Source {
            at,
            range: part.range.clone(),
        });
    }
}

/// Walks pulldown-cmark's events into the tree, one container per call.
struct Builder<'a, 'm, I: Iterator<Item = (Event<'m>, Range<usize>)>> {
    events: Peekable<I>,
    source: &'m str,
    installed: &'a dyn Fn(&str) -> bool,
    /// Task items seen so far, for the next task's index.
    tasks: u32,
    /// The task of each open list item, innermost last.
    items: Vec<Option<NoteTask>>,
    /// Open quotes, lists and styled inlines around the current event.
    depth: usize,
    /// See [`Parsed`].
    markers: Vec<Range<usize>>,
    tags: Vec<Range<usize>>,
}

/// How deep quotes, lists and styled inlines nest in the tree; deeper ones
/// are flattened into their parent. Building, dropping and converting the
/// tree recurse, so this bounds the stack whatever the input.
const MAX_DEPTH: usize = 32;

/// Events that belong in a paragraph or heading. In a tight list item they
/// come with no paragraph around them.
fn is_inline(event: &Event) -> bool {
    match event {
        Event::Start(tag) => matches!(
            tag,
            Tag::Emphasis
                | Tag::Strong
                | Tag::Strikethrough
                | Tag::Superscript
                | Tag::Subscript
                | Tag::Link { .. }
                | Tag::Image { .. }
        ),
        Event::End(_) | Event::Rule => false,
        Event::Text(_)
        | Event::Code(_)
        | Event::InlineMath(_)
        | Event::DisplayMath(_)
        | Event::Html(_)
        | Event::InlineHtml(_)
        | Event::FootnoteReference(_)
        | Event::SoftBreak
        | Event::HardBreak
        | Event::TaskListMarker(_) => true,
    }
}

impl<'m, I: Iterator<Item = (Event<'m>, Range<usize>)>> Builder<'_, 'm, I> {
    /// The blocks up to the end of the current container (consumed), or of
    /// the document.
    fn blocks(&mut self) -> Vec<Block> {
        let mut out = Vec::new();
        // Containers nested too deep, whose content joins this one.
        let mut flattened = 0;
        while let Some((event, _)) = self.events.peek() {
            if is_inline(event) {
                // Loose inline content, as in a tight list item.
                let inlines = self.inlines(false, false);
                out.extend(paragraph(inlines));
                continue;
            }
            let Some((event, _)) = self.events.next() else {
                break;
            };
            match event {
                Event::End(_) if flattened > 0 => flattened -= 1,
                Event::End(_) => break,
                Event::Rule => out.push(Block::Rule),
                Event::Start(Tag::Paragraph) => {
                    out.extend(paragraph(self.inlines(false, true)));
                }
                Event::Start(Tag::Heading { level, .. }) => out.push(Block::Heading {
                    level: level as u8,
                    inlines: self.inlines(false, true),
                }),
                Event::Start(Tag::CodeBlock(_)) => {
                    let (mut text, _) = self.plain_text();
                    if text.ends_with('\n') {
                        text.pop();
                    }
                    out.push(Block::CodeBlock { text });
                }
                Event::Start(Tag::HtmlBlock) => {
                    let mut inlines = self.inlines(false, true);
                    if let Some(Inline::Text { text }) = inlines.last_mut() {
                        if text.ends_with('\n') {
                            text.pop();
                        }
                    }
                    out.extend(paragraph(inlines));
                }
                Event::Start(_) if self.depth >= MAX_DEPTH => flattened += 1,
                Event::Start(Tag::BlockQuote(_)) => {
                    let blocks = self.nested(Self::blocks);
                    out.push(Block::Quote { blocks });
                }
                Event::Start(Tag::List(start)) => out.push(self.nested(|b| b.list(start))),
                // Not enabled (tables, footnotes, ...): keep their content.
                Event::Start(_) => out.extend(self.nested(Self::blocks)),
                _ => {}
            }
        }
        out
    }

    /// A list's items, up to its end (consumed).
    fn list(&mut self, start: Option<u64>) -> Block {
        let mut items = Vec::new();
        while let Some(event) = self.events.next() {
            match event.0 {
                Event::Start(Tag::Item) => {
                    self.items.push(None);
                    let blocks = self.blocks();
                    let task = self.items.pop().flatten();
                    items.push(ListItem { task, blocks });
                }
                Event::End(_) => break,
                _ => {}
            }
        }
        Block::List {
            // CommonMark caps a list number at 9 digits, so it fits.
            start: start.map(|n| u32::try_from(n).unwrap_or(u32::MAX)),
            items,
        }
    }

    /// The text of the events up to the current container's end (consumed),
    /// and which parts of it are verbatim source.
    fn plain_text(&mut self) -> (String, Vec<Source>) {
        let mut text = String::new();
        let mut sources = Vec::new();
        let mut depth = 0;
        while let Some((event, range)) = self.events.next() {
            match event {
                Event::Start(_) => depth += 1,
                Event::End(_) if depth == 0 => break,
                Event::End(_) => depth -= 1,
                Event::Text(s) => {
                    push_sources(&mut sources, &self.verbatim(&s, range), text.len());
                    text.push_str(&s);
                }
                Event::Code(s) | Event::Html(s) | Event::InlineHtml(s) => text.push_str(&s),
                Event::SoftBreak | Event::HardBreak => text.push('\n'),
                _ => {}
            }
        }
        (text, sources)
    }

    /// The text of the event at `range` as a [`Source`], if it is the
    /// source verbatim (no escapes or entities).
    fn verbatim(&self, text: &str, range: Range<usize>) -> Vec<Source> {
        if self.source.get(range.clone()) == Some(text) {
            vec![Source { at: 0, range }]
        } else {
            Vec::new()
        }
    }

    /// Inline content up to the next block event. `in_link` turns off tag
    /// scanning. With `close`, the container's end is expected and consumed;
    /// without, a run of loose content stops before any end.
    fn inlines(&mut self, in_link: bool, close: bool) -> Vec<Inline> {
        let mut pieces = Vec::new();
        // Inlines nested too deep, whose content joins this one.
        let mut flattened = 0;
        while let Some((event, _)) = self.events.peek() {
            if !is_inline(event) {
                let end = matches!(event, Event::End(_));
                if end && (close || flattened > 0) {
                    self.events.next();
                }
                if end && flattened > 0 {
                    flattened -= 1;
                    continue;
                }
                break;
            }
            let Some((event, range)) = self.events.next() else {
                break;
            };
            let text = |s: &str, scan| Piece::Text {
                text: s.to_string(),
                scan,
                sources: Vec::new(),
            };
            let piece = match event {
                Event::Text(s) => Piece::Text {
                    sources: self.verbatim(&s, range),
                    text: s.to_string(),
                    scan: true,
                },
                Event::Html(s) | Event::InlineHtml(s) => text(&s, false),
                Event::InlineMath(s) | Event::DisplayMath(s) => text(&s, false),
                Event::FootnoteReference(s) => text(&format!("[^{s}]"), false),
                Event::Code(s) => Piece::Inline(Inline::Code {
                    text: s.to_string(),
                }),
                Event::SoftBreak | Event::HardBreak => Piece::Inline(Inline::LineBreak),
                Event::TaskListMarker(checked) => {
                    self.task(checked, range);
                    continue;
                }
                Event::Start(Tag::Image { .. }) => {
                    let (text, sources) = self.plain_text();
                    Piece::Text {
                        text,
                        scan: !in_link,
                        sources,
                    }
                }
                Event::Start(_) if self.depth >= MAX_DEPTH => {
                    flattened += 1;
                    continue;
                }
                Event::Start(Tag::Emphasis) => Piece::Inline(Inline::Emphasis {
                    children: self.nested(|b| b.inlines(in_link, true)),
                }),
                Event::Start(Tag::Strong) => Piece::Inline(Inline::Strong {
                    children: self.nested(|b| b.inlines(in_link, true)),
                }),
                Event::Start(Tag::Strikethrough) => Piece::Inline(Inline::Strikethrough {
                    children: self.nested(|b| b.inlines(in_link, true)),
                }),
                Event::Start(Tag::Link {
                    link_type,
                    dest_url,
                    ..
                }) => {
                    // An email autolink's destination is the bare address.
                    let url = match link_type {
                        LinkType::Email => format!("mailto:{dest_url}"),
                        _ => dest_url.to_string(),
                    };
                    Piece::Inline(Inline::Link {
                        children: self.nested(|b| b.inlines(true, true)),
                        target: link_target(&url, self.installed),
                        url,
                    })
                }
                // Not enabled (superscript, subscript): keep the content.
                Event::Start(_) => {
                    let children = self.nested(|b| b.inlines(in_link, true));
                    pieces.extend(children.into_iter().map(Piece::Inline));
                    continue;
                }
                _ => continue,
            };
            pieces.push(piece);
        }
        self.finish(pieces, in_link)
    }

    /// Record a task marker on the innermost open list item. Every marker
    /// counts toward the next index, so indexes follow the markers in the
    /// source even if one can't be placed.
    fn task(&mut self, checked: bool, marker: Range<usize>) {
        if let Some(slot @ None) = self.items.last_mut() {
            *slot = Some(NoteTask {
                index: self.tasks,
                checked,
            });
        }
        self.tasks = self.tasks.saturating_add(1);
        self.markers.push(marker);
    }

    /// Merge adjacent text (the parser splits it, e.g. around `[`) and split
    /// the scanned runs into text and tags, noting where each tag is in the
    /// source.
    fn finish(&mut self, pieces: Vec<Piece>, in_link: bool) -> Vec<Inline> {
        let mut merged: Vec<Piece> = Vec::new();
        for piece in pieces {
            if let (
                Some(Piece::Text {
                    text,
                    scan,
                    sources,
                }),
                Piece::Text {
                    text: more,
                    scan: more_scan,
                    sources: more_sources,
                },
            ) = (merged.last_mut(), &piece)
            {
                if scan == more_scan {
                    push_sources(sources, more_sources, text.len());
                    text.push_str(more);
                    continue;
                }
            }
            merged.push(piece);
        }
        let mut out = Vec::new();
        for piece in merged {
            match piece {
                Piece::Text { text, .. } if text.is_empty() => {}
                Piece::Text {
                    text,
                    scan: true,
                    sources,
                } if !in_link => {
                    // A token is a tag only where it is the source verbatim
                    // and its `#` isn't escaped, so `\#x` and `#x&#95;y` are
                    // text. Rendering, tag sync and rename_tag then agree.
                    let mut tokens = tag_tokens(&text);
                    tokens.retain(|token| {
                        let source = sources
                            .iter()
                            .find(|s| s.at <= token.start && token.end <= s.at + s.range.len());
                        let Some(s) = source else {
                            return false;
                        };
                        let start = s.range.start + token.start - s.at;
                        if self.source[..start].ends_with('\\') {
                            return false;
                        }
                        self.tags.push(start..start + token.len());
                        true
                    });
                    out.extend(split_at_tags(&text, &tokens));
                }
                Piece::Text { text, .. } => out.push(Inline::Text { text }),
                Piece::Inline(inline) => out.push(inline),
            }
        }
        out
    }

    /// `f`, one container deeper.
    fn nested<T>(&mut self, f: impl FnOnce(&mut Self) -> T) -> T {
        self.depth += 1;
        let out = f(self);
        self.depth -= 1;
        out
    }
}

/// A paragraph of `inlines`, as a passage card when its only content is one
/// passage link; nothing when empty.
fn paragraph(inlines: Vec<Inline>) -> Option<Block> {
    let mut content = inlines.iter().filter(|i| match i {
        Inline::Text { text } => !text.trim().is_empty(),
        _ => true,
    });
    if let (
        Some(Inline::Link {
            children,
            target: LinkTarget::Passage { span, missing },
            ..
        }),
        None,
    ) = (content.next(), content.next())
    {
        return Some(Block::PassageCard {
            text: plain(children),
            span: span.clone(),
            missing: *missing,
        });
    }
    (!inlines.is_empty()).then_some(Block::Paragraph { inlines })
}

/// The plain text of `inlines`: their text, code and tags, without styling.
fn plain(inlines: &[Inline]) -> String {
    let mut out = String::new();
    for inline in inlines {
        match inline {
            Inline::Text { text } | Inline::Code { text } => out.push_str(text),
            Inline::Tag { name } => {
                out.push('#');
                out.push_str(name);
            }
            Inline::LineBreak => out.push(' '),
            Inline::Emphasis { children }
            | Inline::Strong { children }
            | Inline::Strikethrough { children }
            | Inline::Link { children, .. } => out.push_str(&plain(children)),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const NWT: &str = "nwtsty:0:0";
    const IT: &str = "it:0:0";

    fn text(s: &str) -> Inline {
        Inline::Text { text: s.into() }
    }

    fn tag(s: &str) -> Inline {
        Inline::Tag { name: s.into() }
    }

    fn para(inlines: Vec<Inline>) -> Block {
        Block::Paragraph { inlines }
    }

    fn bible(pub_key: &str, book: u32, chapter: u32, verse: Option<u32>) -> Location {
        Location {
            pub_key: pub_key.into(),
            doc_id: None,
            book: Some(book),
            chapter: Some(chapter),
            verse,
            paragraph: None,
        }
    }

    fn span(start: Location, end: Location) -> LocationSpan {
        LocationSpan { start, end }
    }

    /// One verse of the NWT study edition.
    fn verse(book: u32, chapter: u32, verse: u32) -> LocationSpan {
        let at = bible(NWT, book, chapter, Some(verse));
        span(at.clone(), at)
    }

    fn publication(doc_id: Option<i64>, paragraph: Option<u32>) -> Location {
        Location {
            pub_key: IT.into(),
            doc_id,
            book: None,
            chapter: None,
            verse: None,
            paragraph,
        }
    }

    /// Only the NWT study edition is installed.
    fn render_nwt(markdown: &str) -> Vec<Block> {
        render(markdown, &|key| key == NWT)
    }

    fn passage(path: &str) -> Option<LocationSpan> {
        parse_passage(&format!("berean://bible/{NWT}/{path}"))
    }

    // URLs.

    #[test]
    fn parses_the_passage_examples() {
        assert_eq!(passage("43/1/9"), Some(verse(43, 1, 9)));
        assert_eq!(
            passage("43/1/1-5"),
            Some(span(bible(NWT, 43, 1, Some(1)), bible(NWT, 43, 1, Some(5))))
        );
        assert_eq!(
            passage("43/1/51-2/3"),
            Some(span(
                bible(NWT, 43, 1, Some(51)),
                bible(NWT, 43, 2, Some(3))
            ))
        );
        let psalm = bible(NWT, 19, 36, None);
        assert_eq!(passage("19/36"), Some(span(psalm.clone(), psalm)));
        assert_eq!(
            passage("43/3-4"),
            Some(span(bible(NWT, 43, 3, None), bible(NWT, 43, 4, None)))
        );
        // A psalm's superscription is verse 0.
        assert_eq!(passage("19/3/0"), Some(verse(19, 3, 0)));
        assert_eq!(
            passage("19/3/0-1"),
            Some(span(bible(NWT, 19, 3, Some(0)), bible(NWT, 19, 3, Some(1))))
        );
    }

    #[test]
    fn parses_publication_urls() {
        let url = |rest: &str| parse_publication(&format!("berean://pub/{IT}{rest}"));
        assert_eq!(url(""), Some(publication(None, None)));
        assert_eq!(
            url("/1200002712"),
            Some(publication(Some(1200002712), None))
        );
        assert_eq!(
            url("/1200002712/3"),
            Some(publication(Some(1200002712), Some(3)))
        );
        for bad in ["/", "/x", "/1/x", "/1/2/3", "/01", "/1/"] {
            assert_eq!(url(bad), None, "{bad}");
        }
    }

    #[test]
    fn malformed_berean_urls_are_invalid() {
        let target = |url: &str| link_target(url, &|_| true);
        for path in [
            "0/1/1",
            "67/1/1",
            "43/0",
            "43/0/1",
            "43/1/5-3",
            "43/4-3",
            "43/2/1-1/5",
            "43/x/1",
            "43/1/1/1",
            "43/1/",
            "43/1/1-",
            "43/01/1",
            "43/1/+1",
            "43",
            "43/1-2/3",
            "43/1/1-2-3",
            "43/1/1?x",
            "",
        ] {
            let url = format!("berean://bible/{NWT}/{path}");
            assert_eq!(target(&url), LinkTarget::Invalid, "{url}");
        }
        for url in [
            "berean://bible/43/1/1",
            "berean://bible//43/1/1",
            "berean://bible/nwtsty/43/1/1",
            "berean://bible/nwtsty:0:x/43/1/1",
            "berean://bible/:0:0/43/1/1",
            "berean://pub/",
            "berean://pub/it:0",
            "berean://other/nwtsty:0:0/43/1/1",
            "berean://",
            "berean:bible/nwtsty:0:0/43/1/1",
        ] {
            assert_eq!(target(url), LinkTarget::Invalid, "{url}");
        }
    }

    #[test]
    fn web_and_mail_links_are_external_others_invalid() {
        let target = |url: &str| link_target(url, &|_| true);
        for url in [
            "https://jw.org",
            "http://x.org/a",
            "HTTPS://X.ORG",
            "mailto:a@b.org",
        ] {
            assert_eq!(target(url), LinkTarget::External { url: url.into() });
        }
        for url in [
            "ftp://x.org",
            "notes/other.md",
            "/abs",
            "#top",
            "",
            "javascript:alert(1)",
        ] {
            assert_eq!(target(url), LinkTarget::Invalid, "{url}");
        }
    }

    #[test]
    fn missing_follows_the_installed_list() {
        let nwt_only = |key: &str| key == NWT;
        let it_only = |key: &str| key == IT;
        let url = format!("berean://bible/{NWT}/43/1/9");
        let passage = |missing| LinkTarget::Passage {
            span: verse(43, 1, 9),
            missing,
        };
        assert_eq!(link_target(&url, &nwt_only), passage(false));
        assert_eq!(link_target(&url, &it_only), passage(true));
        let url = format!("berean://pub/{IT}/5");
        let publication = |missing| LinkTarget::Publication {
            location: publication(Some(5), None),
            missing,
        };
        assert_eq!(link_target(&url, &it_only), publication(false));
        assert_eq!(link_target(&url, &nwt_only), publication(true));
    }

    #[test]
    fn urls_round_trip() {
        for path in [
            "43/1/9",
            "43/1/1-5",
            "43/1/51-2/3",
            "19/36",
            "43/3-4",
            "19/3/0",
            "65/1/3",
        ] {
            let url = format!("berean://bible/{NWT}/{path}");
            let span = parse_passage(&url).unwrap();
            assert_eq!(passage_url(&span).unwrap(), url);
            assert_eq!(parse_passage(&passage_url(&span).unwrap()), Some(span));
        }
        for location in [
            publication(None, None),
            publication(Some(1200002712), None),
            publication(Some(1200002712), Some(0)),
            Location {
                pub_key: "w26:0:20260800".into(),
                ..publication(Some(2026601), Some(4))
            },
        ] {
            let url = publication_url(&location).unwrap();
            assert_eq!(parse_publication(&url), Some(location));
        }
    }

    #[test]
    fn passage_url_takes_a_resolved_span() {
        // `Reader::resolve` sets the book's document id; the URL leaves it out.
        let mut span = verse(43, 1, 14);
        span.start.doc_id = Some(1001070143);
        span.end.doc_id = Some(1001070143);
        assert_eq!(
            passage_url(&span).unwrap(),
            format!("berean://bible/{NWT}/43/1/14")
        );
    }

    #[test]
    fn passage_url_rejects_non_passages() {
        let v = |chapter, verse| bible(NWT, 43, chapter, verse);
        let with = |f: fn(&mut Location)| {
            let mut location = v(1, Some(1));
            f(&mut location);
            span(location.clone(), location)
        };
        let mut other_bible = v(1, Some(2));
        other_bible.pub_key = "nwt:0:0".into();
        let mut other_book = v(1, Some(2));
        other_book.book = Some(44);
        let bad = [
            span(v(1, Some(1)), other_bible),
            span(v(1, Some(1)), other_book),
            with(|l| l.book = None),
            with(|l| l.chapter = None),
            with(|l| l.paragraph = Some(1)),
            with(|l| l.pub_key = "nwtsty".into()),
            with(|l| l.pub_key = "a/b:0:0".into()),
            with(|l| l.chapter = Some(0)),
            with(|l| l.book = Some(0)),
            with(|l| l.book = Some(67)),
            span(v(1, Some(5)), v(1, Some(3))),
            span(v(2, Some(1)), v(1, Some(9))),
            span(v(4, None), v(3, None)),
            span(v(1, Some(1)), v(2, None)),
            span(v(1, None), v(2, Some(1))),
        ];
        for span in bad {
            assert!(
                matches!(passage_url(&span), Err(CoreError::Invalid(_))),
                "{span:?}"
            );
        }
    }

    #[test]
    fn publication_url_rejects_non_publications() {
        let with = |f: fn(&mut Location)| {
            let mut location = publication(Some(1), Some(2));
            f(&mut location);
            location
        };
        for location in [
            with(|l| l.book = Some(43)),
            with(|l| l.chapter = Some(1)),
            with(|l| l.verse = Some(1)),
            with(|l| l.doc_id = None),
            with(|l| l.pub_key = "it".into()),
            with(|l| l.pub_key = "i/t:0:0".into()),
        ] {
            assert!(
                matches!(publication_url(&location), Err(CoreError::Invalid(_))),
                "{location:?}"
            );
        }
    }

    // Rendering.

    #[test]
    fn renders_the_guide_sample_note() {
        let markdown = format!(
            "# Light before law\n\
             \n\
             The first thing God says is **not** a law; it is light. \
             [John 1:9](berean://bible/{NWT}/43/1/9) calls the Word *the true light*.\n\
             \n\
             ## Threads to follow\n\
             \n\
             - [Psalm 36:9](berean://bible/{NWT}/19/36/9) — the source of life\n\
             - [Insight, \"Light\"](berean://pub/{IT}/1200002712) — not downloaded\n\
             \n\
             To do:\n\
             \n\
             - [x] Compare Genesis 1:3\n\
             - [ ] Read John 1:14 again\n\
             \n\
             > The light shines in the darkness.\n\
             \n\
             [John 1:1-5](berean://bible/{NWT}/43/1/1-5)\n\
             \n\
             Search with `#light -#sermons` to skip sermon notes.\n\
             \n\
             ---\n\
             \n\
             #prologue #light\n"
        );
        let item = |task, inlines| ListItem {
            task,
            blocks: vec![para(inlines)],
        };
        let link = |label: &str, url: String, target| Inline::Link {
            children: vec![text(label)],
            url,
            target,
        };
        let expected = vec![
            Block::Heading {
                level: 1,
                inlines: vec![text("Light before law")],
            },
            para(vec![
                text("The first thing God says is "),
                Inline::Strong {
                    children: vec![text("not")],
                },
                text(" a law; it is light. "),
                link(
                    "John 1:9",
                    format!("berean://bible/{NWT}/43/1/9"),
                    LinkTarget::Passage {
                        span: verse(43, 1, 9),
                        missing: false,
                    },
                ),
                text(" calls the Word "),
                Inline::Emphasis {
                    children: vec![text("the true light")],
                },
                text("."),
            ]),
            Block::Heading {
                level: 2,
                inlines: vec![text("Threads to follow")],
            },
            Block::List {
                start: None,
                items: vec![
                    item(
                        None,
                        vec![
                            link(
                                "Psalm 36:9",
                                format!("berean://bible/{NWT}/19/36/9"),
                                LinkTarget::Passage {
                                    span: verse(19, 36, 9),
                                    missing: false,
                                },
                            ),
                            text(" — the source of life"),
                        ],
                    ),
                    item(
                        None,
                        vec![
                            link(
                                "Insight, \"Light\"",
                                format!("berean://pub/{IT}/1200002712"),
                                LinkTarget::Publication {
                                    location: publication(Some(1200002712), None),
                                    missing: true,
                                },
                            ),
                            text(" — not downloaded"),
                        ],
                    ),
                ],
            },
            para(vec![text("To do:")]),
            Block::List {
                start: None,
                items: vec![
                    item(
                        Some(NoteTask {
                            index: 0,
                            checked: true,
                        }),
                        vec![text("Compare Genesis 1:3")],
                    ),
                    item(
                        Some(NoteTask {
                            index: 1,
                            checked: false,
                        }),
                        vec![text("Read John 1:14 again")],
                    ),
                ],
            },
            Block::Quote {
                blocks: vec![para(vec![text("The light shines in the darkness.")])],
            },
            Block::PassageCard {
                text: "John 1:1-5".into(),
                span: span(bible(NWT, 43, 1, Some(1)), bible(NWT, 43, 1, Some(5))),
                missing: false,
            },
            para(vec![
                text("Search with "),
                Inline::Code {
                    text: "#light -#sermons".into(),
                },
                text(" to skip sermon notes."),
            ]),
            Block::Rule,
            para(vec![tag("prologue"), text(" "), tag("light")]),
        ];
        assert_eq!(render_nwt(&markdown), expected);
    }

    #[test]
    fn soft_breaks_are_line_breaks() {
        // A legacy JW note: plain text, one line per thought.
        assert_eq!(
            render_nwt("Read John 1\nthen Genesis 1"),
            [para(vec![
                text("Read John 1"),
                Inline::LineBreak,
                text("then Genesis 1"),
            ])]
        );
        assert_eq!(
            render_nwt("Read John 1\n\nthen Genesis 1"),
            [
                para(vec![text("Read John 1")]),
                para(vec![text("then Genesis 1")]),
            ]
        );
        assert_eq!(
            render_nwt("hard  \nbreak"),
            [para(vec![text("hard"), Inline::LineBreak, text("break")])]
        );
    }

    #[test]
    fn raw_html_is_text() {
        assert_eq!(
            render_nwt("a <b>bold</b> #x"),
            [para(vec![
                text("a "),
                text("<b>"),
                text("bold"),
                text("</b>"),
                text(" "),
                tag("x"),
            ])]
        );
        assert_eq!(
            render_nwt("<div>\n#not-a-tag\n</div>"),
            [para(vec![text("<div>\n#not-a-tag\n</div>")])]
        );
    }

    #[test]
    fn images_are_their_alt_text() {
        assert_eq!(
            render_nwt("see ![a *lamp*](https://x.org/l.png) here"),
            [para(vec![text("see a lamp here")])]
        );
    }

    #[test]
    fn headings_and_tags() {
        assert_eq!(
            render_nwt("# Light"),
            [Block::Heading {
                level: 1,
                inlines: vec![text("Light")],
            }]
        );
        assert_eq!(render_nwt("#light"), [para(vec![tag("light")])]);
        // Escapes and entities make a `#name` text, as rename_tag can't
        // rewrite it in place.
        assert_eq!(render_nwt("a \\#x"), [para(vec![text("a #x")])]);
        assert_eq!(
            render_nwt("#x&#95;y #z"),
            [para(vec![text("#x_y "), tag("z")])]
        );
        assert_eq!(inline_tags("\\#x #a\\_b #c"), ["c"]);
        assert_eq!(
            render_nwt("###### Deep #tag"),
            [Block::Heading {
                level: 6,
                inlines: vec![text("Deep "), tag("tag")],
            }]
        );
    }

    #[test]
    fn tag_boundaries() {
        assert_eq!(split_tags("a#b"), [text("a#b")]);
        assert_eq!(split_tags("##b #"), [text("##b #")]);
        assert_eq!(split_tags("#luz_é ok"), [tag("luz_é"), text(" ok")]);
        assert_eq!(
            split_tags("(#a-b, #c)"),
            [text("("), tag("a-b"), text(", "), tag("c"), text(")")]
        );
        assert_eq!(split_tags("x #a#b"), [text("x "), tag("a"), text("#b")]);
        assert_eq!(split_tags("#日本"), [tag("日本")]);
        // The parser splits text at `[`; the run is merged before scanning.
        assert_eq!(render_nwt("[#light"), [para(vec![text("["), tag("light")])]);
        // After a styled inline, a run starts afresh.
        assert_eq!(
            render_nwt("**a**#b"),
            [para(vec![
                Inline::Strong {
                    children: vec![text("a")],
                },
                tag("b"),
            ])]
        );
    }

    #[test]
    fn no_tags_in_code_or_link_text() {
        assert_eq!(
            render_nwt("[#a *#b*](https://x.org/#c)"),
            [para(vec![Inline::Link {
                children: vec![
                    text("#a "),
                    Inline::Emphasis {
                        children: vec![text("#b")],
                    },
                ],
                url: "https://x.org/#c".into(),
                target: LinkTarget::External {
                    url: "https://x.org/#c".into(),
                },
            }])]
        );
        assert_eq!(
            render_nwt("```md\n#a\n```\n\n    #b\n"),
            [
                Block::CodeBlock { text: "#a".into() },
                Block::CodeBlock { text: "#b".into() },
            ]
        );
    }

    #[test]
    fn autolinks_are_links() {
        let link = |label: &str, url: &str| Inline::Link {
            children: vec![text(label)],
            url: url.into(),
            target: LinkTarget::External { url: url.into() },
        };
        assert_eq!(
            render_nwt("<https://jw.org> <me@x.org>"),
            [para(vec![
                link("https://jw.org", "https://jw.org"),
                text(" "),
                link("me@x.org", "mailto:me@x.org"),
            ])]
        );
    }

    #[test]
    fn a_lone_publication_link_stays_a_paragraph() {
        let url = format!("berean://pub/{IT}");
        assert_eq!(
            render_nwt(&format!("[Insight]({url})")),
            [para(vec![Inline::Link {
                children: vec![text("Insight")],
                url,
                target: LinkTarget::Publication {
                    location: publication(None, None),
                    missing: true,
                },
            }])]
        );
    }

    #[test]
    fn passage_cards_carry_missing() {
        let url = format!("berean://bible/{NWT}/43/1/9");
        let card = |missing| {
            vec![Block::PassageCard {
                text: "John 1:9".into(),
                span: verse(43, 1, 9),
                missing,
            }]
        };
        assert_eq!(
            render(&format!("[John *1:9*]({url})"), &|_| true),
            card(false)
        );
        assert_eq!(
            render(&format!("[John 1:9]({url})"), &|_| false),
            card(true)
        );
        // Anything else in the paragraph keeps it a paragraph.
        let blocks = render_nwt(&format!("See [John 1:9]({url})"));
        assert!(
            matches!(&blocks[..], [Block::Paragraph { .. }]),
            "{blocks:?}"
        );
    }

    #[test]
    fn lists() {
        assert_eq!(
            render_nwt("3. a\n4. b"),
            [Block::List {
                start: Some(3),
                items: vec![
                    ListItem {
                        task: None,
                        blocks: vec![para(vec![text("a")])],
                    },
                    ListItem {
                        task: None,
                        blocks: vec![para(vec![text("b")])],
                    },
                ],
            }]
        );
        // Loose items wrap their text in paragraphs; tasks number through
        // nested lists in document order.
        let task = |index, checked| Some(NoteTask { index, checked });
        assert_eq!(
            render_nwt("- [ ] a\n\n  - [x] b\n- [x] c\n"),
            [Block::List {
                start: None,
                items: vec![
                    ListItem {
                        task: task(0, false),
                        blocks: vec![
                            para(vec![text("a")]),
                            Block::List {
                                start: None,
                                items: vec![ListItem {
                                    task: task(1, true),
                                    blocks: vec![para(vec![text("b")])],
                                }],
                            },
                        ],
                    },
                    ListItem {
                        task: task(2, true),
                        blocks: vec![para(vec![text("c")])],
                    },
                ],
            }]
        );
    }

    #[test]
    fn strikethrough() {
        assert_eq!(
            render_nwt("~~old~~ new"),
            [para(vec![
                Inline::Strikethrough {
                    children: vec![text("old")],
                },
                text(" new"),
            ])]
        );
    }

    #[test]
    fn odd_inputs_do_not_panic() {
        assert_eq!(render_nwt(""), Vec::<Block>::new());
        assert_eq!(
            render_nwt("#"),
            [Block::Heading {
                level: 1,
                inlines: vec![],
            }]
        );
        assert_eq!(render_nwt("[unclosed"), [para(vec![text("[unclosed")])]);
        let deep = render_nwt(">>>>> deep");
        let mut block = &deep[0];
        for _ in 0..5 {
            let Block::Quote { blocks } = block else {
                panic!("{deep:?}");
            };
            block = &blocks[0];
        }
        assert_eq!(block, &para(vec![text("deep")]));
        // Nesting past MAX_DEPTH is flattened, keeping its content.
        let deep = render_nwt(&(">".repeat(100_000) + " deep"));
        let (mut blocks, mut quotes) = (&deep[..], 0);
        while let [Block::Quote { blocks: inner }] = blocks {
            blocks = inner;
            quotes += 1;
        }
        assert_eq!(quotes, MAX_DEPTH);
        assert_eq!(blocks, [para(vec![text("deep")])]);
        let brackets = "[".repeat(100_000);
        let quotes = "> - ".repeat(50_000) + "a";
        let bullets = "- ".repeat(100_000) + "[ ] a";
        let stars = "*".repeat(50_000) + "a" + &"*".repeat(50_000);
        let links = "[a ".repeat(50_000) + &"](https://x.org)".repeat(50_000);
        for odd in [
            "- [ ]",
            "1.",
            "[a](",
            "![",
            "<",
            "| a | b |\n|---|---|\n| 1 | 2 |",
            "[^1]\n\n[^1]: note",
            "$x$",
            "***\n___",
            "\u{0}#\u{0}",
            "#\u{301}x é#x",
            &brackets,
            &quotes,
            &bullets,
            &stars,
            &links,
        ] {
            render_nwt(odd);
            inline_tags(odd);
        }
    }

    #[test]
    fn inline_tags_are_distinct_in_order() {
        let markdown = "#b and #a\n\n\
                        `#code` [#link](https://x.org) ![#alt](x.png)\n\n\
                        ```\n#fenced\n```\n\n\
                        > - #c **#a**\n\n\
                        # Heading #d\n\
                        [John 1:9](berean://bible/nwtsty:0:0/43/1/9) #e";
        assert_eq!(inline_tags(markdown), ["b", "a", "alt", "c", "d", "e"]);
    }

    /// The source text of each tag token `parse` reports.
    fn tag_sources(markdown: &str) -> Vec<&str> {
        parse(markdown, &|_| true)
            .tags
            .into_iter()
            .map(|r| &markdown[r])
            .collect()
    }

    #[test]
    fn tag_tokens_map_to_the_source() {
        assert_eq!(
            tag_sources("# H #a\n\n- x *#b* [#no](u) #c_d-e ![#f](i.png)\n\n> #g\n> #h"),
            ["#a", "#b", "#c_d-e", "#f", "#g", "#h"]
        );
        // Every tag `render` finds maps, bar ones with an escape or entity.
        assert_eq!(tag_sources("[#a"), ["#a"]);
        assert_eq!(tag_sources("#a&amp;b #c"), ["#a", "#c"]);
        assert_eq!(tag_sources("#x&#95;y #z"), ["#z"]);
        assert_eq!(tag_sources("#a\\_b #c"), ["#c"]);
        assert_eq!(tag_sources("`#a` <b>#c</b>"), ["#c"]);
        assert_eq!(tag_sources("#日本 #luz"), ["#日本", "#luz"]);
    }

    #[test]
    fn renames_whole_inline_tokens_only() {
        let body = "#light #LIGHT #lights #light-x x#light `#light` [#light](u#light) #light\n";
        assert_eq!(
            rename_inline_tag(body, "Light", "lumen"),
            "#lumen #lumen #lights #light-x x#light `#light` [#light](u#light) #lumen\n"
        );
        assert_eq!(rename_inline_tag("#ÑANDÚ", "ñandú", "x"), "#x");
        assert_eq!(rename_inline_tag("no tags", "a", "b"), "no tags");
    }

    #[test]
    fn set_task_flips_one_marker() {
        let body = "- [ ] a\n  * [x] b\n1. [X] c\n- [\u{a0}] not a task\n";
        assert_eq!(
            set_task(body, 0, true).unwrap(),
            "- [x] a\n  * [x] b\n1. [X] c\n- [\u{a0}] not a task\n"
        );
        assert_eq!(set_task(body, 1, true).unwrap(), body);
        assert_eq!(
            set_task(body, 1, false).unwrap(),
            "- [ ] a\n  * [ ] b\n1. [X] c\n- [\u{a0}] not a task\n"
        );
        assert_eq!(set_task(body, 2, true).unwrap(), body);
        assert_eq!(
            set_task(body, 2, false).unwrap(),
            "- [ ] a\n  * [x] b\n1. [ ] c\n- [\u{a0}] not a task\n"
        );
        assert_eq!(set_task(body, 3, true), None);
        assert_eq!(set_task("", 0, true), None);
        // CRLF and tabs around the marker are kept.
        assert_eq!(
            set_task("-\t[ ]\tx\r\n- [ ] y\r\n", 1, true).unwrap(),
            "-\t[ ]\tx\r\n- [x] y\r\n"
        );
    }
}
