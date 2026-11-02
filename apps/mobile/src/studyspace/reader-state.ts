// A reader card's text and its place in it (findings §6.6): the core's
// chapter or document blocks as rows of plain text, where a saved anchor
// (a verse or paragraph number plus a UTF-16 offset into its text) lands
// in them, the anchor at a row offset when a scroll settles, the ~3 lines
// shown at L3, and the location a ReaderState is saved at. Kept free of
// React Native (and of the FFI's runtime) for the tests.

import type { CoreBlock, Run, Segment } from '@/reader/chapter-blocks';

/** What a row draws, in order: a verse or paragraph number, or text (a verse's or paragraph's when keyed). */
export type Part = { text: string; number?: boolean; key?: number };
/** A keyed part's stretch of its row's text: `key` is the verse or paragraph number. */
export type Piece = { key: number; start: number; length: number };
/** One block as drawn: a heading, or a paragraph (or line of poetry) of verses. */
export type Row = { heading: boolean; parts: Part[]; pieces: Piece[]; length: number };

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
  return { heading, parts, pieces, length: at };
}

const NO_BREAK_SPACE = String.fromCharCode(0xa0);

/**
 * A Bible chapter's rows from the core's blocks: each verse run's text is
 * a piece keyed by its verse, after its number (if the run shows one) and a
 * space between runs, as the reader draws them. A note run (verse 0) is
 * drawn but never an anchor. `segments` is the reader's blockSegments
 * (passed in, so Node can run this without the app's path aliases).
 */
// Core ask (Echo): the core's "plain text of a verse" isn't exposed; this
// takes it to be the verse's runs' text, in order, with nothing between.
export function bibleRows(blocks: readonly CoreBlock[], segments: (runs: readonly Run[]) => Segment[]): Row[] {
  return blocks.map((block) => {
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

/** A paragraph's plain text from its inlines. Footnote markers and page markers aren't text. */
// Core ask (Echo): a paragraph's plain text (the unit char_offset counts
// in) isn't exposed; this flattens the inlines app-side.
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
 * fields aren't drawn on a card yet.
 */
export function documentRows(blocks: readonly CoreDocBlock[]): Row[] {
  return blocks.flatMap((block): Row[] => {
    switch (block.tag) {
      case 'Heading': {
        const { paragraph, inlines } = block.inner;
        return [row(true, [{ text: docText(inlines), key: paragraph }])];
      }
      case 'Paragraph':
      case 'Question': {
        const { paragraph, number, inlines } = block.inner;
        const text: Part = { text: docText(inlines), key: paragraph };
        return [row(false, number === undefined ? [text] : [{ text: `${number} `, number: true }, text])];
      }
      case 'Aside': {
        const { title, blocks: inside } = block.inner;
        const head = title === undefined ? [] : [row(true, [{ text: docText(title.inlines), key: title.paragraph }])];
        return [...head, ...documentRows(inside)];
      }
      case 'List':
        return block.inner.items.flatMap((item) => documentRows(item.blocks));
      case 'Figure':
        return documentRows(block.inner.caption);
      default:
        return [];
    }
  });
}

/** Every piece of `key`, in order, with its row. */
function piecesOf(rows: readonly Row[], key: number): { row: number; piece: Piece }[] {
  return rows.flatMap((r, index) => r.pieces.filter((p) => p.key === key).map((piece) => ({ row: index, piece })));
}

/**
 * Where `wanted` lands in `rows` (§6.6): its block with the offset clamped
 * to the block's length (a block split over rows, as a verse over two
 * paragraphs, counts its pieces in order); if the block is gone, the start
 * of the nearest earlier one (by verse or paragraph number); else, or with
 * nothing wanted, the start of the first block. The top of the text if
 * there are no blocks.
 */
// Core ask (Echo): the nearest-earlier-block fallback is app-side here.
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
  for (const [i, { row: r, piece }] of pieces.entries()) {
    // Past this piece's end goes on to the next; the last takes the clamp.
    if (offset < piece.length || i === pieces.length - 1) {
      return { row: r, offset: piece.start + Math.min(offset, piece.length) };
    }
    offset -= piece.length;
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
    const piece = here.pieces.find((p) => at.offset <= p.start + p.length);
    if (piece !== undefined) {
      const before = piecesOf(rows, piece.key)
        .filter((p) => p.row < at.row || (p.row === at.row && p.piece.start < piece.start))
        .reduce((sum, p) => sum + p.piece.length, 0);
      return { key: piece.key, charOffset: before + Math.max(0, at.offset - piece.start) };
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
