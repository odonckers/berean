//! The syntax ranges of a note's Markdown source, for the Write view: see
//! [`markdown_spans`].

use std::ops::Range;

use pulldown_cmark::{CowStr, Event, LinkType, Parser, Tag};

use super::{options, parse};

/// One syntax range of a note's Markdown source, for the Write view.
///
/// `start..end` is half-open, in UTF-16 code units: what JS strings and
/// NSString/NSRange index by, so both apps apply it without converting. It
/// never splits a surrogate pair, and `start < end` always. `u32`, not
/// `u64`, so it stays a plain `number` in TypeScript.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SourceSpan {
    pub start: u32,
    pub end: u32,
    pub kind: SpanKind,
}

/// What a [`SourceSpan`] is. All but [`SpanKind::Code`] and
/// [`SpanKind::Tag`] are syntax the Read view hides.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SpanKind {
    /// An ATX heading's `#`s (the opening run and an optional closing one),
    /// or a setext heading's `===` / `---` underline.
    HeadingMarker,
    /// `*` / `_` around emphasis.
    EmphasisMarker,
    /// `**` / `__` around strong.
    StrongMarker,
    /// `~~` / `~` around strikethrough.
    StrikeMarker,
    /// An inline code span's backticks, or a fenced code block's fence lines
    /// (fence and info string).
    CodeMarker,
    /// An inline code span's content between its backticks, or each content
    /// line of a code block (fenced or indented), without its line end.
    Code,
    /// A link's or image's punctuation: everything of its source but its text
    /// and its URL. `!`, `[`, `](`, `)`, an autolink's `<` `>`, `][ref]`, a
    /// title and its quotes.
    LinkBracket,
    /// An inline link's or image's destination, where it appears verbatim in
    /// the source (so the Write view can fold it).
    LinkUrl,
    /// `-`, `*`, `+`, `1.`, `1)`.
    ListMarker,
    /// `[ ]`, `[x]`.
    TaskMarker,
    /// Each `>` of a block quote, on every line.
    QuoteMarker,
    /// A thematic break line.
    Rule,
    /// An inline `#tag`: exactly the ranges inline tag sync and `rename_tag`
    /// use.
    Tag,
}

/// The syntax ranges of `markdown`'s source, from the same parse as
/// `render_markdown`, so the Write view marks exactly the syntax the Read
/// view hides. Never fails: Markdown has no syntax errors.
///
/// - Offsets are UTF-16 code units, half-open (see [`SourceSpan`]).
/// - Flat: spans never overlap, and come sorted by `start`. There are no
///   spans for whole constructs, so a heading's or a link's text is
///   unstyled; only [`SpanKind::Code`] and [`SpanKind::Tag`] cover content.
/// - Each span is one run of non-whitespace, so indentation and line ends
///   stay unstyled.
/// - Unstyled, having no kind: backslash escapes, entities, raw HTML, link
///   reference definitions (`[ref]: /url`) and hard breaks. The `>`s of a
///   quote are still marked on those lines, and inside code blocks and
///   lists. The exception: an inline code span that wraps onto a quoted
///   line is one [`SpanKind::Code`], that line's `>` included.
/// - Tags inside code or link text aren't tags.
///
/// Linear in the source, plus a sort of the spans: cheap enough to call on
/// every keystroke (a median of about 0.3 ms for a 10,000-character note in
/// a release build; see `markdown_spans_10k_timing`). Nesting depth costs
/// heap, not stack.
pub fn markdown_spans(markdown: &str) -> Vec<SourceSpan> {
    let spans = byte_spans(markdown);
    let mut units = Utf16::new(markdown);
    let mut out = Vec::with_capacity(spans.len());
    let mut last = 0;
    for (range, kind) in spans {
        // Already sorted and disjoint; this only guards the promise.
        if range.start < last || range.start >= range.end || range.end > markdown.len() {
            continue;
        }
        last = range.end;
        out.push(SourceSpan {
            start: units.at(range.start),
            end: units.at(range.end),
            kind,
        });
    }
    out
}

