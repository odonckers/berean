// Verse highlights as the reader draws them, kept free of React Native so
// Node can test it. The core keeps the highlights (their ids, colors and
// ranges); this only maps what it returns onto a chapter's verses. The
// shapes are structural: the generated Location and LocationSpan are
// assignable to them.

import type { HighlightColor, TextRange } from 'berean-ffi-rn';

import type { HighlightName } from '@/design/tokens';
import type { Segment } from './chapter-blocks.ts';

/** The core's color names, as the generated HighlightColor enum's keys. */
export type CoreColorName = keyof typeof HighlightColor;

// Both directions are spelled out, so a color added to the core fails the
// type check here until the reader has a fill for it.
const CORE_NAMES: Record<HighlightName, CoreColorName> = {
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
  pink: 'Pink',
  orange: 'Orange',
};
const READER_NAMES: Record<CoreColorName, HighlightName> = {
  Yellow: 'yellow',
  Green: 'green',
  Blue: 'blue',
  Purple: 'purple',
  Pink: 'pink',
  Orange: 'orange',
};

/** The chips' order, per the guide: Yellow, Green, Blue, Purple, Pink, Orange. */
export const HIGHLIGHT_ORDER: readonly HighlightName[] = [
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'orange',
];

export function toCoreColorName(name: HighlightName): CoreColorName {
  return CORE_NAMES[name];
}

export function toHighlightName(core: CoreColorName): HighlightName {
  return READER_NAMES[core];
}

/** A color's name as a chip shows it: "Yellow". Highlights have no other name. */
export function highlightLabel(name: HighlightName): string {
  return CORE_NAMES[name];
}

type CoreLocation = { book?: number; chapter?: number; verse?: number };
type CoreSpan = { start: CoreLocation; end: CoreLocation };

/** A core highlight with its color as the reader names it. */
export type ChapterHighlight = { id: string; span: CoreSpan; color: HighlightName };

/** The highlight drawn on a verse: the core's id, for recoloring and removing it. */
export type VerseHighlight = { id: string; color: HighlightName };

/**
 * A whole verse as the core's TextRange: the verse at both ends, no word
 * tokens. The core addresses partial ranges by JW word-token indexes, and
 * the reader exposes no token boundaries, so the reader only makes
 * whole-verse highlights.
 */
export function wholeVerseRange(
  pubKey: string,
  book: number,
  chapter: number,
  verse: number,
): TextRange {
  const at = { pubKey, book, chapter, verse };
  return { span: { start: at, end: { ...at } }, startToken: undefined, endToken: undefined };
}

// Where a location's chapter is against this one: -1 before, 0 the same, 1
// after; none if the location names no book and chapter.
function compareChapter(at: CoreLocation, book: number, chapter: number): number | undefined {
  if (at.book === undefined || at.chapter === undefined) return undefined;
  if (at.book !== book) return at.book < book ? -1 : 1;
  return at.chapter === chapter ? 0 : at.chapter < chapter ? -1 : 1;
}

/**
 * The highlight on each of the chapter's verses. A highlight covers its
 * whole verses: one with word tokens (from an imported backup, say) is
 * drawn over every verse its span touches, since the reader has no token
 * boundaries to draw part of a verse. A span running in from the chapter
 * before or on into the next covers the verses up to or from its edge.
 * Where highlights overlap, the core's later one is drawn.
 */
export function highlightsByVerse(
  highlights: readonly ChapterHighlight[],
  at: { book: number; chapter: number },
  verses: readonly number[],
): ReadonlyMap<number, VerseHighlight> {
  const byVerse = new Map<number, VerseHighlight>();
  for (const { id, span, color } of highlights) {
    const start = compareChapter(span.start, at.book, at.chapter);
    const end = compareChapter(span.end, at.book, at.chapter);
    if (start === undefined || end === undefined || start > 0 || end < 0) continue;
    const first = start === 0 ? (span.start.verse ?? 1) : 1;
    const last = end === 0 ? (span.end.verse ?? Infinity) : Infinity;
    for (const verse of verses) {
      if (verse >= first && verse <= last) byVerse.set(verse, { id, color });
    }
  }
  return byVerse;
}

/**
 * The fill a block's segment takes. Verse text takes its verse's fill; a
 * space takes it only between two parts of the same highlighted verse, so
 * the fill reads as one. Verse numbers and notes are never filled.
 */
export function segmentHighlight(
  segments: readonly Segment[],
  index: number,
  byVerse: ReadonlyMap<number, VerseHighlight>,
): HighlightName | undefined {
  const segment = segments[index];
  if (segment?.kind === 'text') return byVerse.get(segment.verse)?.color;
  if (segment?.kind !== 'space') return undefined;
  const before = segments[index - 1];
  const after = segments[index + 1];
  if (before?.kind !== 'text' || after?.kind !== 'text' || before.verse !== after.verse) {
    return undefined;
  }
  return byVerse.get(before.verse)?.color;
}

/**
 * How screen readers name a verse: "Verse 3", or "Verse 3, highlighted,
 * yellow" with the color's spoken name.
 */
export function verseSubject(verse: number, spokenColor: string | undefined): string {
  return spokenColor === undefined ? `Verse ${verse}` : `Verse ${verse}, highlighted, ${spokenColor}`;
}

/**
 * A verse's Highlight action, which opens the highlight chips: "Verse 3,
 * highlight", or "Verse 3, highlighted, yellow, change highlight".
 */
export function highlightActionLabel(verse: number, spokenColor: string | undefined): string {
  const action = spokenColor === undefined ? 'highlight' : 'change highlight';
  return `${verseSubject(verse, spokenColor)}, ${action}`;
}
