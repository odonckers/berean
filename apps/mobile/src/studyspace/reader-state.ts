// A reader card's text and its place in it (findings §6.6): the core's
// chapter or document blocks as rows of plain text, where a saved anchor
// (a verse or paragraph number plus a UTF-16 offset into its text, the
// core's VerseAnchor.text or ParagraphAnchor.text) lands in them, the
// anchor at a row offset when a scroll settles, the ~3 lines shown at L3,
// what a card reads (Reader.locate's answer for its saved place), and the
// location a ReaderState is saved at. Kept free of React Native (and of the
// FFI's runtime) for the tests.

import type { CoreBlock, Run, Segment } from '@/reader/chapter-blocks';

/** What a row draws, in order: a verse or paragraph number, or text (a verse's or paragraph's when keyed). */
export type Part = { text: string; number?: boolean; key?: number };
/** A keyed part's stretch of its row's text: `key` is the verse or paragraph number. */
export type Piece = { key: number; start: number; length: number };
/**
 * One block as drawn: a heading, or a paragraph (or line of poetry) of
 * verses. `textAt[i]` is where `pieces[i]` starts in its verse's or
 * paragraph's text as the core gives it (what a saved offset counts in).
 */
export type Row = { heading: boolean; parts: Part[]; pieces: Piece[]; length: number; textAt: number[] };

/** A place in the text the core's way: verse or paragraph `key`, `charOffset` UTF-16 units into its text. */
export type Position = { key: number; charOffset: number };
/** The same place as drawn: `offset` UTF-16 units into row `row`'s text. */
export type RowPosition = { row: number; offset: number };

function row(heading: boolean, parts: Part[]): Row {
  const pieces: Piece[] = [];
  let at = 0;
  for (const part of parts) {
    if (part.key !== undefined) pieces.push({ key: part.key, start: at, length: part.text.length });
    at += part.text.length;
  }
  return { heading, parts, pieces, length: at, textAt: [] };
}

/** The core's plain text of each verse or paragraph, by number. */
export type AnchorTexts = ReadonlyMap<number, string>;

/** The core's anchors (VerseAnchor, ParagraphAnchor) as texts by number. */
export function anchorTexts(anchors: readonly ({ verse: number; text: string } | { paragraph: number; text: string })[]): AnchorTexts {
  return new Map(anchors.map((a) => ['verse' in a ? a.verse : a.paragraph, a.text]));
}

/**
 * Where each piece starts in its block's text as the core gives it: each
 * piece of a verse or paragraph found in order in the core's text
 * (VerseAnchor.text joins a verse's runs with a space; ParagraphAnchor.text
 * is the paragraph's), so offsets count what the core counts. A block the
 * core gives no text for, or a piece it doesn't have, counts the drawn
 * pieces on from the last one.
 */
function withTextOffsets(rows: Row[], texts: AnchorTexts | undefined): Row[] {
  const cursors = new Map<number, number>();
  for (const r of rows) {
    const flat = r.parts.map((p) => p.text).join('');
    r.textAt = r.pieces.map((piece) => {
      const cursor = cursors.get(piece.key) ?? 0;
      const core = texts?.get(piece.key);
      const drawn = flat.slice(piece.start, piece.start + piece.length);
      const lead = drawn.length - drawn.trimStart().length;
      const found = core === undefined ? -1 : core.indexOf(drawn.trim(), cursor);
      const at = found < 0 ? cursor : Math.max(0, found - lead);
      cursors.set(piece.key, at + piece.length);
      return at;
    });
  }
  return rows;
}

const NO_BREAK_SPACE = String.fromCharCode(0xa0);

/**
 * A Bible chapter's rows from the core's blocks: each verse run's text is
 * a piece keyed by its verse, after its number (if the run shows one) and a
 * space between runs, as the reader draws them. A note run (verse 0) is
 * drawn but never an anchor. `segments` is the reader's blockSegments
 * (passed in, so Node can run this without the app's path aliases).
 * Offsets into a verse count in its VerseAnchor.text, from `verses`.
 */
export function bibleRows(
  blocks: readonly CoreBlock[],
  segments: (runs: readonly Run[]) => Segment[],
  verses?: AnchorTexts,
): Row[] {
  const rows = blocks.map((block) => {
    if (block.tag === 'Heading') return row(true, [{ text: block.inner.text }]);
    const parts = segments(block.inner.runs).flatMap((s): Part[] => {
      if (s.kind === 'space') return [{ text: ' ' }];
      if (s.kind === 'note') return [{ text: s.text }];
      if (s.kind === 'text') return [{ text: s.text, key: s.verse }];
      const number: Part = { text: `${s.label}${NO_BREAK_SPACE}`, number: true };
      return s.separated ? [{ text: ' ' }, number] : [number];
    });
    return row(false, parts);
  });
  return withTextOffsets(rows, verses);
}