/// The spans in byte offsets, sorted by start.
fn byte_spans(markdown: &str) -> Vec<(Range<usize>, SpanKind)> {
    let mut spans = Vec::new();
    // Open containers, innermost last; the document is always first. The
    // walk is iterative because nesting is unbounded.
    let mut frames = vec![Frame::new(0..markdown.len(), None, false)];
    for (event, range) in Parser::new_ext(markdown, options()).into_offset_iter() {
        if let Event::End(_) = event {
            if frames.len() > 1 {
                let frame = frames.pop().expect("more than the document is open");
                frame.close(markdown, &mut spans);
            }
            continue;
        }
        // Any other event is a child of the innermost frame: the source
        // before it is the frame's syntax.
        let parent = frames.last_mut().expect("the document stays open");
        parent.gap_to(range.start, true, markdown, &mut spans);
        parent.cursor = parent.cursor.max(range.end);
        let (in_code_block, quoted) = (parent.code_block, parent.quoted);
        match event {
            Event::Start(tag) => frames.push(Frame::new(range, Some(tag), quoted)),
            // One span per content line, without its line end.
            Event::Text(_) if in_code_block => {
                let mut at = range.start;
                for line in markdown.get(range).unwrap_or("").split_inclusive('\n') {
                    let content = line.trim_end_matches(['\n', '\r']).len();
                    spans.push((at..at + content, SpanKind::Code));
                    at += line.len();
                }
            }
            Event::Code(_) => {
                // The opening and closing backtick runs have the same length.
                let ticks = markdown
                    .get(range.clone())
                    .map_or(0, |s| s.bytes().take_while(|&b| b == b'`').count());
                if ticks > 0 && 2 * ticks < range.len() {
                    spans.push((range.start..range.start + ticks, SpanKind::CodeMarker));
                    spans.push((range.start + ticks..range.end - ticks, SpanKind::Code));
                    spans.push((range.end - ticks..range.end, SpanKind::CodeMarker));
                }
            }
            Event::TaskListMarker(_) => {
                push_trimmed(&mut spans, markdown, range, SpanKind::TaskMarker)
            }
            Event::Rule => push_trimmed(&mut spans, markdown, range, SpanKind::Rule),
            // Text, breaks, raw HTML and anything not enabled: unstyled.
            _ => {}
        }
    }
    while let Some(frame) = frames.pop() {
        frame.close(markdown, &mut spans);
    }
    // Tags are only ever inside text, so they overlap nothing above.
    spans.extend(
        parse(markdown, &|_| true)
            .tags
            .into_iter()
            .map(|r| (r, SpanKind::Tag)),
    );
    spans.retain(|(r, _)| r.start < r.end);
    spans.sort_unstable_by_key(|(r, _)| r.start);
    spans
}

/// An open container: a block, an inline or the document. The source in
/// its range that no child event covers is its syntax.
struct Frame<'m> {
    range: Range<usize>,
    /// Where the source not yet covered by a child starts.
    cursor: usize,
    /// The kind of the frame's own syntax, if it has one.
    marker: Option<SpanKind>,
    /// A list item whose marker hasn't been seen yet.
    item: bool,
    code_block: bool,
    /// Inside a block quote (or one itself), so its line prefixes have `>`s.
    quoted: bool,
    /// Starts at its first `>`, so its first gap starts a line prefix.
    quote: bool,
    /// An inline link's or image's destination, to find in its source.
    dest: Option<CowStr<'m>>,
}

impl<'m> Frame<'m> {
    fn new(range: Range<usize>, tag: Option<Tag<'m>>, quoted: bool) -> Self {
        let marker = match &tag {
            Some(Tag::Heading { .. }) => Some(SpanKind::HeadingMarker),
            Some(Tag::Emphasis) => Some(SpanKind::EmphasisMarker),
            Some(Tag::Strong) => Some(SpanKind::StrongMarker),
            Some(Tag::Strikethrough) => Some(SpanKind::StrikeMarker),
            Some(Tag::CodeBlock(_)) => Some(SpanKind::CodeMarker),
            Some(Tag::Link { .. } | Tag::Image { .. }) => Some(SpanKind::LinkBracket),
            _ => None,
        };
        let quote = matches!(tag, Some(Tag::BlockQuote(_)));
        let item = matches!(tag, Some(Tag::Item));
        let code_block = matches!(tag, Some(Tag::CodeBlock(_)));
        let dest = match tag {
            Some(
                Tag::Link {
                    link_type: LinkType::Inline,
                    dest_url,
                    ..
                }
                | Tag::Image {
                    link_type: LinkType::Inline,
                    dest_url,
                    ..
                },
            ) => Some(dest_url).filter(|d| !d.is_empty()),
            _ => None,
        };
        Frame {
            cursor: range.start,
            range,
            marker,
            item,
            code_block,
            quoted: quoted || quote,
            quote,
            dest,
        }
    }

