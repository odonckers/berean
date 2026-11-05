import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  BOOKMARK_POPOVER_WIDTH,
  BOOKMARK_SHEET_MAX_WIDTH,
  BOOKMARK_SLOTS,
  IOS_LARGE_DETENT_GAP,
  MATERIAL_SHEET_TOP_MARGIN,
  MEDIUM_DETENT_MIN_ROWS,
  SNIPPET_MAX,
  DELETE_LABEL,
  NOT_FOUND_NOTE,
  type BookmarkLike,
  allSlotsFull,
  locationKey,
  notFoundMessage,
  replaceLabel,
  rowContentKey,
  rowFocusNeighbours,
  rowMenuLabel,
  shortcutOpensBookmarks,
  slotPlace,
  startPlace,
  bookmarkJump,
  bookmarkLocation,
  bookmarkPickerPlacement,
  bookmarkRows,
  bookmarkSheetFit,
  bookmarkSheetHeights,
  bookmarkSheetOpensAt,
  bookmarkSnippet,
  bookmarkSwipeActions,
  isAtPlace,
  rowMenuPresentation,
  TABLET_MIN_WIDTH,
  jumpAnnouncement,
  rowAction,
  rowLabel,
  saveLine,
  saveTarget,
  savedAnnouncement,
  toolbarBookmark,
  PICKER_SCRIM_FOCUS,
  documentJump,
  documentSaveTarget,
  documentSlotPlace,
  documentSnippet,
} from './bookmarks.ts';
import type { CoreDocBlock } from '../studyspace/reader-state.ts';

const pubKey = 'nwtsty_E';
const john3 = { book: 43, chapter: 3 };
const john316 = { book: 43, chapter: 3, verse: 16 };

const bookmark = (slot: number, location: Omit<BookmarkLike['location'], 'pubKey'>, title: string, snippet?: string): BookmarkLike => ({
  slot,
  location: { pubKey, ...location },
  title,
  snippet,
});

describe('the save target (spec §3.1, Decision 2)', () => {
  test('with no study pane open, the chapter', () => {
    assert.deepEqual(saveTarget('John 3', john3, undefined), { place: john3, reference: 'John 3' });
  });

  test('with the study pane open, its selected verse', () => {
    assert.deepEqual(saveTarget('John 3', john3, 16), { place: john316, reference: 'John 3:16' });
  });

  test('the stored location: a chapter has no verse', () => {
    assert.deepEqual(bookmarkLocation(pubKey, john3), { pubKey, book: 43, chapter: 3 });
    assert.equal('verse' in bookmarkLocation(pubKey, john3), false);
    assert.deepEqual(bookmarkLocation(pubKey, john316), { pubKey, book: 43, chapter: 3, verse: 16 });
  });
});

describe('the current place', () => {
  test('a chapter bookmark is at its chapter, not at a verse in it', () => {
    const chapter = { pubKey, book: 43, chapter: 3 };
    assert.equal(isAtPlace(chapter, john3), true);
    assert.equal(isAtPlace(chapter, john316), false);
  });

  test('a verse bookmark is at its verse, not at its chapter or another verse', () => {
    const verse = { pubKey, book: 43, chapter: 3, verse: 16 };
    assert.equal(isAtPlace(verse, john316), true);
    assert.equal(isAtPlace(verse, john3), false);
    assert.equal(isAtPlace(verse, { ...john316, verse: 17 }), false);
  });

  test('another chapter or book is never the place', () => {
    assert.equal(isAtPlace({ pubKey, book: 43, chapter: 4 }, john3), false);
    assert.equal(isAtPlace({ pubKey, book: 42, chapter: 3 }, john3), false);
  });

  test('a document id beside the Bible location changes nothing', () => {
    assert.equal(isAtPlace({ pubKey, docId: 1001070103n, book: 43, chapter: 3 }, john3), true);
  });
});

