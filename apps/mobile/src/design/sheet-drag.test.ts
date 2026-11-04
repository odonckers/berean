import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { dragCloses } from './quick-picker.ts';
import { EXPAND_DISTANCE, sheetDragEnd } from './sheet-drag.ts';

describe('a sheet with one height', () => {
  const sheet = { expandable: false, expanded: false };

  test('settles as the Aa sheet always has: closes or springs back', () => {
    for (const [y, v] of [[120, 0], [20, 1200], [40, 200], [-200, -1500]] as const) {
      assert.equal(sheetDragEnd(sheet, y, v), dragCloses(y, v) ? 'close' : 'stay');
    }
  });

  test('never expands', () => {
    assert.equal(sheetDragEnd(sheet, -400, -2000), 'stay');
  });
});

describe('a sheet at its medium detent (the iOS look)', () => {
  const medium = { expandable: true, expanded: false };

  test('a drag or flick up expands it to full height', () => {
    assert.equal(sheetDragEnd(medium, -(EXPAND_DISTANCE + 1), 0), 'expand');
    assert.equal(sheetDragEnd(medium, -10, -1200), 'expand');
  });

  test('a drag down dismisses it', () => {
    assert.equal(sheetDragEnd(medium, 120, 0), 'close');
    assert.equal(sheetDragEnd(medium, 20, 1200), 'close');
  });

  test('a nudge springs back', () => {
    assert.equal(sheetDragEnd(medium, -20, -100), 'stay');
    assert.equal(sheetDragEnd(medium, 40, 200), 'stay');
  });
});

describe('a sheet at full height', () => {
  const large = { expandable: true, expanded: true };

  test('a drag down goes back to the medium detent, not away', () => {
    assert.equal(sheetDragEnd(large, 120, 0), 'collapse');
    assert.equal(sheetDragEnd(large, 20, 1200), 'collapse');
  });

  test('a nudge or a drag up stays', () => {
    assert.equal(sheetDragEnd(large, 40, 200), 'stay');
    assert.equal(sheetDragEnd(large, -200, -1500), 'stay');
  });
});