    /// Emit the source from the cursor to `to` as syntax, and move the
    /// cursor there. `before_child`: a child event starts at `to`.
    ///
    /// Per character: whitespace is unstyled; a `>` that only whitespace
    /// and `>`s precede on its line (within the gap) is a quote marker, when
    /// quoted; a `\` escaping the child's first character is unstyled; an
    /// item's first run is its marker; the rest is the frame's own syntax.
    fn gap_to(
        &mut self,
        to: usize,
        before_child: bool,
        source: &str,
        spans: &mut Vec<(Range<usize>, SpanKind)>,
    ) {
        let to = to.min(self.range.end);
        let from = self.cursor;
        self.cursor = self.cursor.max(to);
        let Some(text) = source.get(from..to).filter(|t| !t.is_empty()) else {
            return;
        };
        let bytes = source.as_bytes();
        let escape = before_child
            && text.ends_with('\\')
            && bytes.get(to).is_some_and(u8::is_ascii_punctuation);
        let mut prefix = from == 0
            || bytes[from - 1] == b'\n'
            || bytes[from - 1] == b'\r'
            || (self.quote && from == self.range.start);
        // The run being built: its start and kind.
        let mut run: Option<(usize, SpanKind)> = None;
        for (i, c) in text.char_indices() {
            let at = from + i;
            let kind = if c == '\n' || c == '\r' {
                prefix = true;
                None
            } else if c.is_whitespace() {
                None
            } else if prefix && c == '>' && self.quoted {
                Some(SpanKind::QuoteMarker)
            } else {
                prefix = false;
                if escape && at + 1 == to {
                    None
                } else if self.item {
                    Some(SpanKind::ListMarker)
                } else {
                    self.marker
                }
            };
            if run.is_some_and(|(_, k)| Some(k) != kind) {
                let (start, k) = run.take().expect("checked");
                if k == SpanKind::ListMarker {
                    self.item = false;
                }
                spans.push((start..at, k));
            }
            if run.is_none() {
                run = kind.map(|k| (at, k));
            }
        }
        if let Some((start, k)) = run {
            if k == SpanKind::ListMarker {
                self.item = false;
            }
            spans.push((start..to, k));
        }
    }

    /// Emit the rest of the frame's source: an inline link's destination,
    /// where it is verbatim after the link text, and syntax.
    fn close(mut self, source: &str, spans: &mut Vec<(Range<usize>, SpanKind)>) {
        if let Some(dest) = self.dest.take() {
            let after_text = source.get(self.cursor..self.range.end).unwrap_or("");
            // Past the `](`, so a destination like `(` isn't found in it.
            let skip = if after_text.starts_with("](") { 2 } else { 0 };
            if let Some(at) = after_text[skip..].find(&*dest) {
                let at = self.cursor + skip + at;
                self.gap_to(at, false, source, spans);
                spans.push((at..at + dest.len(), SpanKind::LinkUrl));
                self.cursor = at + dest.len();
            }
        }
        self.gap_to(self.range.end, false, source, spans);
    }
}

/// Push `range` without its trailing whitespace.
fn push_trimmed(
    spans: &mut Vec<(Range<usize>, SpanKind)>,
    source: &str,
    range: Range<usize>,
    kind: SpanKind,
) {
    if let Some(text) = source.get(range.clone()) {
        spans.push((range.start..range.start + text.trim_end().len(), kind));
    }
}

/// Converts ascending byte offsets of a string to UTF-16 offsets, in one
/// pass over it whatever the number of offsets.
struct Utf16<'a> {
    bytes: &'a [u8],
    byte: usize,
    units: u32,
}

impl<'a> Utf16<'a> {
    fn new(source: &'a str) -> Self {
        Utf16 {
            bytes: source.as_bytes(),
            byte: 0,
            units: 0,
        }
    }

