// The readers' bookmarks (bookmarks spec §3, §4, §6, §7), the Bible's and
// a publication's documents': what the picker shows and says, kept free of
// React Native so Node can test it.
// The core stores and returns a publication's bookmarks; this only decides
// how its list reads as the picker's 10 slots, what the toolbar button and
// screen readers say, and where a jump lands.

import type { CoreDocBlock } from '../studyspace/reader-state.ts';
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
 * A document of the open publication, as a whole (spec §3.1: an article
 * bookmark; paragraph bookmarks wait for the core's structured blocks).
 * Its key is the publication's whole key, issue tag included, so each
 * Watchtower issue is its own publication with its own 10 slots (spec §7).
 */
export type DocumentPlace = { pubKey: string; docId: bigint };

/** What a bookmark saves: a Bible place, or a publication's document. */
export type BookmarkPlace = BiblePlace | DocumentPlace;

function isDocumentPlace(place: BookmarkPlace): place is DocumentPlace {
  return 'docId' in place;
}

/**
 * What the toolbar button saves (spec §3.1, Decision 2): the selected verse
 * while the study pane is open, else the chapter. Its reference is the
 * study pane's and the heading's own: "John 3:16" or "John 3".
 */
export type SaveTarget = { place: BookmarkPlace; reference: string };

export function saveTarget(
  heading: string,
  at: { book: number; chapter: number },
  selectedVerse: number | undefined,
): SaveTarget {
  return selectedVerse === undefined
    ? { place: { book: at.book, chapter: at.chapter }, reference: heading }
    : { place: { book: at.book, chapter: at.chapter, verse: selectedVerse }, reference: verseReference(heading, selectedVerse) };
}

/**
 * What a publication's toolbar button saves (spec §3.1): its open document
 * as a whole, under the document's title, so the header reads "Save
 * <document title>".
 */
export function documentSaveTarget(pubKey: string, docId: bigint, title: string): SaveTarget {
  return { place: { pubKey, docId }, reference: title };
}

/**
 * The Location set_bookmark stores for a place. A chapter has no verse; a
 * document has no paragraph.
 */
export function bookmarkLocation(pubKey: string, place: BookmarkPlace): BookmarkLocation {
  if (isDocumentPlace(place)) return { pubKey, docId: place.docId };
  const { book, chapter, verse } = place;
  return verse === undefined ? { pubKey, book, chapter } : { pubKey, book, chapter, verse };
}

/**
 * Whether a bookmark is at a place: the same book and chapter, and the same
 * verse, or none for both (a chapter bookmark is not its first verse's).
 * A Bible place is its book, chapter and verse; a document id the core or
 * an import puts beside them doesn't make it another place. A document is
 * its publication (issue included) and document id, as a whole: a
 * paragraph's bookmark (from an import) is not the document's.
 */
export function isAtPlace(location: BookmarkLocation, place: BookmarkPlace): boolean {
  if (isDocumentPlace(place)) {
    return (
      location.pubKey === place.pubKey &&
      location.docId === place.docId &&
      location.book === undefined &&
      location.paragraph === undefined
    );
  }
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
export function bookmarkRows(bookmarks: readonly BookmarkLike[], target: BookmarkPlace): BookmarkRow[] {
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
 * The toolbar button's label and value. Pressable always hands View an
 * accessibilityValue object, so on Android a value going back to undefined
 * reaches BaseViewManager.setAccessibilityValue as a map without "text",
 * which leaves the old content description ("Bookmarks, John 3 is in slot
 * 2") in place; an empty text would leave "Bookmarks, ". There the value goes
 * in the label, whose every change rebuilds the content description.
 */
export function bookmarkButtonLabel(
  value: string | undefined,
  os: string,
): { accessibilityLabel: string; accessibilityValue?: { text: string } } {
  const label = 'Bookmarks';
  if (value === undefined) return { accessibilityLabel: label };
  if (os === 'android') return { accessibilityLabel: `${label}, ${value}` };
  return { accessibilityLabel: label, accessibilityValue: { text: value } };
}

/**
 * Each slot is one element (spec §6). Filled: "Slot 3, John 3:16, For God
 * loved…", with ", not found in this edition" where the row notes it and
 * ", current place" where the glyph marks it. Empty: "Slot 4, empty".
 */
export function rowLabel(row: BookmarkRow, missing = false): string {
  if (row.kind === 'empty') return `Slot ${row.number}, empty`;
  const parts = [`Slot ${row.number}`, row.title];
  if (row.snippet !== undefined) parts.push(row.snippet);
  if (missing) parts.push(NOT_FOUND_NOTE.toLowerCase());
  if (row.current) parts.push('current place');
  return parts.join(', ');
}

/** A filled slot's actions (spec §3.2, §6): its menu, long press, swipe and custom actions. */
export function replaceLabel(reference: string): string {
  return `Replace with ${reference}`;
}

export const DELETE_LABEL = 'Delete';

/**
 * A filled slot's iOS-look trailing swipe (spec §3.2): Replace (short, as
 * a swipe button has no room for the reference) inner, and the red Delete
 * on the outer, trailing-most edge. Each does what the menu's item does.
 */
export function bookmarkSwipeActions(onReplace: () => void, onDelete: () => void) {
  return [
    { key: 'replace', label: 'Replace', icon: { ios: 'arrow.triangle.2.circlepath', android: 'swap_horiz' }, onPress: onReplace },
    { key: 'delete', label: DELETE_LABEL, icon: { ios: 'trash', android: 'delete' }, destructive: true, onPress: onDelete },
  ] as const;
}

/** The trailing ⋯ / ⋮ button's label. */
export function rowMenuLabel(row: Extract<BookmarkRow, { kind: 'filled' }>): string {
  return `More actions for slot ${row.number}`;
}

/** A location as a string, the same for the same place: a cache key. */
export function locationKey(location: BookmarkLocation): string {
  const { pubKey, docId, book, chapter, verse, paragraph } = location;
  return [pubKey, docId ?? '', book ?? '', chapter ?? '', verse ?? '', paragraph ?? ''].join(':');
}

/**
 * What a row shows, as a key: a change of it (a save, a Replace, a Delete,
 * an Undo) cross-fades the row's content (spec §5).
 */
export function rowContentKey(row: BookmarkRow): string {
  return row.kind === 'empty' ? 'empty' : `filled|${row.title}|${row.snippet ?? ''}|${locationKey(row.location)}`;
}

/**
 * What a row shows at its trailing edge, outside the cross-fading content:
 * the filled glyph at the current place, and the ⋯ / ⋮ on any filled slot.
 * It follows the row as it is now, so a slot that empties and fills again
 * (a Delete and its Undo, or a save) shows them again.
 */
export function rowTrailing(row: BookmarkRow): { glyph: boolean; menu: boolean } {
  return row.kind === 'filled' ? { glyph: row.current, menu: true } : { glyph: false, menu: false };
}

/** The row note for a place the installed edition no longer has (spec §7). */
export const NOT_FOUND_NOTE = 'Not found in this edition';

/** The core's Located: where a saved location is now, and whether it is the saved place. */
export type LocatedLike = { location: BookmarkLocation; exact: boolean };

/** Reader.locate's answer for a slot, or that it threw. */
export type LocateResult = { ok: true; value: LocatedLike } | { ok: false };

/**
 * Where a filled slot opens (spec §7, "Location no longer exists"), from
 * the core's Reader.locate: missing unless the core found the saved place
 * exactly, and the place to open, which is the core's nearest one (an
 * earlier verse, the chapter, the book's first chapter). Where the core
 * fell back to the publication alone, or couldn't locate it at all, it
 * opens the Bible's start.
 */
export type SlotPlace = { missing: boolean; opens: BiblePlace | 'start' };

export function slotPlace(result: LocateResult): SlotPlace {
  if (!result.ok) return { missing: true, opens: 'start' };
  const { location, exact } = result.value;
  const { book, chapter, verse } = location;
  if (book === undefined || chapter === undefined) return { missing: !exact, opens: 'start' };
  return { missing: !exact, opens: verse === undefined ? { book, chapter } : { book, chapter, verse } };
}

/**
 * Where a publication's filled slot opens (spec §7), from Reader.locate:
 * missing unless the core found the saved place exactly; it opens the
 * document the core located (its nearest place, or the publication's start
 * document, which the core picks: a periodical issue's first study
 * article). Where the core gave no document, or couldn't locate it at all,
 * it opens the publication's contents.
 */
export type DocumentSlotPlace = { missing: boolean; opens: { docId: bigint } | 'contents' };

export function documentSlotPlace(result: LocateResult): DocumentSlotPlace {
  if (!result.ok) return { missing: true, opens: 'contents' };
  const { location, exact } = result.value;
  return { missing: !exact, opens: location.docId === undefined ? 'contents' : { docId: location.docId } };
}

/**
 * Where a publication bookmark's jump goes (spec §3.3: an article lands at
 * its top, no marker): the open document again (back to its top), another
 * document of the same publication, or its contents.
 */
export type DocumentJump = { kind: 'top' } | { kind: 'document'; docId: bigint } | { kind: 'contents' };

export function documentJump(opens: DocumentSlotPlace['opens'], here: bigint): DocumentJump {
  if (opens === 'contents') return { kind: 'contents' };
  return opens.docId === here ? { kind: 'top' } : { kind: 'document', docId: opens.docId };
}

/** A document's body paragraphs (not headings), in the core's reading order. */
function bodyParagraphs(blocks: readonly CoreDocBlock[]): number[] {
  return blocks.flatMap((block): number[] => {
    switch (block.tag) {
      case 'Paragraph':
      case 'Question':
        return [block.inner.paragraph];
      case 'Aside':
        return bodyParagraphs(block.inner.blocks);
      case 'List':
        return block.inner.items.flatMap((item) => bodyParagraphs(item.blocks));
      default:
        return [];
    }
  });
}

/**
 * A document bookmark's snippet (spec §3.1: the first line of the block):
 * the plain text the core gives (ParagraphAnchor.text) of its first body
 * paragraph in reading order (the core's blocks; headings are not body,
 * since the row's title already names the document), as bookmarkSnippet
 * cuts it. None when the core has no such text.
 *
 * A snippet is there so you know the place again, and a cover's legal
 * block isn't a place (#85 design question 4): when the first body text is
 * a copyright line, everything after it on such a page is boilerplate too,
 * so the row shows its title alone.
 */
export function documentSnippet(
  blocks: readonly CoreDocBlock[],
  paragraphs: readonly { paragraph: number; text: string }[],
): string | undefined {
  const texts = new Map(paragraphs.map((p) => [p.paragraph, p.text]));
  for (const paragraph of bodyParagraphs(blocks)) {
    const text = texts.get(paragraph) ?? '';
    if (isCopyrightLine(text)) return undefined;
    const snippet = bookmarkSnippet(text);
    if (snippet !== undefined) return snippet;
  }
  return undefined;
}

/** A publication's copyright line ("© 2026 …"): never a snippet. */
export function isCopyrightLine(text: string): boolean {
  return /^\s*(©|\(c\)\s*\d{4}|copyright\s+©?\s*\d{4})/iu.test(text);
}

/** The Bible's start: the first chapter of its first book, in the core's order. */
export function startPlace(books: readonly { book: number }[] | undefined): BiblePlace | undefined {
  const first = books?.[0];
  return first === undefined ? undefined : { book: first.book, chapter: 1 };
}

/** The toast after opening the nearest place (spec §7): "… Opened John 3." */
export function notFoundMessage(opened: string): string {
  return `Couldn't find the exact place. Opened ${opened}.`;
}

/**
 * Hardware ↑/↓ in the picker (spec §4): each slot's next focus up and
 * down is the slot above and below (never its own ⋯ / ⋮ button), by their
 * native view tags; the first and last rows leave it to Android.
 */
export function rowFocusNeighbours(
  index: number,
  tags: readonly (number | undefined)[],
): { up: number | undefined; down: number | undefined } {
  return { up: index > 0 ? tags[index - 1] : undefined, down: tags[index + 1] };
}

/**
 * Ctrl+D (or Meta+D) on a hardware keyboard opens the picker in save mode
 * (spec §4), only in the focused reader (the Bible's, or a publication's
 * document) with its chapter or document read.
 */
export function shortcutOpensBookmarks(key: string, reader: { focused: boolean; chapterRead: boolean }): boolean {
  return key === 'd' && reader.focused && reader.chapterRead;
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

/** A tablet's window is at least this wide, in dp (the medium breakpoint). */
export const TABLET_MIN_WIDTH = 600;

/**
 * How a filled slot's ⋯ / ⋮ opens Replace and Delete: Material, an M3 menu
 * anchored to the ⋮ at any width; the iOS look, a card anchored to the ⋯
 * on a tablet (≥ 600dp, spec §4) and the bottom action sheet on a phone.
 * A long press has no button to anchor to, so it opens the sheet.
 */
export function rowMenuPresentation(look: Look, windowWidthDp: number): 'sheet' | 'anchored' {
  if (look === 'material') return 'anchored';
  return windowWidthDp >= TABLET_MIN_WIDTH ? 'anchored' : 'sheet';
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

/**
 * The picker's scrim, and the area outside its tablet card (spec §4, Lumen
 * ruling 6 on #83): a tap there closes the picker, but it is never a focus
 * stop. On Android a view a screen reader can reach is one a hardware
 * arrow can land on (`accessible` makes a view focusable), and the scrim
 * fills the window from its top, so with nothing focused yet the first ↑/↓
 * took it. Out of both, that press lands in the sheet: its handle or first
 * slot. Keyboards close it with Esc (Back), screen readers with the
 * sheet's handle or close button, or their own escape gesture.
 */
export const PICKER_SCRIM_FOCUS = {
  accessible: false,
  focusable: false,
  importantForAccessibility: 'no-hide-descendants',
  accessibilityElementsHidden: true,
} as const;