describe('the picker is the list (spec §3.2)', () => {
  test('an empty publication: exactly 10 empty rows, slots shown 1–10', () => {
    const rows = bookmarkRows([], john3);
    assert.equal(rows.length, BOOKMARK_SLOTS);
    rows.forEach((row, index) => {
      assert.deepEqual(row, { kind: 'empty', slot: index, number: index + 1 });
    });
    assert.equal(allSlotsFull(rows), false);
  });

  test('each stored slot fills its own row; the rest stay empty', () => {
    const rows = bookmarkRows(
      [bookmark(2, john316, 'John 3:16', 'For God loved the world so much'), bookmark(0, { book: 1, chapter: 1 }, 'Genesis 1')],
      john3,
    );
    assert.equal(rows.length, 10);
    assert.deepEqual(rows[0], {
      kind: 'filled',
      slot: 0,
      number: 1,
      location: { pubKey, book: 1, chapter: 1 },
      title: 'Genesis 1',
      snippet: undefined,
      current: false,
    });
    assert.equal(rows[1].kind, 'empty');
    assert.equal(rows[2].kind, 'filled');
    assert.equal(rows[2].number, 3);
    assert.deepEqual(
      rows.map((row) => row.kind),
      ['filled', 'empty', 'filled', 'empty', 'empty', 'empty', 'empty', 'empty', 'empty', 'empty'],
    );
  });

  test('a row at the save target is current; others are not', () => {
    const list = [bookmark(1, john3, 'John 3'), bookmark(4, john316, 'John 3:16')];
    const atChapter = bookmarkRows(list, john3);
    assert.equal(atChapter[1].kind === 'filled' && atChapter[1].current, true);
    assert.equal(atChapter[4].kind === 'filled' && atChapter[4].current, false);
    const atVerse = bookmarkRows(list, john316);
    assert.equal(atVerse[1].kind === 'filled' && atVerse[1].current, false);
    assert.equal(atVerse[4].kind === 'filled' && atVerse[4].current, true);
  });

  test('an empty stored snippet is no snippet', () => {
    const [row] = bookmarkRows([bookmark(0, john3, 'John 3', '')], john3);
    assert.equal(row.kind === 'filled' && row.snippet, undefined);
  });

  test('a slot outside 0–9 has no row', () => {
    const rows = bookmarkRows([bookmark(10, john3, 'John 3')], john3);
    assert.equal(rows.length, 10);
    assert.ok(rows.every((row) => row.kind === 'empty'));
  });

  test('all full only when every one of the 10 is filled', () => {
    const nine = Array.from({ length: 9 }, (_, slot) => bookmark(slot, { book: 1, chapter: slot + 1 }, `Genesis ${slot + 1}`));
    assert.equal(allSlotsFull(bookmarkRows(nine, john3)), false);
    const ten = [...nine, bookmark(9, { book: 1, chapter: 10 }, 'Genesis 10')];
    assert.equal(allSlotsFull(bookmarkRows(ten, john3)), true);
  });
});

describe('the header', () => {
  test('says what an empty slot saves', () => {
    assert.equal(saveLine('John 3', false), 'Save John 3');
    assert.equal(saveLine('John 3:16', false), 'Save John 3:16');
  });

  test('with all 10 in use, says one has to be replaced', () => {
    assert.equal(saveLine('John 3:16', true), 'All 10 slots are in use. Replace one to save John 3:16.');
  });
});

describe('the toolbar button (spec §3.2, §6)', () => {
  test('outline with no value when the target is in no slot', () => {
    assert.deepEqual(toolbarBookmark(bookmarkRows([bookmark(0, john316, 'John 3:16')], john3), 'John 3'), {
      filled: false,
      value: undefined,
    });
  });

  test('filled, saying the slot, when the chapter is saved', () => {
    assert.deepEqual(toolbarBookmark(bookmarkRows([bookmark(1, john3, 'John 3')], john3), 'John 3'), {
      filled: true,
      value: 'John 3 is in slot 2',
    });
  });

  test('filled for the selected verse with the pane open', () => {
    const rows = bookmarkRows([bookmark(1, john3, 'John 3'), bookmark(6, john316, 'John 3:16')], john316);
    assert.deepEqual(toolbarBookmark(rows, 'John 3:16'), { filled: true, value: 'John 3:16 is in slot 7' });
  });

  test('a place saved in more than one slot lists them', () => {
    const two = bookmarkRows([bookmark(1, john3, 'John 3'), bookmark(4, john3, 'John 3')], john3);
    assert.equal(toolbarBookmark(two, 'John 3').value, 'John 3 is in slots 2 and 5');
    const three = bookmarkRows([bookmark(1, john3, 'John 3'), bookmark(4, john3, 'John 3'), bookmark(9, john3, 'John 3')], john3);
    assert.equal(toolbarBookmark(three, 'John 3').value, 'John 3 is in slots 2, 5 and 10');
  });
});

