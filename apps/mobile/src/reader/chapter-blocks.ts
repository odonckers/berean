import type { ParagraphStyle } from 'berean-ffi-rn';

// The core's chapter blocks, structurally: the generated ChapterBlock and
// VerseRun are assignable to these, and Node can test the mapping without
// loading the native module.
type CoreRun = { verse: number; label?: string; text: string };
export type CoreBlock =
  | { tag: 'Heading'; inner: Readonly<{ text: string }> }
  | {
      tag: 'Paragraph';
      inner: Readonly<{ paragraph: number; style: ParagraphStyle; runs: readonly CoreRun[] }>;
    };

/**
 * One verse part's stretch of text inside a paragraph. The label is the
 * core's: absent on a superscription or a verse's later parts, which show
 * no number.
 */
export type Run = { verse: number; label?: string; text: string };
export type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; paragraph: number; style: ParagraphStyle; runs: Run[] };

/**
 * The chapter's blocks in the core's order: its headings, and its
 * paragraphs and lines of poetry with their verse runs. Paragraph breaks
 * come from the core only; they are never invented in JS.
 */
export function chapterBlocks(blocks: readonly CoreBlock[]): Block[] {
  return blocks.map((block) =>
    block.tag === 'Heading'
      ? { kind: 'heading', text: block.inner.text }
      : {
          kind: 'paragraph',
          paragraph: block.inner.paragraph,
          style: block.inner.style,
          runs: block.inner.runs.map(({ verse, label, text }) =>
            label === undefined ? { verse, text } : { verse, label, text },
          ),
        },
  );
}

/**
 * Whether a run is verse text. A note run (verse 0) isn't: it has no
 * number and no study, and is never a verse to select.
 */
export function isVerseRun(run: Run): boolean {
  return run.verse !== 0;
}

/**
 * The number printed at a run, or none. An empty label falls back to the
 * verse number. A note run never has one.
 */
export function verseLabel(run: Run): string | undefined {
  if (run.label === undefined || !isVerseRun(run)) return undefined;
  return run.label === '' ? String(run.verse) : run.label;
}

/** The verses whose numbers are in these runs: the verses they open. */
export function numberedVerses(runs: readonly Run[]): number[] {
  return runs.filter((run) => verseLabel(run) !== undefined).map((run) => run.verse);
}

/**
 * What a block of runs draws, in order. Runs are plain text, so a space
 * goes between consecutive runs; a verse number goes before its run's text.
 * The space before a number is the number's own (`separated`), so it is
 * part of the number's touch target.
 */
export type Segment =
  | { kind: 'space' }
  | { kind: 'number'; verse: number; label: string; separated: boolean }
  | { kind: 'text'; verse: number; text: string }
  | { kind: 'note'; text: string };

export function blockSegments(runs: readonly Run[]): Segment[] {
  return runs.flatMap((run, index): Segment[] => {
    const space: Segment[] = index > 0 ? [{ kind: 'space' }] : [];
    if (!isVerseRun(run)) return [...space, { kind: 'note', text: run.text }];
    const label = verseLabel(run);
    const text: Segment = { kind: 'text', verse: run.verse, text: run.text };
    if (label === undefined) return [...space, text];
    return [{ kind: 'number', verse: run.verse, label, separated: index > 0 }, text];
  });
}

// U+202F pads the number inside its selection background, always present
// so selecting never reflows the line; U+00A0 after it keeps the number on
// the same line as its verse's first word. Both are no-break: U+2009 or
// U+200A could break the line and split the number from its verse.
const NARROW_NO_BREAK_SPACE = String.fromCharCode(0x202f);
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

/**
 * A verse number's span, in pieces: the separator from the run before (a
 * plain space, or none at the block's start), the pad either side of the
 * label inside its background, and the space after it. All of it is the
 * number's touch target.
 */
export function numberSpan(
  label: string,
  separated: boolean,
): { separator: string; pad: string; label: string; trailing: string } {
  return {
    separator: separated ? ' ' : '',
    pad: NARROW_NO_BREAK_SPACE,
    label,
    trailing: NO_BREAK_SPACE,
  };
}

/**
 * Where the study pane splits the chapter for `verse`: after the verse's
 * last run, in the block holding it. None for no verse, a note's verse 0,
 * or a verse the chapter doesn't have.
 */
export function paneSplit(
  blocks: readonly Block[],
  verse: number | undefined,
): { block: number; run: number } | undefined {
  if (verse === undefined || verse === 0) return undefined;
  const block = blocks.findLastIndex(
    (b) => b.kind === 'paragraph' && b.runs.some((run) => isVerseRun(run) && run.verse === verse),
  );
  const found = blocks[block];
  if (found?.kind !== 'paragraph') return undefined;
  return { block, run: found.runs.findLastIndex((run) => run.verse === verse) };
}

/** The block holding a verse's number, where focus returns on close; -1 if none. */
export function numberBlock(blocks: readonly Block[], verse: number): number {
  return blocks.findIndex(
    (block) => block.kind === 'paragraph' && numberedVerses(block.runs).includes(verse),
  );
}
