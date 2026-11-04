// The Bible reader's bookmarks (bookmarks spec §3, §4, §6): what the
// picker shows and says, kept free of React Native so Node can test it.
// The core stores and returns a publication's bookmarks; this only decides
// how its list reads as the picker's 10 slots, what the toolbar button and
// screen readers say, and where a jump lands.

import { verseReference } from './bible-nav.ts';

type Look = 'ios' | 'material';
type WindowClass = 'compact' | 'medium' | 'expanded';

/** Each publication has 10 slots, stored 0–9 and shown 1–10. */
export const BOOKMARK_SLOTS = 10;

/** The parts of the core's Location a Bible bookmark uses. */
export type BookmarkLocation = {
  pubKey: string;
  docId?: bigint;
  book?: number;
  chapter?: number;
  verse?: number;
  paragraph?: number;
};

/** The parts of the core's Bookmark the picker reads. */
export type BookmarkLike = { slot: number; location: BookmarkLocation; title: string; snippet?: string };

/** A place in the open Bible: a chapter, or a verse in it. */
export type BiblePlace = { book: number; chapter: number; verse?: number };

/**
 * What the toolbar button saves (spec §3.1, Decision 2): the selected verse
 * while the study pane is open, else the chapter. Its reference is the
 * study pane's and the heading's own: "John 3:16" or "John 3".
 */
export type SaveTarget = { place: BiblePlace; reference: string };

export function saveTarget(
  heading: string,
  at: { book: number; chapter: number },
  selectedVerse: number | undefined,
): SaveTarget {
  return selectedVerse === undefined
    ? { place: { book: at.book, chapter: at.chapter }, reference: heading }
    : { place: { book: at.book, chapter: at.chapter, verse: selectedVerse }, reference: verseReference(heading, selectedVerse) };
}

/** The Location set_bookmark stores for a place. A chapter has no verse. */
export function bookmarkLocation(pubKey: string, place: BiblePlace): BookmarkLocation {
  const { book, chapter, verse } = place;
  return verse === undefined ? { pubKey, book, chapter } : { pubKey, book, chapter, verse };
}

/**
 * Whether a bookmark is at a place: the same book and chapter, and the same
 * verse, or none for both (a chapter bookmark is not its first verse's).
 * A Bible place is its book, chapter and verse; a document id the core or
 * an import puts beside them doesn't make it another place.
 */
export function isAtPlace(location: BookmarkLocation, place: BiblePlace): boolean {
  return location.book === place.book && location.chapter === place.chapter && location.verse === place.verse;
}

export type BookmarkRow =
  | { kind: 'empty'; slot: number; number: number }
  | {
      kind: 'filled';
      slot: number;
      number: number;
      location: BookmarkLocation;
      title: string;
      snippet: string | undefined;
      /** At the save target: marked with the filled glyph. */
      current: boolean;
    };

/**
 * The picker's list (spec §3.2): always exactly 10 rows, slot 1 first, each
 * the core's bookmark in that slot or empty. A slot outside 0–9 has no row.
 */
export function bookmarkRows(bookmarks: readonly BookmarkLike[], target: BiblePlace): BookmarkRow[] {
  const bySlot = new Map(bookmarks.map((b) => [b.slot, b]));
  return Array.from({ length: BOOKMARK_SLOTS }, (_, slot): BookmarkRow => {
    const number = slot + 1;
    const bookmark = bySlot.get(slot);
    if (bookmark === undefined) return { kind: 'empty', slot, number };
    return {
      kind: 'filled',
      slot,
      number,
      location: bookmark.location,
      title: bookmark.title,
      snippet: bookmark.snippet === '' ? undefined : bookmark.snippet,
      current: isAtPlace(bookmark.location, target),
    };
  });
}

export function allSlotsFull(rows: readonly BookmarkRow[]): boolean {
  return rows.every((row) => row.kind === 'filled');
}

/**
 * The header's second line: what an empty slot saves, or, with every slot
 * in use, that one has to be replaced first.
 */
export function saveLine(reference: string, full: boolean): string {
  return full
    ? `All ${BOOKMARK_SLOTS} slots are in use. Replace one to save ${reference}.`
    : `Save ${reference}`;
}

/** "2", "2 and 5", "2, 5 and 7". */
function slotList(numbers: readonly number[]): string {
  if (numbers.length <= 1) return numbers.join('');
  return `${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}`;
}

/**
 * The toolbar button (spec §3.2, §6): filled while the save target is in
 * any slot, with the value "John 3 is in slot 2" ("in slots 2 and 5" when
 * it was saved twice). Outline with no value otherwise.
 */
export function toolbarBookmark(
  rows: readonly BookmarkRow[],
  reference: string,
): { filled: boolean; value: string | undefined } {
  const numbers = rows.flatMap((row) => (row.kind === 'filled' && row.current ? [row.number] : []));
  if (numbers.length === 0) return { filled: false, value: undefined };
  return { filled: true, value: `${reference} is in slot${numbers.length > 1 ? 's' : ''} ${slotList(numbers)}` };
}

/**
 * Each slot is one element (spec §6). Filled: "Slot 3, John 3:16, For God
 * loved…", with ", current place" where the glyph marks it. Empty:
 * "Slot 4, empty".
 */
export function rowLabel(row: BookmarkRow): string {
  if (row.kind === 'empty') return `Slot ${row.number}, empty`;
  const parts = [`Slot ${row.number}`, row.title];
  if (row.snippet !== undefined) parts.push(row.snippet);
  if (row.current) parts.push('current place');
  return parts.join(', ');
}

/** A slot's default action: "Jump to John 3:16", or "Save John 3:16 here". */
export function rowAction(row: BookmarkRow, reference: string): string {
  return row.kind === 'empty' ? `Save ${reference} here` : `Jump to ${row.title}`;
}

