import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { canvasMoved, enterFocus, leaveFocus, leftAnnouncement, readingAnnouncement } from './focus.ts';

const before = { x: 120, y: -40, zoom: 0.62 };

describe('reader card focus', () => {
  test('entering keeps the view before the focus zoom, not moved', () => {
    assert.deepEqual(enterFocus(7n, before), { id: 7n, preFocus: before, moved: false });
  });

  test('leaving without moving the canvas returns to the view before', () => {
    assert.deepEqual(leaveFocus(enterFocus(7n, before)), before);
  });

  test('leaving after a pan or zoom keeps the current view', () => {
    assert.equal(leaveFocus(canvasMoved(enterFocus(7n, before))), undefined);
  });

  test('a move is kept once marked, and the same state is returned', () => {
    const moved = canvasMoved(enterFocus(7n, before));
    assert.equal(canvasMoved(moved), moved);
    assert.equal(moved?.id, 7n);
    assert.deepEqual(moved?.preFocus, before);
  });

  test('nothing focused: a move changes nothing and leaving moves nothing', () => {
    assert.equal(canvasMoved(null), null);
    assert.equal(leaveFocus(null), undefined);
  });
});

describe('focus announcements', () => {
  test('reading, with the verse when there is one', () => {
    assert.equal(readingAnnouncement('Romans 8', 28), 'Reading Romans 8, verse 28');
    assert.equal(readingAnnouncement('Romans 8', 1), 'Reading Romans 8, verse 1');
  });

  test('reading a publication, without a verse', () => {
    assert.equal(readingAnnouncement('The Watchtower', undefined), 'Reading The Watchtower');
  });

  test('left', () => {
    assert.equal(leftAnnouncement('Romans 8'), 'Left Romans 8');
  });
});
