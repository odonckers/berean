# Document blocks for publication articles (core FFI shapes)

Status: Proposed (Oct 30, 2026); Wren decides in this PR. Row: Core: Document.blocks.

Asked by: Otter, Expo 4 reader (#45, ask 5)

This doc covers the core side only: the block tree for a publication document, the inline runs, link
targets, images and paragraph anchoring. It follows the notes tree ([markdown-notes.md](markdown-notes.md))
and the Bible chapter blocks (#47).

## 1. Goal and non-goals

Goal: `Reader::document` also returns the article laid out as plain text in reading order, so both apps
can draw publication articles natively instead of rendering HTML. `html` and `paragraphs` stay on
`Document` unchanged.

Non-goals:
- No HTML rendering, and no HTML or CSS in the tree.
- No highlight drawing. Blocks carry paragraph ids so highlights and notes can anchor per paragraph, but
  mapping JW word tokens to text is a later row (§5).
- The Research Guide (`rsg`) is not in v1. It is served by `Reader::study_references` (#49). An `rsg`
  document still produces best-effort blocks (§4).
- No new dependency.

## 2. What the fixtures contain

I decrypted every content document of five fixtures with the core's own `document_html` /
`document_paragraphs` and counted elements. `du-*` and `dc-*` utility classes are presentational and ignored.

| Key | Title | Type | Content docs |
|---|---|---|---|
| w | `w_E_202608` The Watchtower (Study) Aug 2026 | 3 | 9: cover (c39), TOC (c68), 4 study articles (c40), life story (c20), c59, c79 |
| ll | `ll_E` Listen to God and Live Forever | 1 | 18 |
| te | `te_E` Listening to the Great Teacher | 1 | 50 |
| it | `it_E` Insight on the Scriptures | 25 | 4782 (4716 class 2 entries, plus maps and charts) |
| rsg | `rsg_E` Research Guide | 9 | 1237 |

Findings that shape the design:
- **Every `data-pid` in the HTML has a positioned `DocumentParagraph` row.** Some rows have no position and
  are not in the HTML (w 35/400, ll 31/235, te 0/1155, it 2897/54212, rsg 3056/177697). They produce no block.
- **Pid elements don't nest**, except `div.boxTtl` (with a pid) wrapping an `h2` (without one): 4 in w, 7 in it.
- **HTML order is not pid order** in 6/9 w docs, 4/18 ll and 127/4782 it. A study question comes before its
  paragraph in the HTML but has the higher pid (question 40 precedes paragraph 7). Blocks follow the HTML.
- **No text outside a pid element** in w, ll, te or it. In rsg only the `details > summary` section titles
  (3138) and 100 `span > a.b > strong` lie outside, so a heading's paragraph is optional.
- **Questions are linked from the paragraph side.** A paragraph carries `data-rel-pid="[40]"` naming its
  question (69 in w). Never a list in the fixtures, but one question can cover several paragraphs:
  "**6-7.** …" with two paragraphs pointing at it.
- **Paragraph numbers** sit in `span.parNum` with `data-pnum` (69 in w). The first paragraph's is empty (drop
  cap); later ones hold `<strong><sup>2</sup></strong>`. All 66 `sup` in w are inside `parNum`.

### Element mapping

Counts are occurrences; "-" = none. Block elements first, then inline.

| Element | w | ll | te | it | rsg | Maps to |
|---|---|---|---|---|---|---|
| `header` | 9 | - | - | 4782 | - | flattened wrapper |
| `div.bodyTxt`, `div.openingContent` | 8, 1 | - | - | - | - | flattened wrapper |
| `div.section` > `div.pGroup` | - | 31 > 31 | - | - | - | flattened wrapper |
| `div.blockTxt` | - | - | - | 3 | - | flattened wrapper |
| `div.fcc` | - | - | 1 | - | - | flattened wrapper |
| `div.groupTOC` | 1 | - | - | - | - | flattened wrapper; its `p` get role `TocEntry` |
| `div.copyrightInfo` | 1 | - | - | - | - | flattened wrapper; its `p` get role `Body` |
| image position divs (`north_center`, `south_center`, `east_right half`, `west_left half`, `zoom`) | yes | yes | - | yes | - | flattened wrapper |
| `h1` (incl. `coverTtl`, `featureTtl`, `contextTtl`) | 6 + 2 + 1 | 16 + 1 + 1 | - | 4782 | 1236 | `Heading { level: 1 }` |
| `h2` | 25 (4 in `boxTtl`) | 29 | - | 838 | 2 | `Heading { level: 2 }`; inside `boxTtl`: `Aside.title` |
| `h3` | 4 (TOC) | - | - | 5 | - | `Heading { level: 3 }` |
| `div.boxTtl` (pid) | 4 | - | - | 7 | - | `Aside.title` (its pid) |
| `p` (no class) | 145 | - | - | 1769 | - | `Paragraph`, `Body` |
| `p.qu` | 66 | - | - | - | - | `Question` |
| `div.gen-field` (label + textarea, pid) | 78 | - | - | - | - | `AnswerField` |
| `p.contextTtl` | 4 | 15 | - | - | - | `Paragraph`, `ContextTitle` |
| `p.featureTtl` | 2 | - | - | 51 | - | `Paragraph`, `ContextTitle` |
| `p.themeScrp` | 4 | - | - | - | - | `Paragraph`, `ThemeScripture` |
| `p.pubRefs` | 16 | - | - | - | - | `Paragraph`, `PublicationReference` |
| `p.byline` | 1 | - | - | - | - | `Paragraph`, `Byline` |
| `p.st` | 1 (copyright) | - | 97 | 4 | - | `Paragraph`, `Title` (in `copyrightInfo`: `Body`) |
| `p.sd` | - | - | 46 | - | - | `Paragraph`, `Summary` |
| `p.se`, `p.sm`, `p.sn` | 4, -, 5 | -, 14, 1 | -, 46, 4 | 1053, 784, 3215 | 2415, -, - | `Paragraph`, `TocEntry` inside `groupTOC`, else `Body` |
| `p.sb` | 1 | 92 | 958 | 25405 | 74 | `Paragraph`, `Body` |
| `p.sc` | - | 29 | - | 3379 | - | `Paragraph`, `Body` (in a figcaption it sits in `Figure.caption`) |
| `p.si`, `p.sj`, `p.sf` | - | 6, -, - | 1, 1, 1 | 38, -, - | - | `Paragraph`, `Body` |
| `p.sk` (chart lines), `p.sp`, `p.sz` (quoted lines) | - | - | - | 8220, 1388, 16 | - | `Paragraph`, `Body` |
| `p.s5`, `p.s6`, `p.su`, `p.so`, `p.sx`, `p.ss`, `p.big` | - | - | - | 124, 48, 92, 54, 44, 5, 1 | 37256, 29658, 103991, -, -, -, - | `Paragraph`, `Body` |
| `figure` > `img` | 19 | 55 | - | 468 | - | `Figure.image` |
| `figcaption` > `p` | 17 | - | - | 442 | - | `Figure.caption` (paragraphs) |
| `div.blockTeach` > `aside` > `div.boxContent` | 4 | 15 | - | - | - | `Aside` |
| `div.boxSupplement` > `aside` | - | - | - | yes (in the 32 asides) | - | `Aside` |
| `div.chart` > `aside` > `div.tableDiv` | - | - | - | yes (in the 32 asides) | - | flattened wrapper around `Table` |
| `ul` > `li` | 4 > 12 | yes > 29 | - | - | - | `List { ordered: false }` |
| `ol.source` > `li` | - | - | - | 1 > 5 | - | `List { ordered: true }` |
| `table`, `thead`, `tr`, `th`, `td` (`colspan` 27, `rowspan` 0) | - | - | - | 35, 27, 368, 40, 860 | - | `Table`; `thead` flattened, `th` = `header: true` |
| `blockquote` | - | - | - | 1 | - | flattened wrapper (one case; its paragraphs keep their roles) |
| `div.groupFootnote` > `div.fn-ref` > `p` | 4 > 5 | - | - | - | - | `Footnotes` |
| `hr` | 10 | - | - | 2 | - | `Rule` |
| `details` > `summary` | - | - | - | - | 3055 | `Heading`, `paragraph: None` (best effort, not v1) |
| **Inline** | | | | | | |
| `strong` | 276 | 100 | 105 | 24602 | 20464 | `Strong` (a question's leading number: consumed into `number`) |
| `em` | 47 | 2 | - | 12334 | 74816 | `Emphasis` |
| `a.b`, `a.xt`, `a.it`, `a` | 231, 12, 7, 3 | 84, -, 14, - | 320, -, 46, - | 82635, 1, 3, 18171 | 15004, 73000, 3431, 1810 | `Link` (class ignored; target from `href`) |
| `span.parNum` (`data-pnum`) | 69 | - | - | - | - | consumed into `Paragraph.number` |
| `sup` | 66 (all in `parNum`) | - | - | 65 | - | `Superscript` (it); w's are consumed with `parNum` |
| `sub` | - | - | - | 1 | - | `Subscript` |
| `span.altsize` | - | - | - | 406 | - | `SmallCaps` |
| `span.pageNum` (`data-no`, empty) | 34 | 34 | 191 | 7040 | - | `PageMarker` |
| `span.fn` (`data-fnid`) | 5 | - | 1 | - | - | `FootnoteRef` |
| `a.fn-symbol` (`#footnotesourceN`) | 5 | - | - | - | - | consumed into `DocFootnote.marker` |
| `label` + `textarea` | 78 | - | - | - | - | dropped (UI chrome; the field is `AnswerField`) |
| `span.txtSrcBullet` | - | - | - | 5 | - | flattened (its text kept) |
| `br` | - | - | - | - | - | none seen; would be `Text { "\n" }` |
| `data-video` on a link | 1 | - | - | - | - | dropped in v1; the link stays `External` (§7) |

## 3. Proposed types

In `reader.rs`, sync, built inside `Reader::document`.

### Field vs separate call

- **Field `Document.blocks`** (recommended). Otter asked for the field. A reader opens one article at a time,
  and blocks are built from the HTML already decrypted for `html`. It roughly doubles the payload; an it
  entry's HTML is small, so that is cheap. A long it chart document costs more, but still once per open.
- **`Reader::document_blocks(pub_key, doc_id)`**: callers that want only `html` don't pay for blocks, but
  the publication is opened and the document decrypted twice, and the two results can drift if the
  publication is updated between calls.

### Rust

```rust
pub struct Document {
    pub doc_id: i64,
    pub title: String,
    pub html: String,
    pub paragraphs: Vec<ParagraphAnchor>,
    /// The document laid out as plain text, in HTML (reading) order, not pid order.
    pub blocks: Vec<DocBlock>,
}

pub enum DocBlock {
    /// h1..h3. `paragraph` is None only for a heading outside any pid (rsg's section titles).
    Heading { level: u8, paragraph: Option<u32>, inlines: Vec<DocInline> },
    /// `number` is the `data-pnum` of its `span.parNum` ("2"), None without one.
    Paragraph { paragraph: u32, number: Option<String>, role: ParagraphRole, inlines: Vec<DocInline> },
    /// A study question (`p.qu`). `number` is its leading bold label without the dot ("6-7").
    /// `for_paragraphs`: the pids whose `data-rel-pid` names it, in reading order.
    Question { paragraph: u32, number: String, for_paragraphs: Vec<u32>, inlines: Vec<DocInline> },
    /// An answer box (`div.gen-field`). `tag` is its textarea's `name` ("textarea-4").
    AnswerField { paragraph: u32, tag: String },
    /// `caption` holds Paragraph blocks; empty without a figcaption (all of ll's).
    Figure { image: DocImage, caption: Vec<DocBlock> },
    /// A box: `blockTeach` or `boxSupplement` around an `aside`.
    Aside { title: Option<DocTitle>, blocks: Vec<DocBlock> },
    List { ordered: bool, items: Vec<DocListItem> },
    Table { rows: Vec<DocTableRow> },
    Footnotes { items: Vec<DocFootnote> },
    Rule,
}

pub struct DocTitle { pub paragraph: u32, pub inlines: Vec<DocInline> }   // div.boxTtl
pub struct DocImage {
    pub file: String,       // jwpub-media name: "2026520_univ_cnt_1.jpg"
    pub path: String,       // absolute path in the install directory, at read time
    pub alt: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
}
pub struct DocListItem { pub blocks: Vec<DocBlock> }
pub struct DocTableRow { pub cells: Vec<DocTableCell> }
pub struct DocTableCell { pub header: bool, pub colspan: u32, pub blocks: Vec<DocBlock> }  // colspan >= 1
pub struct DocFootnote {
    pub id: u32,                  // data-fnid, matches FootnoteRef.id
    pub marker: String,           // "a"
    pub paragraph: Option<u32>,
    pub inlines: Vec<DocInline>,
}

pub enum ParagraphRole {
    Body, Title, Summary, ContextTitle, ThemeScripture, PublicationReference, Byline, TocEntry,
}

pub enum DocInline {
    Text { text: String },
    Emphasis { children: Vec<DocInline> },
    Strong { children: Vec<DocInline> },
    Superscript { children: Vec<DocInline> },
    Subscript { children: Vec<DocInline> },
    SmallCaps { children: Vec<DocInline> },
    /// `url` is the href as written; pass it to `Reader::resolve` on tap.
    Link { children: Vec<DocInline>, url: String, target: DocLinkTarget },
    FootnoteRef { id: u32, marker: String },
    /// Zero width: page `page` of the printed edition starts here. Renderers may ignore it.
    PageMarker { page: String },
}

pub enum DocLinkTarget {
    /// jwpub://b/NWTR/B:C:V-B:C:V. Parsed only; no Bible is looked up.
    Bible { symbol: String, start: DocVerse, end: DocVerse },
    /// jwpub://p/E:DOC/[P[-P]] (and the token and `$` forms, see below). `language` is the JW code.
    Document { language: String, doc_id: i64, first: Option<u32>, last: Option<u32> },
    /// jwpub://c/E:DOC/C:V, a study-note ("commentary") link.
    StudyNote { language: String, doc_id: i64, chapter: u32, verse: u32 },
    External { url: String },     // http, https, mailto
    Invalid,                      // anything else; drawn as its text, not tappable
}
pub struct DocVerse { pub book: u32, pub chapter: u32, pub verse: u32 }
```

Changes from the shape proposed in the ask, and why:
- **`Box` → `Aside`.** `Box` shadows `std::boxed::Box` wherever `DocBlock::*` is imported, and `aside` is the
  element every box wraps.
- **`Aside.title` is `Option<DocTitle>`, not an optional block.** It is always one `boxTtl` with a pid and
  inline text. A record keeps the recursion through `Vec` only, the shape already checked for UniFFI 0.31.2
  (markdown-notes §4). An `Option<DocBlock>` would need `indirect` in Swift.
- **No `Caption` role.** A figcaption's paragraphs are already in `Figure.caption`; a role would say it twice.
  `p.sc` outside a figcaption (ll's boxes, much of it's 3379) is `Body`.
- **`DocLinkTarget::Document` has `first`/`last`, not `Option<(u32, u32)>`.** UniFFI has no tuples. Both are
  None for a whole-document link, or both set.
- **No `Footnote { id }` link target.** The only `#footnotesourceN` hrefs are the 5 `a.fn-symbol` back links,
  consumed into `DocFootnote.marker`. `FootnoteRef` is the forward link. Other `#` hrefs are `Invalid`.
- **`DocFootnote.paragraph` is optional.** te has one `span.fn` and no `groupFootnote`. If its text turns out
  to be only in the `Footnote` table (`Publication::footnotes` exists), the implementation appends a
  `Footnotes` block from that table, with no pid. Not verified yet.
- **`Bible.symbol` added.** `resolve` maps the link's symbol (`NWTR`) to a Bible; keeping it costs nothing.

### Roles

Closed enum; any class not listed is `Body`. Named `ParagraphRole` because `ParagraphStyle` is the Bible
chapter enum (#47).

| Role | Classes | Seen in |
|---|---|---|
| `Body` | `p`, `sb`, `sc`, `sk`, `sp`, `sz`, `si`, `sj`, `sf`, `s5`, `s6`, `su`, `so`, `sx`, `ss`, `big`, `se`/`sm`/`sn` outside the TOC, any `p` in `copyrightInfo`, unknown | all |
| `Title` | `st` | te (97 chapter titles: "Chapter 10", "One Leper Gave Glory to God"), it 4 |
| `Summary` | `sd` | te (46, one per chapter) |
| `ContextTitle` | `contextTtl`, `featureTtl` | w (week "OCTOBER 5-11, 2026"), ll, it |
| `ThemeScripture` | `themeScrp` | w |
| `PublicationReference` | `pubRefs` | w ("SONG 55 Fear Them Not!", FOCUS box lines) |
| `Byline` | `byline` | w |
| `TocEntry` | `se`, `sm`, `sn` inside `groupTOC` | w TOC |

te has no `h1`/`h2`; its headings stay `Paragraph` with role `Title`, not `Heading`. Turning them into
headings would guess a level, and the role already lets the renderer style them as titles.

### Generated shapes (illustrative)

Swift (UniFFI):

```swift
public enum DocBlock {
    case heading(level: UInt8, paragraph: UInt32?, inlines: [DocInline])
    case paragraph(paragraph: UInt32, number: String?, role: ParagraphRole, inlines: [DocInline])
    case question(paragraph: UInt32, number: String, forParagraphs: [UInt32], inlines: [DocInline])
    case answerField(paragraph: UInt32, tag: String)
    case figure(image: DocImage, caption: [DocBlock])
    case aside(title: DocTitle?, blocks: [DocBlock])
    case list(ordered: Bool, items: [DocListItem])
    case table(rows: [DocTableRow])
    case footnotes(items: [DocFootnote])
    case rule
}
public enum DocInline {
    case text(text: String)
    case emphasis(children: [DocInline]) // also strong, superscript, subscript, smallCaps
    case link(children: [DocInline], url: String, target: DocLinkTarget)
    case footnoteRef(id: UInt32, marker: String)
    case pageMarker(page: String)
}
```

TypeScript (ubrn, tagged unions; `i64` arrives as `bigint`, `u32`/`u8` as `number`):

```ts
type DocBlock =
  | { tag: DocBlock_Tags.Heading; inner: { level: number; paragraph: number | undefined; inlines: DocInline[] } }
  | { tag: DocBlock_Tags.Paragraph; inner: { paragraph: number; number: string | undefined; role: ParagraphRole; inlines: DocInline[] } }
  | { tag: DocBlock_Tags.Figure; inner: { image: DocImage; caption: DocBlock[] } }
  // ...
type DocLinkTarget =
  | { tag: DocLinkTarget_Tags.Document; inner: { language: string; docId: bigint; first: number | undefined; last: number | undefined } }
  // ...
```

### `DocInline` vs extending `Inline`

- **Extend notes `Inline`** with `Superscript`, `Subscript`, `SmallCaps`, `FootnoteRef`, `PageMarker`. Nothing
  breaks yet: no Swift or TS code switches on `Inline` today, only the core's FFI mirror. But note bodies are
  Markdown that round-trips through the editor and `markdown_spans`, and none of these can occur in a note.
  The notes renderer (Kiwi, Expo 6) would have to handle cases a note never contains. And doc links need a
  different target type anyway (below), so `Inline::Link` would not fit as is.
- **`DocInline`** (recommended): a second inline type, so each app has a second switch. Most cases have the
  same shape (`Text`, `Emphasis`, `Strong`, `Link` children), so a shared view can switch on both and differ
  only in links and the doc-only cases. It keeps the notes contract honest.
- What would flip it: Wren wants one renderer. Then add the cases to `Inline` before the notes read view
  ships, since that is the cheapest moment, and give `LinkTarget` the doc variants too.

### Link targets: parsed, not resolved

This departs from the earlier proposal, which mapped `jwpub://` links to `LinkTarget::Passage` /
`Publication` through the existing `resolve`. The fixtures show why that doesn't fit:

- **Cost.** it has up to thousands of links in one document (82,635 Bible links in 4338 docs, 18,171 plain
  links in 1810). `resolve` opens installed publications per link.
- **No pub_key.** A `jwpub://p/` link names only a language and a MEPS doc id. For a publication that isn't
  installed there is no `pub_key` to build `LinkTarget::Publication { location }` from.
- **Shapes `resolve` rejects.** Of 94,675 `jwpub://p/` hrefs, 14,882 have a `paragraph:token` part
  (`/360-360:4`, `/14:1-32:8`) and 4,789 are `$` lists (`E:1102021206/4-5$p/E:1102021206/22-30`): about 20%
  would come back `Invalid`. `jwpub://c/` study-note links (w 4, rsg 6) are rejected too.

So the block carries a cheap parsed target, and the app calls `Reader::resolve(url)` on tap or long-press
preview, which already returns a `LocationSpan`. The scanner parses all five `jwpub://p/` shapes: it keeps the
paragraph range, ignores tokens, and takes the first `$` part. Until `resolve` learns the token, `$` and `c/`
forms (a follow-up row, §7), tapping those gives `Invalid` and the app shows the link as not openable. All
98,374 Bible hrefs have the single `B:C:V-B:C:V` shape that `resolve` handles. The eager alternative is Q(h).

## 4. Parsing

- **Hand-written scanning in the core**, no tokenizer dependency, as Wren ruled for chapters (#47).
- **Block extents come from the anchors.** Positioned `ParagraphAnchor`s, sorted by `begin`, give the pid
  elements in reading order. A small tag scanner walks the gaps between them for containers (`figure`,
  `aside`, `ul`/`ol`/`li`, `table`/`tr`/`td`, `groupFootnote`, `hr`, headings without a pid) and builds the
  nesting. The one nested pid (`boxTtl` around an `h2`) is handled as the aside title.
- **Inline runs** come from a second scanner over each pid element's content: `strong`, `em`, `sup`, `sub`,
  `span.altsize`, `a`, `span.fn`, `span.pageNum`, `span.parNum`. Any other tag is transparent: its text is kept.
- **Text** is whitespace-collapsed (runs of ASCII whitespace become one space, trimmed at block edges;
  non-breaking spaces kept) and entities decoded. `label` and `textarea` text is dropped.
- **Question links**: a paragraph's `data-rel-pid="[N]"` is inverted into question N's `for_paragraphs`. The
  question number is the leading `<strong>N.</strong>` or `N-M.` of its text, removed from `inlines`.
- **Images**: `jwpub-media://<file>` gives `file`; `path` joins it to the publication's install directory.
  All 543 `img src` in the fixtures use this scheme, and every `img` is in a `figure`.

Error policy:
- An element shape the scanner doesn't know produces its text as `Paragraph` / `Text` with role `Body`. Words
  are never lost, and it is not `Corrupt`.
- A `data-pid` with no `DocumentParagraph` row is `Corrupt`, as the anchor code treats it today.
- A `data-rel-pid` naming no question in the document is ignored, and a `FootnoteRef` with no footnote stays
  in the text. Neither is `Corrupt`: the content still reads.

Test plan, against all five fixtures (rsg included, since it must not fail):
- Every positioned `DocumentParagraph` appears in exactly one block (or `DocTitle` / `DocFootnote`), and no
  unpositioned one appears.
- The concatenated block text equals the HTML's visible text, whitespace-collapsed, minus `label` and
  `textarea` text.
- Blocks are in `begin` order.
- Spot checks: w question "6-7" covers both its paragraphs; paragraph 2's `number` is "2" with no `sup` left
  in its inlines; it "L" + `SmallCaps("ORD")`; it's 27 colspans; w's 5 footnotes match their refs.
- A small synthetic HTML for the error cases.

## 5. Highlights and notes anchoring

- Blocks carry `paragraph` = `data-pid` = `DocumentParagraph.ParagraphIndex` = `ParagraphAnchor.paragraph` =
  JW's `BlockRange.Identifier` for `BlockType` 1. Highlights and notes anchor per paragraph exactly as they do
  today, through `Location.paragraph`.
- JW stores highlights as word tokens (`StartToken`, `EndToken`), not byte offsets; `userdata::TextRange`
  already carries `start_token` / `end_token`. Mapping tokens to positions in `inlines` needs JW's
  tokenization rule. That is a separate row (Core: document highlights / tokens), not this one.
- `AnswerField` maps to userData `InputField (LocationId, TextTag, Value)`. `TextTag` is presumably the
  textarea name (`textarea-4`); not verified against a JW backup with answers. Reading and writing typed
  answers is a later user-data row.

## 6. Open questions for Wren

**(a) `DocInline` vs extending `Inline`.** Recommend `DocInline` (§3); flip to `Inline` only if you want one
renderer, and then before the notes read view ships.

**(b) Image paths.** `file` plus an absolute `path` into the install directory, resolved at read time, vs
`file` plus a new `Reader::media_path(pub_key, file)`. The path stays valid until the publication is updated
or removed (the install directory changes), and the app re-reads the document after an update anyway.
Recommend the absolute path on the block, no new call. `alt` is kept for accessibility.

**(c) Parser.** Recommend hand-written scanning, no tokenizer dependency, consistent with #47.

**(d) Answer textareas.** Drop them, or model them as `AnswerField` hooks. Recommend `AnswerField` with its
paragraph and tag; the UI may hide it. Typed-answer storage is a later user-data row.

**(e) Page-number spans.** Drop, or keep as `PageMarker`. Recommend zero-width `PageMarker`: lossless, and it
lets "p. 3" citations and page jumps work later; renderers ignore it.

**(f) Anchoring.** Recommend per-paragraph ids now; tokens in a later row.

**(g) Scope.** Recommend v1 = Watchtower and magazine document classes in the fixture (w: 39, 68, 40, 20,
59, 79), brochures and books (ll, te, it including tables). rsg (`details`/`summary`, already served by
`study_references`) and other classes later; unknown classes still produce best-effort `Paragraph`s.

**(h) Link targets.** Lazy (parsed, resolved on tap) vs eager `LinkTarget` (resolved in `document`, with
`missing`). Eager costs a lookup per link (thousands in an it document), has no `pub_key` for uninstalled
targets, and returns `Invalid` for about 20% of publication links until `resolve` is extended. Recommend lazy,
plus a follow-up row for `para:token`, `$` and `jwpub://c/` in `resolve`.

**(i) `ParagraphRole`.** Closed enum vs passing the MEPS class string. Recommend the closed enum with a
`Body` fallback: the apps never learn MEPS class codes, and a new role is an additive change.

**(j) Tables in v1.** Recommend yes: small (35 tables in 23 it docs, no rowspan), and without them it's charts
become loose paragraphs.

**(k) Field vs separate call.** Recommend the field `Document.blocks` (§3).

## 7. Not in this row

Follow-up rows to propose:
- Core: document highlights / tokens (JW's tokenization; token ranges in `inlines`).
- Core: `resolve` for `paragraph:token`, `$` lists and `jwpub://c/` links.
- Core: typed answers (`InputField`) for `AnswerField`.
- Core: rsg and `details` / `summary` blocks.
- Core: video links (`data-video="webpubvid://..."`).

## 8. Implementation PR plan (after Wren decides)

Small PRs, each with fixture tests:
1. Types and the scanner for w: headings, paragraphs and roles, questions, answer fields, figures, asides,
   lists, footnotes, rules, all inlines and `DocLinkTarget` parsing. Tests on w.
2. Books: ll, te and it, including tables, `SmallCaps`, `Superscript`/`Subscript` and te's footnote. The
   whole-fixture invariants of §4 on all five fixtures, rsg included.
3. FFI mirror in `berean-ffi`, Swift and TS bindings, and the `docs/parity.md` row.