describe('screen readers (spec §6)', () => {
  const [filled] = bookmarkRows([bookmark(2, john316, 'John 3:16', 'For God loved the world so much…')], john3).slice(2);
  const [empty] = bookmarkRows([], john3).slice(3);

  test('a filled slot is one element: slot, reference, snippet', () => {
    assert.equal(rowLabel(filled), 'Slot 3, John 3:16, For God loved the world so much…');
    assert.equal(rowAction(filled, 'John 3'), 'Jump to John 3:16');
  });

  test('a filled slot without a snippet', () => {
    const [row] = bookmarkRows([bookmark(0, john3, 'John 3')], john316);
    assert.equal(rowLabel(row), 'Slot 1, John 3');
  });

  test('the current place says so, as its glyph shows it', () => {
    const [row] = bookmarkRows([bookmark(0, john316, 'John 3:16', 'For God')], john316);
    assert.equal(rowLabel(row), 'Slot 1, John 3:16, For God, current place');
  });

  test('an empty slot, and its default action', () => {
    assert.equal(rowLabel(empty), 'Slot 4, empty');
    assert.equal(rowAction(empty, 'John 3:16'), 'Save John 3:16 here');
  });

  test('announcements', () => {
    assert.equal(savedAnnouncement(4), 'Saved to slot 4');
    assert.equal(jumpAnnouncement(3, 'John 3:16'), 'Bookmark 3, John 3:16');
  });
});

describe('the snippet', () => {
  test('a short line is kept as it is, whitespace folded', () => {
    assert.equal(bookmarkSnippet('  In the beginning\n God created  '), 'In the beginning God created');
  });

  test('no text, no snippet', () => {
    assert.equal(bookmarkSnippet(''), undefined);
    assert.equal(bookmarkSnippet(' \n '), undefined);
  });

  test('exactly the limit is kept whole', () => {
    const text = 'a'.repeat(SNIPPET_MAX);
    assert.equal(bookmarkSnippet(text), text);
  });

  test('a long verse is cut at a word boundary, punctuation dropped, with an ellipsis', () => {
    const verse =
      'For God loved the world so much that he gave his only-begotten Son, so that everyone exercising faith in him might not be destroyed but have everlasting life.';
    const snippet = bookmarkSnippet(verse);
    assert.equal(snippet, 'For God loved the world so much that he gave his only-begotten Son, so that everyone exercising…');
    assert.ok(snippet !== undefined && snippet.length <= SNIPPET_MAX + 1);
  });

  test('trailing punctuation before the cut goes', () => {
    assert.equal(bookmarkSnippet('one two, three four', 9), 'one two…');
  });

  test('a word longer than half the limit is cut mid-word', () => {
    assert.equal(bookmarkSnippet(`ab ${'c'.repeat(20)}`, 10), `ab ${'c'.repeat(7)}…`);
  });
});

describe('jumping (spec §3.3)', () => {
  test('a verse bookmark lands its verse, in another chapter', () => {
    assert.deepEqual(bookmarkJump({ pubKey, ...john316 }, { book: 1, chapter: 1 }), {
      book: 43,
      chapter: 3,
      verse: 16,
      sameChapter: false,
    });
  });

  test('or in this one', () => {
    assert.deepEqual(bookmarkJump({ pubKey, ...john316 }, john3), { book: 43, chapter: 3, verse: 16, sameChapter: true });
  });

  test('a chapter bookmark lands the chapter, with no verse', () => {
    assert.deepEqual(bookmarkJump({ pubKey, ...john3 }, john3), { book: 43, chapter: 3, verse: undefined, sameChapter: true });
  });

  test('a location without a book and chapter goes nowhere', () => {
    assert.equal(bookmarkJump({ pubKey, docId: 1n }, john3), undefined);
    assert.equal(bookmarkJump({ pubKey, book: 43 }, john3), undefined);
  });
});

