import type { VerseAnchor } from 'berean-ffi-rn';

// The reader's paragraph shape, mirroring the one the core is about to
// report. A run is one verse's stretch of text inside a paragraph.
export type Run = { verse: number; label: string; text: string; markers?: unknown };
export type Paragraph = { style: string; runs: Run[] };

/**
 * The chapter as paragraphs. The core doesn't report paragraphs yet, so
 * the whole chapter is one 'body' paragraph of its verses in order. Echo's
 * Paragraph{style, runs:[{verse,label,text,markers}]} from the core
 * replaces this function later. Paragraph breaks come from the core only;
 * they are never invented in JS.
 */
export function paragraphsFromVerses(verses: readonly VerseAnchor[]): Paragraph[] {
  if (verses.length === 0) return [];
  return [
    {
      style: 'body',
      runs: verses.map(({ verse, label, text }) => ({ verse, label, text })),
    },
  ];
}