// The core's document blocks and inlines, structurally: the generated
// DocBlock and DocInline are assignable to these, as chapter-blocks.ts does
// for chapters, so Node can test the mapping without the native module.
export type CoreInline =
  | { tag: 'Text' | 'Code'; inner: Readonly<{ text: string }> }
  | { tag: 'Emphasis' | 'Strong' | 'Strikethrough' | 'Link'; inner: Readonly<{ children: readonly CoreInline[] }> }
  | { tag: 'Tag' | 'LineBreak' };
export type CoreDocInline =
  | { tag: 'Common'; inner: Readonly<{ inline: CoreInline }> }
  | { tag: 'Superscript' | 'Subscript' | 'SmallCaps' | 'Link'; inner: Readonly<{ children: readonly CoreDocInline[] }> }
  | { tag: 'FootnoteRef' | 'PageMarker' };
export type CoreDocBlock =
  | { tag: 'Heading'; inner: Readonly<{ paragraph?: number; inlines: readonly CoreDocInline[] }> }
  | {
      tag: 'Paragraph' | 'Question';
      inner: Readonly<{ paragraph: number; number?: string; inlines: readonly CoreDocInline[] }>;
    }
  | {
      tag: 'Aside';
      inner: Readonly<{
        title?: Readonly<{ paragraph: number; inlines: readonly CoreDocInline[] }>;
        blocks: readonly CoreDocBlock[];
      }>;
    }
  | { tag: 'List'; inner: Readonly<{ items: readonly Readonly<{ blocks: readonly CoreDocBlock[] }>[] }> }
  | { tag: 'Figure'; inner: Readonly<{ caption: readonly CoreDocBlock[] }> }
  | { tag: 'AnswerField' | 'Table' | 'Footnotes' | 'Rule' };

function inlineText(inline: CoreInline): string {
  switch (inline.tag) {
    case 'Text':
    case 'Code':
      return inline.inner.text;
    case 'LineBreak':
      return '\n';
    case 'Tag':
      return '';
    default:
      return inline.inner.children.map(inlineText).join('');
  }
}

/**
 * A block's plain text from its inlines, for what the core gives no text
 * of: a heading without a paragraph id (never an anchor). A paragraph's
 * text is the core's ParagraphAnchor.text. Footnote markers and page
 * markers aren't text.
 */
export function docText(inlines: readonly CoreDocInline[]): string {
  return inlines
    .map((inline) => {
      switch (inline.tag) {
        case 'Common':
          return inlineText(inline.inner.inline);
        case 'FootnoteRef':
        case 'PageMarker':
          return '';
        default:
          return docText(inline.inner.children);
      }
    })
    .join('');
}

/**
 * A document's rows from the core's blocks, in order: headings, paragraphs
 * and questions (with their printed number), and the paragraphs inside
 * asides, lists and figure captions. Tables, footnotes, rules and answer
 * fields aren't drawn on a card yet. A paragraph's text is the core's
 * ParagraphAnchor.text, from `paragraphs` (what a saved offset counts in);
 * one the core gives none for is its inlines' text.
 */
export function documentRows(blocks: readonly CoreDocBlock[], paragraphs?: AnchorTexts): Row[] {
  const textOf = (paragraph: number | undefined, inlines: readonly CoreDocInline[]) =>
    (paragraph === undefined ? undefined : paragraphs?.get(paragraph)) ?? docText(inlines);
  const rowsOf = (inside: readonly CoreDocBlock[]): Row[] =>
    inside.flatMap((block): Row[] => {
      switch (block.tag) {
        case 'Heading': {
          const { paragraph, inlines } = block.inner;
          return [row(true, [{ text: textOf(paragraph, inlines), key: paragraph }])];
        }
        case 'Paragraph':
        case 'Question': {
          const { paragraph, number, inlines } = block.inner;
          const text: Part = { text: textOf(paragraph, inlines), key: paragraph };
          return [row(false, number === undefined ? [text] : [{ text: `${number} `, number: true }, text])];
        }
        case 'Aside': {
          const { title, blocks: nested } = block.inner;
          const head =
            title === undefined ? [] : [row(true, [{ text: textOf(title.paragraph, title.inlines), key: title.paragraph }])];
          return [...head, ...rowsOf(nested)];
        }
        case 'List':
          return block.inner.items.flatMap((item) => rowsOf(item.blocks));
        case 'Figure':
          return rowsOf(block.inner.caption);
        default:
          return [];
      }
    });
  return withTextOffsets(rowsOf(blocks), paragraphs);
}