describe('where the picker opens (spec §4)', () => {
  test('Material: an M3 modal bottom sheet, full width on phones', () => {
    assert.deepEqual(bookmarkPickerPlacement('material', 'compact'), { form: 'bottomSheet', maxWidth: undefined });
  });

  test('Material from 600dp: the same sheet, capped at 640 and centered', () => {
    assert.deepEqual(bookmarkPickerPlacement('material', 'medium'), { form: 'bottomSheet', maxWidth: BOOKMARK_SHEET_MAX_WIDTH });
    assert.deepEqual(bookmarkPickerPlacement('material', 'expanded'), { form: 'bottomSheet', maxWidth: 640 });
  });

  test('iOS look phone: the medium-detent sheet', () => {
    assert.deepEqual(bookmarkPickerPlacement('ios', 'compact'), { form: 'sheet' });
  });

  test('iOS look from 600dp: the anchored card, 360 at most', () => {
    assert.deepEqual(bookmarkPickerPlacement('ios', 'medium'), { form: 'popover', maxWidth: BOOKMARK_POPOVER_WIDTH });
    assert.deepEqual(bookmarkPickerPlacement('ios', 'expanded'), { form: 'popover', maxWidth: 360 });
  });
});

describe('where a slot’s ⋯ / ⋮ opens Replace and Delete', () => {
  test('a tablet is 600dp and wider', () => {
    assert.equal(TABLET_MIN_WIDTH, 600);
  });

  test('iOS look: the action sheet on a phone, a card at the ⋯ on a tablet', () => {
    assert.equal(rowMenuPresentation('ios', 390), 'sheet');
    assert.equal(rowMenuPresentation('ios', 599), 'sheet');
    assert.equal(rowMenuPresentation('ios', 600), 'anchored');
    assert.equal(rowMenuPresentation('ios', 1024), 'anchored');
  });

  test('Material: the M3 menu at the ⋮, phone and tablet', () => {
    assert.equal(rowMenuPresentation('material', 390), 'anchored');
    assert.equal(rowMenuPresentation('material', 599), 'anchored');
    assert.equal(rowMenuPresentation('material', 600), 'anchored');
  });
});

describe('sheet heights', () => {
  test('Material: one height, the M3 top margin clear below the status bar', () => {
    assert.deepEqual(bookmarkSheetHeights('bottomSheet', { windowHeight: 900, topInset: 24 }), {
      height: 900 - 24 - MATERIAL_SHEET_TOP_MARGIN,
      restHeight: undefined,
    });
  });

  test('iOS look: opens at half the window, drags up to the large detent', () => {
    assert.deepEqual(bookmarkSheetHeights('sheet', { windowHeight: 844, topInset: 47 }), {
      height: 844 - 47 - IOS_LARGE_DETENT_GAP,
      restHeight: 422,
    });
  });

  test('the medium detent is never taller than the large one', () => {
    const { height, restHeight } = bookmarkSheetHeights('sheet', { windowHeight: 300, topInset: 200 });
    assert.equal(restHeight, height);
  });
});

describe('the detent the iOS-look sheet opens at', () => {
  // A 1080x2400 phone at 420dpi: 914dp tall, so a 457dp medium detent; a 24dp gesture bar.
  const phone = { mediumHeight: 457, bottomInset: 24 };

  test('at default text, the header and five rows fit: medium', () => {
    assert.equal(bookmarkSheetOpensAt({ ...phone, headerHeight: 120, rowHeights: Array(10).fill(61) }), 'medium');
  });

  test('at 2x text, a wrapped title leaves room for one row: large', () => {
    assert.equal(bookmarkSheetOpensAt({ ...phone, headerHeight: 330, rowHeights: Array(10).fill(98) }), 'large');
  });

  test(`exactly ${MEDIUM_DETENT_MIN_ROWS} whole rows above the bottom inset still opens medium`, () => {
    assert.equal(MEDIUM_DETENT_MIN_ROWS, 3);
    assert.equal(bookmarkSheetOpensAt({ ...phone, headerHeight: 133, rowHeights: [100, 100, 100, 100] }), 'medium');
    assert.equal(bookmarkSheetOpensAt({ ...phone, headerHeight: 134, rowHeights: [100, 100, 100, 100] }), 'large');
  });

  test('only the first three rows count, whatever follows', () => {
    assert.equal(bookmarkSheetOpensAt({ ...phone, headerHeight: 133, rowHeights: [100, 100, 100, 900] }), 'medium');
    assert.equal(bookmarkSheetOpensAt({ ...phone, headerHeight: 133, rowHeights: [100, 100, 101] }), 'large');
  });

  test('the bottom inset is not room for rows', () => {
    assert.equal(bookmarkSheetOpensAt({ mediumHeight: 457, bottomInset: 0, headerHeight: 150, rowHeights: [100, 100, 100] }), 'medium');
    assert.equal(bookmarkSheetOpensAt({ mediumHeight: 457, bottomInset: 48, headerHeight: 150, rowHeights: [100, 100, 100] }), 'large');
  });

  test('with no rows (the list could not be read), only the header must fit', () => {
    assert.equal(bookmarkSheetOpensAt({ ...phone, headerHeight: 300, rowHeights: [] }), 'medium');
    assert.equal(bookmarkSheetOpensAt({ ...phone, headerHeight: 440, rowHeights: [] }), 'large');
  });
});