    /// The UTF-16 offset of byte `to`, a char boundary at or after the last.
    fn at(&mut self, to: usize) -> u32 {
        if to < self.byte {
            // Not ascending: start over rather than fail.
            self.byte = 0;
            self.units = 0;
        }
        let to = to.min(self.bytes.len());
        for &b in &self.bytes[self.byte..to] {
            // Each char's lead byte is one unit; a 4-byte char's (from
            // 0xF0) is a surrogate pair.
            if b & 0xC0 != 0x80 {
                self.units = self.units.saturating_add(1 + u32::from(b >= 0xF0));
            }
        }
        self.byte = to;
        self.units
    }
}

#[cfg(test)]
mod tests {
    use super::SpanKind::*;
    use super::*;

    /// Each span of `markdown` as its kind and its text, sliced from the
    /// UTF-16 source by its offsets, after checking the invariants.
    fn spans(markdown: &str) -> Vec<(SpanKind, String)> {
        let found = markdown_spans(markdown);
        check(markdown, &found);
        let units: Vec<u16> = markdown.encode_utf16().collect();
        found
            .iter()
            .map(|s| {
                let text = &units[s.start as usize..s.end as usize];
                (s.kind, String::from_utf16(text).unwrap())
            })
            .collect()
    }

    fn expect(spans: &[(SpanKind, &str)]) -> Vec<(SpanKind, String)> {
        spans.iter().map(|&(k, s)| (k, s.to_string())).collect()
    }

    /// The documented invariants: non-empty, in bounds, whole chars, sorted
    /// by start, never overlapping, and none dropped by the final guard.
    fn check(markdown: &str, spans: &[SourceSpan]) {
        let units: Vec<u16> = markdown.encode_utf16().collect();
        let low = |u: u16| (0xDC00..0xE000).contains(&u);
        for s in spans {
            assert!(s.start < s.end, "{s:?} in {markdown:?}");
            assert!(s.end as usize <= units.len(), "{s:?} in {markdown:?}");
            // Neither end is inside a surrogate pair.
            assert!(!low(units[s.start as usize]), "{s:?} in {markdown:?}");
            if let Some(&u) = units.get(s.end as usize) {
                assert!(!low(u), "{s:?} in {markdown:?}");
            }
        }
        for pair in spans.windows(2) {
            assert!(pair[0].end <= pair[1].start, "{pair:?} in {markdown:?}");
        }
        assert_eq!(byte_spans(markdown).len(), spans.len(), "{markdown:?}");
    }

    #[test]
    fn headings() {
        assert_eq!(
            spans("## Title #tag"),
            expect(&[(HeadingMarker, "##"), (Tag, "#tag")])
        );
        assert_eq!(
            spans("# One #\n\n###### Six\n\nSetext\n===\n\nTwo\nlines\n---\n\n#no-heading"),
            expect(&[
                (HeadingMarker, "#"),
                (HeadingMarker, "#"),
                (HeadingMarker, "######"),
                (HeadingMarker, "==="),
                (HeadingMarker, "---"),
                (Tag, "#no-heading"),
            ])
        );
        assert_eq!(
            spans("> Quoted\n> ===\n"),
            expect(&[
                (QuoteMarker, ">"),
                (QuoteMarker, ">"),
                (HeadingMarker, "==="),
            ])
        );
    }

    #[test]
    fn emphasis_strong_and_strike_markers() {
        assert_eq!(
            spans("**a**"),
            expect(&[(StrongMarker, "**"), (StrongMarker, "**")])
        );
        assert_eq!(
            spans("***a***"),
            expect(&[
                (EmphasisMarker, "*"),
                (StrongMarker, "**"),
                (StrongMarker, "**"),
                (EmphasisMarker, "*"),
            ])
        );
        assert_eq!(
            spans("*a* _b_ __c__ ~~d~~ ~e~ **f *g* h**"),
            expect(&[
                (EmphasisMarker, "*"),
                (EmphasisMarker, "*"),
                (EmphasisMarker, "_"),
                (EmphasisMarker, "_"),
                (StrongMarker, "__"),
                (StrongMarker, "__"),
                (StrikeMarker, "~~"),
                (StrikeMarker, "~~"),
                (StrikeMarker, "~"),
                (StrikeMarker, "~"),
                (StrongMarker, "**"),
                (EmphasisMarker, "*"),
                (EmphasisMarker, "*"),
                (StrongMarker, "**"),
            ])
        );
        // Unmatched delimiters are text.
        assert_eq!(spans("**a *b ~~c"), expect(&[]));
    }

