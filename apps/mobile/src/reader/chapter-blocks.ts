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
 * The number printed at a run, or none. An empty label falls back to the
 * verse number.
 */
export function verseLabel(run: Run): string | undefined {
  if (run.label === undefined) return undefined;
  return run.label === '' ? String(run.verse) : run.label;
}