describe('the Material sheet fits its content', () => {
  // A 411x914dp phone with a 24dp status bar: the sheet's max height.
  const maxHeight = 914 - 24 - MATERIAL_SHEET_TOP_MARGIN;

  test('content shorter than the max: as tall as the content, not scrolling', () => {
    assert.deepEqual(bookmarkSheetFit({ contentHeight: 600, maxHeight }), { height: 600, scrolls: false });
  });

  test('content taller than the max: the max height, scrolling', () => {
    assert.deepEqual(bookmarkSheetFit({ contentHeight: 1400, maxHeight }), { height: maxHeight, scrolls: true });
  });

  test('content exactly the max fits without scrolling', () => {
    assert.deepEqual(bookmarkSheetFit({ contentHeight: maxHeight, maxHeight }), { height: maxHeight, scrolls: false });
  });

  test('a fractional layout rounds up, so nothing is clipped', () => {
    assert.deepEqual(bookmarkSheetFit({ contentHeight: 600.4, maxHeight }), { height: 601, scrolls: false });
    assert.deepEqual(bookmarkSheetFit({ contentHeight: maxHeight + 0.4, maxHeight }), { height: maxHeight, scrolls: true });
  });
});

describe('managing a filled slot (spec §3.2, §6)', () => {
  const [filled] = bookmarkRows([bookmark(2, john316, 'John 3:16', 'For God')], john3).slice(2);

  test('its actions: Replace with the save target, and Delete', () => {
    assert.equal(replaceLabel('John 3'), 'Replace with John 3');
    assert.equal(replaceLabel('John 3:16'), 'Replace with John 3:16');
    assert.equal(DELETE_LABEL, 'Delete');
    assert.ok(filled.kind === 'filled');
    if (filled.kind === 'filled') assert.equal(rowMenuLabel(filled), 'More actions for slot 3');
  });

  test('a Replace, Delete or Undo changes the content key, so the row cross-fades', () => {
    const [empty] = bookmarkRows([], john3);
    const [genesis] = bookmarkRows([bookmark(0, { book: 1, chapter: 1 }, 'Genesis 1')], john3);
    const [john] = bookmarkRows([bookmark(0, john316, 'John 3:16', 'For God')], john3);
    const keys = new Set([rowContentKey(empty), rowContentKey(genesis), rowContentKey(john)]);
    assert.equal(keys.size, 3);
    const [again] = bookmarkRows([bookmark(0, john316, 'John 3:16', 'For God')], john316);
    assert.equal(rowContentKey(again), rowContentKey(john));
  });

  test('the iOS-look swipe: a short Replace inner, the red Delete on the outer edge', () => {
    const calls: string[] = [];
    const actions = bookmarkSwipeActions(
      () => calls.push('replace'),
      () => calls.push('delete'),
    );
    assert.deepEqual(
      actions.map(({ key, label }) => ({ key, label })),
      [
        { key: 'replace', label: 'Replace' },
        { key: 'delete', label: DELETE_LABEL },
      ],
    );
    // Rendered in order from the row's edge outward: the last is trailing-most.
    assert.equal(actions.at(-1)?.key, 'delete');
    assert.equal('destructive' in actions[0], false);
    assert.equal(actions[1].destructive, true);
    actions[0].onPress();
    actions[1].onPress();
    assert.deepEqual(calls, ['replace', 'delete']);
  });

  test('a location key is the same for the same place only', () => {
    assert.equal(locationKey({ pubKey, ...john316 }), locationKey({ pubKey, ...john316 }));
    assert.notEqual(locationKey({ pubKey, ...john316 }), locationKey({ pubKey, ...john3 }));
    assert.notEqual(locationKey({ pubKey, book: 1, chapter: 11 }), locationKey({ pubKey, book: 11, chapter: 1 }));
  });
});