    #[test]
    fn rules_and_emphasis_with_stars() {
        assert_eq!(
            spans("***\n\n* * *\n\n---\n\n___\n\n***a***\n"),
            expect(&[
                (Rule, "***"),
                (Rule, "* * *"),
                (Rule, "---"),
                (Rule, "___"),
                (EmphasisMarker, "*"),
                (StrongMarker, "**"),
                (StrongMarker, "**"),
                (EmphasisMarker, "*"),
            ])
        );
    }

    #[test]
    fn inline_code() {
        assert_eq!(
            spans("`a` ``d`e`` `` ` `` `#no`"),
            expect(&[
                (CodeMarker, "`"),
                (Code, "a"),
                (CodeMarker, "`"),
                (CodeMarker, "``"),
                (Code, "d`e"),
                (CodeMarker, "``"),
                (CodeMarker, "``"),
                (Code, " ` "),
                (CodeMarker, "``"),
                (CodeMarker, "`"),
                (Code, "#no"),
                (CodeMarker, "`"),
            ])
        );
    }

    #[test]
    fn code_blocks() {
        assert_eq!(
            spans(
                "```rust\nlet x = 1; #no\n\nmore\n```\n\n    indented #no\n    two\n\n~~~\n~~~\n"
            ),
            expect(&[
                (CodeMarker, "```rust"),
                (Code, "let x = 1; #no"),
                (Code, "more"),
                (CodeMarker, "```"),
                (Code, "indented #no"),
                (Code, "two"),
                (CodeMarker, "~~~"),
                (CodeMarker, "~~~"),
            ])
        );
        // An info string is part of the fence line, spaces apart.
        assert_eq!(
            spans("``` js  title\nx\n```"),
            expect(&[
                (CodeMarker, "```"),
                (CodeMarker, "js"),
                (CodeMarker, "title"),
                (Code, "x"),
                (CodeMarker, "```"),
            ])
        );
    }

    #[test]
    fn links() {
        assert_eq!(
            spans("[t](https://x \"T\")"),
            expect(&[
                (LinkBracket, "["),
                (LinkBracket, "]("),
                (LinkUrl, "https://x"),
                (LinkBracket, "\"T\")"),
            ])
        );
        assert_eq!(
            spans("[a](<b c> 'two words') ![i](p.png) <https://jw.org> <me@x.org>"),
            expect(&[
                (LinkBracket, "["),
                (LinkBracket, "](<"),
                (LinkUrl, "b c"),
                (LinkBracket, ">"),
                (LinkBracket, "'two"),
                (LinkBracket, "words')"),
                (LinkBracket, "!["),
                (LinkBracket, "]("),
                (LinkUrl, "p.png"),
                (LinkBracket, ")"),
                (LinkBracket, "<"),
                (LinkBracket, ">"),
                (LinkBracket, "<"),
                (LinkBracket, ">"),
            ])
        );
        // The URL is only looked for after the link text and its `](`.
        assert_eq!(
            spans("[x](x) [](u) [x]() [a](\\()"),
            expect(&[
                (LinkBracket, "["),
                (LinkBracket, "]("),
                (LinkUrl, "x"),
                (LinkBracket, ")"),
                (LinkBracket, "[]("),
                (LinkUrl, "u"),
                (LinkBracket, ")"),
                (LinkBracket, "["),
                (LinkBracket, "]()"),
                (LinkBracket, "["),
                (LinkBracket, "](\\"),
                (LinkUrl, "("),
                (LinkBracket, ")"),
            ])
        );
        // Styled link text keeps its own markers.
        assert_eq!(
            spans("[**b** `c`](berean://bible/nwtsty:0:0/43/1/9)"),
            expect(&[
                (LinkBracket, "["),
                (StrongMarker, "**"),
                (StrongMarker, "**"),
                (CodeMarker, "`"),
                (Code, "c"),
                (CodeMarker, "`"),
                (LinkBracket, "]("),
                (LinkUrl, "berean://bible/nwtsty:0:0/43/1/9"),
                (LinkBracket, ")"),
            ])
        );
    }