/** Every piece of `key`, in order, with its row and where it starts in the core's text. */
function piecesOf(rows: readonly Row[], key: number): { row: number; piece: Piece; at: number }[] {
  return rows.flatMap((r, index) =>
    r.pieces.flatMap((piece, i) => (piece.key === key ? [{ row: index, piece, at: r.textAt[i] ?? 0 }] : [])),
  );
}

/**
 * Where `wanted` lands in `rows` (§6.6): its block with the offset clamped
 * to the block's length (a block split over rows, as a verse over two
 * paragraphs, counts its pieces in order); if the block is gone, the start
 * of the nearest earlier one (by verse or paragraph number); else, or with
 * nothing wanted, the start of the first block. The top of the text if
 * there are no blocks.
 */
// The nearest earlier block is the core's own fallback too (Reader.locate);
// readerTarget already asks it for the saved place, so this only meets a
// block the card's rows don't draw.
export function restorePosition(rows: readonly Row[], wanted: Position | undefined): RowPosition {
  const keys = rows.flatMap((r) => r.pieces.map((p) => p.key));
  if (keys.length === 0) return { row: 0, offset: 0 };
  let key = keys[0];
  let offset = 0;
  if (wanted !== undefined) {
    if (keys.includes(wanted.key)) {
      key = wanted.key;
      offset = Math.max(0, wanted.charOffset);
    } else {
      const earlier = keys.filter((k) => k < wanted.key);
      if (earlier.length > 0) key = Math.max(...earlier);
    }
  }
  const pieces = piecesOf(rows, key);
  for (const [i, { row: r, piece, at }] of pieces.entries()) {
    // Past this piece's end goes on to the next (an offset in the space
    // the core's text has between two pieces, to the next one's start);
    // the last takes the clamp.
    if (offset < at + piece.length || i === pieces.length - 1) {
      return { row: r, offset: piece.start + Math.min(Math.max(0, offset - at), piece.length) };
    }
  }
  return { row: 0, offset: 0 };
}

/**
 * The anchor at `at` (the top visible line when a scroll settles): the
 * block whose piece holds the offset, and how far into that block's text
 * it is. A number before a piece belongs to it; in a heading without a
 * block, or past the row's last piece, the next block's start. Undefined
 * when there's no block at or after `at` nor before it.
 */
export function positionAt(rows: readonly Row[], at: RowPosition): Position | undefined {
  const here = rows[at.row];
  if (here !== undefined) {
    // The first piece not ended before the offset: a number (or space) before a piece is the piece's.
    const index = here.pieces.findIndex((p) => at.offset <= p.start + p.length);
    if (index >= 0) {
      const piece = here.pieces[index];
      return { key: piece.key, charOffset: (here.textAt[index] ?? 0) + Math.max(0, at.offset - piece.start) };
    }
  }
  // The next block's start, else the last block's end.
  for (let r = Math.max(0, at.row + 1); r < rows.length; r++) {
    const first = rows[r].pieces[0];
    if (first !== undefined) return positionAt(rows, { row: r, offset: first.start });
  }
  for (let r = Math.min(at.row, rows.length - 1); r >= 0; r--) {
    const last = rows[r].pieces.at(-1);
    if (last !== undefined) return positionAt(rows, { row: r, offset: last.start + last.length });
  }
  return undefined;
}

/**
 * The ~3 lines an L3 card shows (§5): from the start of the anchor's block
 * (with its number) to the end of the paragraph, then the paragraphs after
 * it, headings left out, joined by a space, until about `chars` characters.
 */
export function snippetParts(rows: readonly Row[], at: RowPosition, chars: number): Part[] {
  const out: Part[] = [];
  let length = 0;
  for (let r = at.row; r < rows.length && length < chars; r++) {
    const { heading, parts, pieces } = rows[r];
    if (heading) continue;
    let from = 0;
    if (r === at.row) {
      // The part holding the anchor's piece, and the number just before it.
      const piece = pieces.find((p) => at.offset <= p.start + p.length);
      let start = 0;
      for (const [i, part] of parts.entries()) {
        if (piece !== undefined && start === piece.start && part.key === piece.key) {
          from = i > 0 && parts[i - 1].number ? i - 1 : i;
          break;
        }
        start += part.text.length;
      }
    }
    if (out.length > 0) out.push({ text: ' ' });
    for (const part of parts.slice(from)) {
      out.push(part);
      length += part.text.length;
    }
  }
  return out;
}

/** A laid-out row: its top in the scroll content and its height. */
export type RowLayout = { y: number; height: number };