describe('a place not found in this edition (spec §7)', () => {
  test('found exactly: not missing, opening the saved place', () => {
    assert.deepEqual(slotPlace({ ok: true, value: { location: { pubKey, ...john316 }, exact: true } }), {
      missing: false,
      opens: john316,
    });
    assert.deepEqual(slotPlace({ ok: true, value: { location: { pubKey, ...john3 }, exact: true } }), {
      missing: false,
      opens: john3,
    });
  });

  test('a verse that is gone: missing, opening the nearest verse the core found', () => {
    assert.deepEqual(slotPlace({ ok: true, value: { location: { pubKey, book: 43, chapter: 3, verse: 15 }, exact: false } }), {
      missing: true,
      opens: { book: 43, chapter: 3, verse: 15 },
    });
  });

  test('a chapter that is gone: missing, opening the chapter the core fell back to', () => {
    assert.deepEqual(slotPlace({ ok: true, value: { location: { pubKey, book: 43, chapter: 1 }, exact: false } }), {
      missing: true,
      opens: { book: 43, chapter: 1 },
    });
  });

  test('a book that is gone (the publication alone): missing, opening the start', () => {
    assert.deepEqual(slotPlace({ ok: true, value: { location: { pubKey }, exact: false } }), { missing: true, opens: 'start' });
  });

  test('locate threw: missing, opening the start', () => {
    assert.deepEqual(slotPlace({ ok: false }), { missing: true, opens: 'start' });
  });

  test('the start is the first book’s first chapter, in the core’s order', () => {
    assert.deepEqual(startPlace([{ book: 40 }, { book: 41 }]), { book: 40, chapter: 1 });
    assert.equal(startPlace([]), undefined);
    assert.equal(startPlace(undefined), undefined);
  });

  test('the row says so, in its label too; the toast names where it opened', () => {
    assert.equal(NOT_FOUND_NOTE, 'Not found in this edition');
    const [row] = bookmarkRows([bookmark(0, john316, 'John 3:16', 'For God')], john3);
    assert.equal(rowLabel(row, true), 'Slot 1, John 3:16, For God, not found in this edition');
    assert.equal(rowLabel(row, false), 'Slot 1, John 3:16, For God');
    const [empty] = bookmarkRows([], john3);
    assert.equal(rowLabel(empty, true), 'Slot 1, empty');
    assert.equal(notFoundMessage('John 3'), "Couldn't find the exact place. Opened John 3.");
  });
});

describe('the hardware keyboard (spec §4)', () => {
  const tags = [11, 12, 13, undefined, 15];

  test('↑/↓ go to the slot above and below', () => {
    assert.deepEqual(rowFocusNeighbours(1, tags), { up: 11, down: 13 });
  });

  test('the first and last rows leave the outer edge to Android', () => {
    assert.deepEqual(rowFocusNeighbours(0, tags), { up: undefined, down: 12 });
    assert.deepEqual(rowFocusNeighbours(4, tags), { up: undefined, down: undefined });
  });

  test('a row not laid out yet has no tag to go to', () => {
    assert.deepEqual(rowFocusNeighbours(2, tags), { up: 12, down: undefined });
  });

  test('Ctrl+D opens the picker only in the focused reader with its chapter', () => {
    assert.equal(shortcutOpensBookmarks('d', { focused: true, chapterRead: true }), true);
    assert.equal(shortcutOpensBookmarks('d', { focused: false, chapterRead: true }), false);
    assert.equal(shortcutOpensBookmarks('d', { focused: true, chapterRead: false }), false);
    assert.equal(shortcutOpensBookmarks('k', { focused: true, chapterRead: true }), false);
  });
});