    #[test]
    fn reference_links_and_unstyled_definitions() {
        // A reference link's URL is in its definition, which renders nothing
        // and stays unstyled, so there is no LinkUrl. The parser leaves a
        // collapsed reference's `[]` out of the link, so it is unstyled too.
        assert_eq!(
            spans("[Insight][it] [it] [x][]\n\n[it]: https://x.org \"T\"\n[x]: /x\n\n> [q]: <u>\n"),
            expect(&[
                (LinkBracket, "["),
                (LinkBracket, "][it]"),
                (LinkBracket, "["),
                (LinkBracket, "]"),
                (LinkBracket, "["),
                (LinkBracket, "]"),
                (QuoteMarker, ">"),
            ])
        );
    }

    #[test]
    fn quote_markers_on_every_line() {
        assert_eq!(
            spans("> a\n> b #c\nlazy\n"),
            expect(&[(QuoteMarker, ">"), (QuoteMarker, ">"), (Tag, "#c")])
        );
        assert_eq!(
            spans("> > a\n> > b\n>\n> c\n"),
            expect(&[
                (QuoteMarker, ">"),
                (QuoteMarker, ">"),
                (QuoteMarker, ">"),
                (QuoteMarker, ">"),
                (QuoteMarker, ">"),
                (QuoteMarker, ">"),
            ])
        );
        // `>` that isn't a line's quote prefix is text, or an autolink's.
        assert_eq!(
            spans("> a > b <https://x>\n"),
            expect(&[(QuoteMarker, ">"), (LinkBracket, "<"), (LinkBracket, ">"),])
        );
    }

    #[test]
    fn quote_with_a_list_and_a_code_block() {
        assert_eq!(
            spans(
                "> - a\n>   *b\n>   c*\n> - [ ] d\n>\n> ```\n> code #no\n> > not a quote\n> ```\n"
            ),
            expect(&[
                (QuoteMarker, ">"),
                (ListMarker, "-"),
                (QuoteMarker, ">"),
                (EmphasisMarker, "*"),
                (QuoteMarker, ">"),
                (EmphasisMarker, "*"),
                (QuoteMarker, ">"),
                (ListMarker, "-"),
                (TaskMarker, "[ ]"),
                (QuoteMarker, ">"),
                (QuoteMarker, ">"),
                (CodeMarker, "```"),
                (QuoteMarker, ">"),
                (Code, "code #no"),
                (QuoteMarker, ">"),
                (Code, "> not a quote"),
                (QuoteMarker, ">"),
                (CodeMarker, "```"),
            ])
        );
        // A list item holding a quote.
        assert_eq!(
            spans("- > a\n  > b\n"),
            expect(&[(ListMarker, "-"), (QuoteMarker, ">"), (QuoteMarker, ">"),])
        );
    }

    #[test]
    fn list_and_task_markers() {
        assert_eq!(
            spans("- [x] done\n- [ ] todo\n* a\n\n+ b\n\n1) x\n2) y\n\n10. z\n"),
            expect(&[
                (ListMarker, "-"),
                (TaskMarker, "[x]"),
                (ListMarker, "-"),
                (TaskMarker, "[ ]"),
                (ListMarker, "*"),
                (ListMarker, "+"),
                (ListMarker, "1)"),
                (ListMarker, "2)"),
                (ListMarker, "10."),
            ])
        );
        // Nested, loose, empty, and with an escape right after the marker.
        assert_eq!(
            spans("- a\n\n  1. b\n\n     c\n-\n- \\*d\n"),
            expect(&[
                (ListMarker, "-"),
                (ListMarker, "1."),
                (ListMarker, "-"),
                (ListMarker, "-"),
            ])
        );
    }

