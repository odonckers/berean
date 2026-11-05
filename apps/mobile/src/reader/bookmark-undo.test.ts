import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  BOOKMARK_NOTICE_MS,
  BOOKMARK_UNDO_MS,
  type BookmarkChange,
  type HeldBookmark,
  barDuration,
  bookmarkBar,
  bookmarkUndoMessages,
  restoreArgs,
  restoredAnnouncement,
  BAR_HEIGHT_ESTIMATE,
  barContentInset,
} from './bookmark-undo.ts';

const pubKey = 'nwtsty_E';
const john316: HeldBookmark = {
  pubKey,
  slot: 2,
  location: { pubKey, book: 43, chapter: 3, verse: 16 },
  title: 'John 3:16',
  snippet: 'For God loved the world so much',
};
const deleted: BookmarkChange = { kind: 'delete', previous: john316 };
const replaced: BookmarkChange = { kind: 'replace', previous: john316, reference: 'Genesis 1' };

describe('the bookmark bar (spec §3.2, §7)', () => {
  test('a Delete or Replace offers its Undo', () => {
    assert.deepEqual(bookmarkBar(undefined, { kind: 'changed', change: deleted }), { id: 1, kind: 'undo', change: deleted });
    assert.deepEqual(bookmarkBar(undefined, { kind: 'changed', change: replaced }), { id: 1, kind: 'undo', change: replaced });
  });

  test('the newest replaces the last, as a new bar', () => {
    const first = bookmarkBar(undefined, { kind: 'changed', change: deleted });
    const second = bookmarkBar(first, { kind: 'changed', change: replaced });
    assert.deepEqual(second, { id: 2, kind: 'undo', change: replaced });
    const notice = bookmarkBar(second, { kind: 'notice', message: 'Opened John 3.' });
    assert.deepEqual(notice, { id: 3, kind: 'notice', message: 'Opened John 3.' });
  });

  test('Undo clears it; a notice has no Undo to clear', () => {
    const bar = bookmarkBar(undefined, { kind: 'changed', change: deleted });
    assert.equal(bookmarkBar(bar, { kind: 'undone' }), undefined);
    const notice = bookmarkBar(undefined, { kind: 'notice', message: 'x' });
    assert.equal(bookmarkBar(notice, { kind: 'undone' }), notice);
  });

  test('its own time running out clears it; an older bar’s does not', () => {
    const first = bookmarkBar(undefined, { kind: 'changed', change: deleted });
    const second = bookmarkBar(first, { kind: 'changed', change: replaced });
    assert.equal(bookmarkBar(second, { kind: 'expired', id: 1 }), second);
    assert.equal(bookmarkBar(second, { kind: 'expired', id: 2 }), undefined);
  });

  test('a save into the slot Undo would restore drops it; another slot keeps it', () => {
    const bar = bookmarkBar(undefined, { kind: 'changed', change: deleted });
    assert.equal(bookmarkBar(bar, { kind: 'saved', pubKey, slot: 2 }), undefined);
    assert.equal(bookmarkBar(bar, { kind: 'saved', pubKey, slot: 3 }), bar);
    assert.equal(bookmarkBar(bar, { kind: 'saved', pubKey: 'nwt_E', slot: 2 }), bar);
  });

  test('leaving the picker’s screen clears it (spec §7)', () => {
    assert.equal(bookmarkBar(bookmarkBar(undefined, { kind: 'changed', change: deleted }), { kind: 'left' }), undefined);
    assert.equal(bookmarkBar(undefined, { kind: 'left' }), undefined);
  });
});

describe('restoring', () => {
  test('writes back the held bookmark whole: slot, location, title and snippet', () => {
    assert.deepEqual(restoreArgs(john316), {
      pubKey,
      slot: 2,
      location: { pubKey, book: 43, chapter: 3, verse: 16 },
      title: 'John 3:16',
      snippet: 'For God loved the world so much',
    });
  });

  test('a bookmark without a snippet is restored without one', () => {
    const chapter: HeldBookmark = { pubKey, slot: 0, location: { pubKey, book: 1, chapter: 1 }, title: 'Genesis 1' };
    assert.equal(restoreArgs(chapter).snippet, undefined);
  });

  test('is announced', () => {
    assert.equal(restoredAnnouncement(john316), 'Restored slot 3, John 3:16');
  });
});

describe('the bar’s words and time', () => {
  test('Material names the kind; the iOS look names what went', () => {
    assert.deepEqual(bookmarkUndoMessages('material', deleted), {
      label: 'Bookmark deleted',
      announcement: 'Slot 3, John 3:16 deleted. Undo available.',
    });
    assert.deepEqual(bookmarkUndoMessages('ios', deleted).label, 'Deleted “John 3:16”');
    assert.deepEqual(bookmarkUndoMessages('material', replaced), {
      label: 'Bookmark replaced',
      announcement: 'Slot 3 replaced with Genesis 1. Undo available.',
    });
    assert.equal(bookmarkUndoMessages('ios', replaced).label, 'Replaced “John 3:16”');
  });

  test('Undo stays 6 s, a notice 4 s, both 16 s with a screen reader', () => {
    assert.equal(BOOKMARK_UNDO_MS, 6_000);
    assert.equal(barDuration({ id: 1, kind: 'undo', change: deleted }, false), 6_000);
    assert.equal(barDuration({ id: 1, kind: 'notice', message: 'x' }, false), BOOKMARK_NOTICE_MS);
    assert.equal(barDuration({ id: 1, kind: 'undo', change: deleted }, true), 16_000);
    assert.equal(barDuration({ id: 1, kind: 'notice', message: 'x' }, true), 16_000);
  });
});

describe('the reader’s bottom inset while a bar shows (Lumen, #83)', () => {
  test('none without a bar', () => {
    assert.equal(barContentInset(false, 52, 16), 0);
    assert.equal(barContentInset(false, undefined, 16), 0);
  });

  test('the bar’s laid-out height and the gap above it', () => {
    assert.equal(barContentInset(true, 52, 16), 68);
    // A two-line toast at large text pads for both lines.
    assert.equal(barContentInset(true, 96, 16), 112);
  });

  test('before it has laid out, one line’s height', () => {
    assert.equal(barContentInset(true, undefined, 16), BAR_HEIGHT_ESTIMATE + 16);
  });
});