describe('the header when all 10 are full (spec §3.2)', () => {
  test('a full list says Replace one, naming what it would save', () => {
    const ten = Array.from({ length: 10 }, (_, slot) => bookmark(slot, { book: 1, chapter: slot + 1 }, `Genesis ${slot + 1}`));
    const rows = bookmarkRows(ten, john316);
    assert.equal(saveLine('John 3:16', allSlotsFull(rows)), 'All 10 slots are in use. Replace one to save John 3:16.');
    assert.equal(saveLine('John 3', allSlotsFull(bookmarkRows(ten.slice(0, 9), john3))), 'Save John 3');
  });
});

// A publication's documents (slice 3): document-level bookmarks, each
// periodical issue its own publication key.
const issue = 'w:0:20260800';
const nextIssue = 'w:0:20260900';
const article = 1102026201n;
const docBookmark = (key: string, slot: number, docId: bigint, title: string, paragraph?: number): BookmarkLike => ({
  slot,
  location: paragraph === undefined ? { pubKey: key, docId } : { pubKey: key, docId, paragraph },
  title,
});

describe('a publication bookmark’s save target (spec §3.1)', () => {
  test('the open document as a whole, titled as the document', () => {
    const target = documentSaveTarget(issue, article, 'Keep Your Love Alive');
    assert.deepEqual(target, { place: { pubKey: issue, docId: article }, reference: 'Keep Your Love Alive' });
  });

  test('stored as the publication key and document, no paragraph', () => {
    const { place } = documentSaveTarget(issue, article, 'Keep Your Love Alive');
    assert.deepEqual(bookmarkLocation(issue, place), { pubKey: issue, docId: article });
  });

  test('the header says “Save <document title>”, or that every slot is in use', () => {
    const { reference } = documentSaveTarget(issue, article, 'Keep Your Love Alive');
    assert.equal(saveLine(reference, false), 'Save Keep Your Love Alive');
    assert.equal(saveLine(reference, true), 'All 10 slots are in use. Replace one to save Keep Your Love Alive.');
  });

  test('the toolbar button’s value names the document', () => {
    const target = documentSaveTarget(issue, article, 'Keep Your Love Alive');
    const rows = bookmarkRows([docBookmark(issue, 1, article, 'Keep Your Love Alive')], target.place);
    assert.deepEqual(toolbarBookmark(rows, target.reference), {
      filled: true,
      value: 'Keep Your Love Alive is in slot 2',
    });
  });
});

describe('a publication bookmark’s place', () => {
  const here = { pubKey: issue, docId: article };

  test('the same document is the current place', () => {
    assert.equal(isAtPlace({ pubKey: issue, docId: article }, here), true);
  });

  test('another document, or a paragraph in this one (an import), is not', () => {
    assert.equal(isAtPlace({ pubKey: issue, docId: article + 1n }, here), false);
    assert.equal(isAtPlace({ pubKey: issue, docId: article, paragraph: 4 }, here), false);
  });
});

describe('each periodical issue is its own publication (spec §7)', () => {
  const here = { pubKey: issue, docId: article };

  test('the issue tag stays in the stored key', () => {
    assert.equal(bookmarkLocation(issue, here).pubKey, 'w:0:20260800');
    assert.equal(bookmarkLocation(nextIssue, { pubKey: nextIssue, docId: article }).pubKey, 'w:0:20260900');
  });

  test('the same document id in two issues is two places', () => {
    assert.notEqual(locationKey({ pubKey: issue, docId: article }), locationKey({ pubKey: nextIssue, docId: article }));
    assert.equal(isAtPlace({ pubKey: nextIssue, docId: article }, here), false);
  });

  test('another issue’s bookmark never marks this one’s current place', () => {
    const rows = bookmarkRows([docBookmark(nextIssue, 0, article, 'Keep Your Love Alive')], here);
    assert.equal(rows[0].kind === 'filled' && rows[0].current, false);
  });
});