    #[test]
    fn tags_are_not_in_code_or_link_text() {
        assert_eq!(
            spans("#a `#b` [#c](u) [#d][r] <https://x/#e> #f\n\n[r]: /r\n"),
            expect(&[
                (Tag, "#a"),
                (CodeMarker, "`"),
                (Code, "#b"),
                (CodeMarker, "`"),
                (LinkBracket, "["),
                (LinkBracket, "]("),
                (LinkUrl, "u"),
                (LinkBracket, ")"),
                (LinkBracket, "["),
                (LinkBracket, "][r]"),
                (LinkBracket, "<"),
                (LinkBracket, ">"),
                (Tag, "#f"),
            ])
        );
    }

    #[test]
    fn escapes_entities_breaks_and_html_are_unstyled() {
        assert_eq!(
            spans("\\*not\\* \\#tag \\\\ &amp; &#35;x a\\\nb  \nc"),
            expect(&[])
        );
        assert_eq!(
            spans("# \\# a\n\n**\\*b**"),
            expect(&[
                (HeadingMarker, "#"),
                (StrongMarker, "**"),
                (StrongMarker, "**"),
            ])
        );
        assert_eq!(spans("a <b>bold</b> <!-- c -->"), expect(&[]));
        assert_eq!(spans("<div>\n#no\n</div>\n"), expect(&[]));
        assert_eq!(
            spans("> <div>\n> x\n> </div>\n"),
            expect(&[(QuoteMarker, ">"), (QuoteMarker, ">"), (QuoteMarker, ">"),])
        );
    }

    #[test]
    fn empty_and_blank_input_have_no_spans() {
        for blank in ["", " ", "\n", "\n\n  \t\n", "\r\n", "\u{a0}\u{3000}"] {
            assert_eq!(markdown_spans(blank), [], "{blank:?}");
        }
    }

    #[test]
    fn offsets_are_utf16_code_units() {
        let markdown = "😀 **👨‍👩‍👧** #日本 שָׁלוֹם [λόγος](https://x/é) café #été\n\n\
                        > ἀγάπη #ἀγάπη `😀`";
        assert_eq!(
            spans(markdown),
            expect(&[
                (StrongMarker, "**"),
                (StrongMarker, "**"),
                (Tag, "#日本"),
                (LinkBracket, "["),
                (LinkBracket, "]("),
                (LinkUrl, "https://x/é"),
                (LinkBracket, ")"),
                (Tag, "#été"),
                (QuoteMarker, ">"),
                (Tag, "#ἀγάπη"),
                (CodeMarker, "`"),
                (Code, "😀"),
                (CodeMarker, "`"),
            ])
        );
        // "😀" is a surrogate pair, so the bold starts at unit 3; the family
        // is three pairs and two joiners, so the closing `**` is at 3+2+8.
        let found = markdown_spans(markdown);
        assert_eq!((found[0].start, found[0].end), (3, 5));
        assert_eq!((found[1].start, found[1].end), (13, 15));
        let units = markdown.encode_utf16().count() as u32;
        assert_eq!(found.last().unwrap().end, units);
    }

    #[test]
    fn tag_spans_are_the_tags_tag_sync_uses() {
        for markdown in samples() {
            let units = |byte: usize| markdown[..byte].encode_utf16().count() as u32;
            let synced: Vec<(u32, u32)> = parse(&markdown, &|_| true)
                .tags
                .into_iter()
                .map(|r| (units(r.start), units(r.end)))
                .collect();
            let tags: Vec<(u32, u32)> = markdown_spans(&markdown)
                .into_iter()
                .filter(|s| s.kind == Tag)
                .map(|s| (s.start, s.end))
                .collect();
            assert_eq!(tags, synced, "{markdown:?}");
        }
    }