/**
 * The scroll offset that puts `at` at the top of the card. Approximate: the
 * offset's fraction of the row's text times the row's laid-out height
 * (onLayout), not the exact line (onTextLayout), which is close enough to
 * land on the right line or the one before in a paragraph.
 */
export function scrollYFor(layout: RowLayout, length: number, offset: number): number {
  return layout.y + (length > 0 ? (offset / length) * layout.height : 0);
}

/**
 * The row and offset at the top of the card, scrolled to `y`: the last row
 * starting at or above it (rows not laid out yet are skipped), and the same
 * fraction as scrollYFor, rounded down. None before any row has a layout.
 */
export function rowPositionAt(layouts: readonly (RowLayout | undefined)[], rows: readonly Row[], y: number): RowPosition | undefined {
  let found: number | undefined;
  for (const [i, l] of layouts.entries()) {
    if (l !== undefined && l.y <= y) found = i;
  }
  if (found === undefined) {
    const first = layouts.findIndex((l) => l !== undefined);
    return first < 0 ? undefined : { row: first, offset: 0 };
  }
  const l = layouts[found] as RowLayout;
  const length = rows[found]?.length ?? 0;
  const fraction = l.height > 0 ? Math.min(1, Math.max(0, (y - l.y) / l.height)) : 0;
  return { row: found, offset: Math.floor(fraction * length) };
}

/** A core Location's fields, as the FFI's record has them. */
export type Loc = {
  pubKey: string;
  docId?: bigint;
  book?: number;
  chapter?: number;
  verse?: number;
  paragraph?: number;
};

/** What a reader card's live text is: a Bible chapter (from a verse location) or a document. */
export type ReaderScope =
  | { kind: 'passage'; verse: Loc; book: number; chapter: number }
  | { kind: 'publication'; pubKey: string; docId: bigint };

/**
 * Where a ReaderState's `at` points (§6.6), for data.ts to wrap in a
 * CardRef: for a passage, one verse (start == end, verse set) in the
 * card's own Bible, made from its span's start location so its other fields
 * stay as the core wrote them; for a publication, its key, the document
 * and the paragraph.
 */
export function readerAt(
  scope: ReaderScope,
  position: Position,
): { kind: 'passage'; span: { start: Loc; end: Loc } } | { kind: 'publication'; location: Loc } {
  if (scope.kind === 'passage') {
    const verse: Loc = { ...scope.verse, book: scope.book, chapter: scope.chapter, verse: position.key };
    return { kind: 'passage', span: { start: verse, end: { ...verse } } };
  }
  return { kind: 'publication', location: { pubKey: scope.pubKey, docId: scope.docId, paragraph: position.key } };
}

/** A reader card's own place: a passage's span start, or a publication card's location. */
export type ReaderCardPlace = { kind: 'passage'; start: Loc } | { kind: 'publication'; location: Loc };

/**
 * What a reader card asks Reader.locate for (§6.6): where its reader was
 * left, if it has been read, else the card's own place.
 */
export function readerLocation(card: ReaderCardPlace, saved: { at: Loc } | undefined): Loc {
  return saved?.at ?? (card.kind === 'passage' ? card.start : card.location);
}

/**
 * What a reader card reads, from the core's Located for readerLocation: a
 * passage's chapter (and verse), or a publication's document (and
 * paragraph), as the core located them, its nearest place where the saved
 * one is gone (a publication alone is its start document, which the core
 * picks). The saved offset applies only where the core found the saved
 * place exactly; else the block's start, and `moved` says the spot moved.
 * None when the core located nothing this card can read (a passage's book
 * gone, a publication with no document).
 */
export type ReaderTarget =
  | { kind: 'passage'; book: number; chapter: number; wanted: Position | undefined; moved: boolean }
  | { kind: 'publication'; docId: bigint; wanted: Position | undefined; moved: boolean };

export function readerTarget(
  kind: ReaderCardPlace['kind'],
  located: { location: Loc; exact: boolean },
  saved: { charOffset: number } | undefined,
): ReaderTarget | undefined {
  const { location, exact } = located;
  const wanted = (key: number | undefined): Position | undefined =>
    key === undefined ? undefined : { key, charOffset: exact ? (saved?.charOffset ?? 0) : 0 };
  if (kind === 'passage') {
    const { book, chapter, verse } = location;
    if (book === undefined || chapter === undefined) return undefined;
    return { kind, book, chapter, wanted: wanted(verse), moved: !exact };
  }
  if (location.docId === undefined) return undefined;
  return { kind, docId: location.docId, wanted: wanted(location.paragraph), moved: !exact };
}

/** What the reader says where the core couldn't find a card's exact place. */
export const MOVED_NOTE = 'Couldn’t find the exact place. Showing the nearest one.';