describe('where a publication bookmark opens (spec §7)', () => {
  const located = (docId: bigint | undefined, exact: boolean) =>
    ({ ok: true, value: { location: docId === undefined ? { pubKey: issue } : { pubKey: issue, docId }, exact } }) as const;

  test('found exactly: its document, not missing', () => {
    assert.deepEqual(documentSlotPlace(located(article, true)), { missing: false, opens: { docId: article } });
  });

  test('gone from this edition: the document the core located instead (its start document), missing', () => {
    assert.deepEqual(documentSlotPlace(located(1102026202n, false)), { missing: true, opens: { docId: 1102026202n } });
  });

  test('a location the core gives no document for opens the contents, never a document picked here', () => {
    assert.deepEqual(documentSlotPlace(located(undefined, false)), { missing: true, opens: 'contents' });
    assert.deepEqual(documentSlotPlace(located(undefined, true)), { missing: false, opens: 'contents' });
  });

  test('locate threw: the contents, missing', () => {
    assert.deepEqual(documentSlotPlace({ ok: false }), { missing: true, opens: 'contents' });
  });

  test('the not-found toast names what opened', () => {
    assert.equal(notFoundMessage('Keep Your Love Alive'), "Couldn't find the exact place. Opened Keep Your Love Alive.");
  });
});

describe('a publication bookmark’s jump (spec §3.3: an article lands at its top, no marker)', () => {
  test('the open document: back to its top', () => {
    assert.deepEqual(documentJump({ docId: article }, article), { kind: 'top' });
  });

  test('another document: opens it', () => {
    assert.deepEqual(documentJump({ docId: 1102026202n }, article), { kind: 'document', docId: 1102026202n });
  });

  test('no document located (or locate threw): the contents', () => {
    assert.deepEqual(documentJump('contents', article), { kind: 'contents' });
    assert.deepEqual(documentJump(documentSlotPlace({ ok: false }).opens, article), { kind: 'contents' });
  });
});

describe('a publication bookmark’s snippet: the core’s text of its first body paragraph', () => {
  const t = (text: string) => ({ tag: 'Common' as const, inner: { inline: { tag: 'Text' as const, inner: { text } } } });
  const blocks: CoreDocBlock[] = [
    { tag: 'Heading', inner: { paragraph: 1, inlines: [t('Keep Your Love Alive')] } },
    { tag: 'Paragraph', inner: { paragraph: 3, number: '1', inlines: [t('inlines are not read')] } },
    { tag: 'Paragraph', inner: { paragraph: 2, inlines: [t('later')] } },
  ];
  const paragraphs = [
    { paragraph: 1, text: 'Keep Your Love Alive' },
    { paragraph: 2, text: 'Later.' },
    { paragraph: 3, text: 'WHAT   moves us to love Jehovah?' },
  ];

  test('in reading order, headings left out, as the core gives its text', () => {
    assert.equal(documentSnippet(blocks, paragraphs), 'WHAT moves us to love Jehovah?');
  });

  test('a paragraph inside an aside or a list counts', () => {
    const boxed: CoreDocBlock[] = [
      { tag: 'Aside', inner: { blocks: [{ tag: 'List', inner: { items: [{ blocks: [{ tag: 'Paragraph', inner: { paragraph: 2, inlines: [] } }] }] } }] } },
    ];
    assert.equal(documentSnippet(boxed, paragraphs), 'Later.');
  });

  test('an empty paragraph is passed over; with no text at all, none', () => {
    assert.equal(documentSnippet(blocks, [{ paragraph: 3, text: '' }, { paragraph: 2, text: 'Later.' }]), 'Later.');
    assert.equal(documentSnippet(blocks, []), undefined);
    assert.equal(documentSnippet([], paragraphs), undefined);
  });

  test('cut to a line, as any snippet', () => {
    const long = `${'word '.repeat(40)}end`;
    assert.equal(documentSnippet(blocks, [{ paragraph: 3, text: long }]), bookmarkSnippet(long));
  });
});

describe('the picker’s scrim (Lumen ruling 6 on #83)', () => {
  test('is no focus stop, for a hardware keyboard or a screen reader', () => {
    assert.equal(PICKER_SCRIM_FOCUS.accessible, false);
    assert.equal(PICKER_SCRIM_FOCUS.focusable, false);
    assert.equal(PICKER_SCRIM_FOCUS.importantForAccessibility, 'no-hide-descendants');
    assert.equal(PICKER_SCRIM_FOCUS.accessibilityElementsHidden, true);
  });
});

describe('the Ctrl+D shortcut in a publication', () => {
  test('opens in the focused reader once its document is read', () => {
    assert.equal(shortcutOpensBookmarks('d', { focused: true, chapterRead: true }), true);
    assert.equal(shortcutOpensBookmarks('d', { focused: false, chapterRead: true }), false);
  });
});