    /// Inputs for the invariant checks: every construct, odd input and a
    /// long note.
    fn samples() -> Vec<String> {
        let mut out: Vec<String> = [
            "# H #x\n\nSetext #y\n---\n",
            "**a** *b* _c_ ~~d~~ ***e*** **_f_** `g` ``h`i``",
            "[a](https://x) <https://y> <me@x.org> [r][ref] [ref] ![i #j](p.png)\n\n[ref]: /url",
            "[**b** *#no*](u) [`c`](v) [![i](a.png)](w) [a](\\() [a](<>) [a](u \"t\\\"\")",
            "- [ ] a\n- [x] b #t\n  * c\n\n    1. d\n    2) e\n",
            "> > a\n> b\n>\n> - c\n>   continued\nlazy #t",
            "> ```\n> a\n>\n> ```\n>\n>     indented\n> # h\n> ***\n",
            "```\n#a\n```\n\n    #b\n\n~~~ info string\nx\n~~~",
            "\\# \\* \\\\ &amp; &#35;x #a&amp;b #c\\_d",
            "a  \nb\\\nc\r\nd\r\n\r\n- e\r\n> f\r\n> g\r\n",
            "<b>#x</b> <!-- c --> <div>\n#y\n</div>",
            "| a | b |\n|---|---|\n| 1 | 2 |\n\n[^1]\n\n[^1]: note\n\n$x$",
            "- [ ]\n1.\n[a](\n![\n<\n***\n___\n#\n>\n-",
            "\u{0}#\u{0} #\u{301}x é#x 😀#a #😀 👨‍👩‍👧 #日本 שָׁלוֹם #ἀγάπη",
            "\t- a\n\t\t- b\n\t>\tq",
            "> `a\n> b` *c\n> d*",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        out.push(note_10k());
        out
    }

    #[test]
    fn invariants_hold_for_all_samples() {
        for markdown in samples() {
            spans(&markdown);
        }
    }

    #[test]
    fn deep_nesting_does_not_overflow_the_stack() {
        for deep in [
            ">".repeat(10_000) + " a #t",
            "*".repeat(10_000) + "a" + &"*".repeat(10_000),
            "*".repeat(10_000),
            "- ".repeat(5_000) + "[ ] a",
            (0..5_000).map(|n| " ".repeat(2 * n) + "- a\n").collect(),
            "> - ".repeat(5_000) + "a",
            "[".repeat(10_000) + "a" + &"](u)".repeat(10_000),
            "~~".repeat(5_000) + "a" + &"~~".repeat(5_000),
        ] {
            let found = markdown_spans(&deep);
            check(&deep, &found);
        }
        let quotes = markdown_spans(&(">".repeat(10_000) + " a"));
        assert_eq!(
            quotes.iter().filter(|s| s.kind == QuoteMarker).count(),
            10_000
        );
        let items = markdown_spans(&("- ".repeat(5_000) + "a"));
        assert_eq!(items.iter().filter(|s| s.kind == ListMarker).count(), 5_000);
    }

    /// A realistic note of about 10,000 characters.
    fn note_10k() -> String {
        let section = |n: usize| {
            format!(
                "## Section {n}: light 😀\n\
                 \n\
                 The first thing God says is **not** a law; it is *light*. \
                 [John 1:9](berean://bible/nwtsty:0:0/43/1/9) calls the Word \
                 ***the true light***, and ~~darkness~~ gives way. #light #study-{n}\n\
                 \n\
                 - [x] Compare [Genesis 1:3](berean://bible/nwtsty:0:0/1/1/3)\n\
                 - [ ] Read `John 1:14` again #todo\n\
                 \x20 1. Note the Greek λόγος and Hebrew אוֹר\n\
                 \x20 2) Check [Insight](berean://pub/it:0:0/1200002712) \\#not-a-tag\n\
                 \n\
                 > The light shines in the darkness. #quote\n\
                 > — 日本語の注 [web](https://jw.org \"jw\")\n\
                 \n\
                 ```\n\
                 code #no {n}\n\
                 ```\n\
                 \n\
                 ---\n\
                 \n"
            )
        };
        let mut note = String::from("# Light before law\n\n");
        let mut n = 0;
        while note.chars().count() < 10_000 {
            note.push_str(&section(n));
            n += 1;
        }
        note
    }

    #[test]
    #[ignore = "timing; run with --release --ignored --nocapture"]
    fn markdown_spans_10k_timing() {
        let note = note_10k();
        let runs = 2_000;
        let mut times: Vec<std::time::Duration> = (0..runs)
            .map(|_| {
                let start = std::time::Instant::now();
                let spans = markdown_spans(std::hint::black_box(&note));
                let elapsed = start.elapsed();
                std::hint::black_box(spans);
                elapsed
            })
            .collect();
        times.sort();
        println!(
            "markdown_spans on {} chars ({} spans): median {:?}, max {:?} over {runs} calls",
            note.chars().count(),
            markdown_spans(&note).len(),
            times[runs / 2],
            times[runs - 1],
        );
    }
}