export function savedAnnouncement(number: number): string {
  return `Saved to slot ${number}`;
}

export function jumpAnnouncement(number: number, title: string): string {
  return `Bookmark ${number}, ${title}`;
}

/**
 * A snippet is at most this many characters, so the stored first line stays
 * a line (the row shows one, or two at large text). About a phone row's two
 * lines of body text at the default size.
 */
export const SNIPPET_MAX = 100;

/**
 * The first line of a block's plain text as a snippet: whitespace runs
 * become one space, and text over `max` is cut at the last word boundary
 * that keeps at least half of it (else mid-word), its trailing punctuation
 * dropped, then an ellipsis. Empty text has no snippet.
 */
export function bookmarkSnippet(text: string, max = SNIPPET_MAX): string | undefined {
  const line = text.replace(/\s+/g, ' ').trim();
  if (line === '') return undefined;
  if (line.length <= max) return line;
  const space = line.lastIndexOf(' ', max);
  const cut = space >= max / 2 ? line.slice(0, space) : line.slice(0, max);
  return `${cut.replace(/[\s,;:.!?·—–-]+$/u, '')}…`;
}

/**
 * Where a jump goes (spec §3.3): a verse bookmark lands its verse, a chapter
 * bookmark the chapter's top. Always the same publication, so only the
 * chapter can differ; a location without a book and chapter goes nowhere.
 */
export type BookmarkJump = { book: number; chapter: number; verse: number | undefined; sameChapter: boolean };

export function bookmarkJump(
  location: BookmarkLocation,
  here: { book: number; chapter: number },
): BookmarkJump | undefined {
  const { book, chapter, verse } = location;
  if (book === undefined || chapter === undefined) return undefined;
  return { book, chapter, verse, sameChapter: book === here.book && chapter === here.chapter };
}

/**
 * Where the picker opens (spec §4). Never a plain menu.
 * - bottomSheet: an M3 modal bottom sheet with a drag handle and a scrim,
 *   phone and tablet; from 600dp capped at 640dp wide and centered.
 * - sheet: the iOS look's phone sheet at the medium detent, with a grabber,
 *   draggable to full height; dragging down dismisses it.
 * - popover: the iOS look's tablet card anchored under the button, at most
 *   360dp wide.
 */
export type BookmarkPickerPlacement =
  | { form: 'bottomSheet'; maxWidth: number | undefined }
  | { form: 'sheet' }
  | { form: 'popover'; maxWidth: number };

export const BOOKMARK_SHEET_MAX_WIDTH = 640;
export const BOOKMARK_POPOVER_WIDTH = 360;

export function bookmarkPickerPlacement(look: Look, windowClass: WindowClass): BookmarkPickerPlacement {
  if (look === 'material') {
    return { form: 'bottomSheet', maxWidth: windowClass === 'compact' ? undefined : BOOKMARK_SHEET_MAX_WIDTH };
  }
  return windowClass === 'compact' ? { form: 'sheet' } : { form: 'popover', maxWidth: BOOKMARK_POPOVER_WIDTH };
}

/** M3 modal bottom sheets keep 72dp clear above them. */
export const MATERIAL_SHEET_TOP_MARGIN = 72;
/** The iOS large detent leaves a sliver of the screen above it. */
export const IOS_LARGE_DETENT_GAP = 10;

/**
 * The sheet's heights in the window, below its top inset. Material: one
 * height, up to the M3 top margin. The iOS look: it opens at the medium
 * detent (half the window) and drags up to the large one.
 */
export function bookmarkSheetHeights(
  form: 'bottomSheet' | 'sheet',
  { windowHeight, topInset }: { windowHeight: number; topInset: number },
): { height: number; restHeight: number | undefined } {
  if (form === 'bottomSheet') {
    return { height: Math.round(windowHeight - topInset - MATERIAL_SHEET_TOP_MARGIN), restHeight: undefined };
  }
  const height = Math.round(windowHeight - topInset - IOS_LARGE_DETENT_GAP);
  return { height, restHeight: Math.min(height, Math.round(windowHeight / 2)) };
}

/** The medium detent must show the header and this many whole slots, or the sheet opens large. */
export const MEDIUM_DETENT_MIN_ROWS = 3;

/**
 * Which detent the iOS look's phone sheet opens at, from its laid-out
 * header (grabber included) and slot rows: medium while it shows the header
 * and the first MEDIUM_DETENT_MIN_ROWS rows whole above the bottom inset
 * (at large text the header alone can fill it); otherwise large. Fewer
 * rows than that (or none) only need those to fit.
 */
export function bookmarkSheetOpensAt({
  mediumHeight,
  headerHeight,
  rowHeights,
  bottomInset,
}: {
  mediumHeight: number;
  headerHeight: number;
  rowHeights: readonly number[];
  bottomInset: number;
}): 'medium' | 'large' {
  const rows = rowHeights.slice(0, MEDIUM_DETENT_MIN_ROWS).reduce((sum, height) => sum + height, 0);
  return headerHeight + rows <= mediumHeight - bottomInset ? 'medium' : 'large';
}

/**
 * The Material sheet's height: an M3 modal bottom sheet fits its laid-out
 * content (handle, header, rows and the bottom padding) up to its max
 * height, the M3 top margin clear; only content taller than that scrolls.
 */
export function bookmarkSheetFit({
  contentHeight,
  maxHeight,
}: {
  contentHeight: number;
  maxHeight: number;
}): { height: number; scrolls: boolean } {
  const height = Math.ceil(contentHeight);
  return height <= maxHeight ? { height, scrolls: false } : { height: maxHeight, scrolls: true };
}
