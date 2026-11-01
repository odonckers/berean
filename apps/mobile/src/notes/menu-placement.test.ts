import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { type MenuPlacementInput, menuPlacement } from './menu-placement.ts';

// A 400 × 800 phone, a 224-wide menu of 3 items.
const base: Omit<MenuPlacementInput, 'anchor' | 'edge'> = {
  menu: { width: 224, height: 160 },
  window: { width: 400, height: 800 },
  insets: { top: 24, bottom: 16 },
  margin: 8,
  rtl: false,
};

describe('menuPlacement', () => {
  test('a dropdown starts at its title, just below it', () => {
    const title = { x: 56, y: 24, width: 140, height: 48 };
    assert.deepEqual(menuPlacement({ ...base, anchor: title, edge: 'start' }), { top: 72, left: 56 });
  });

  test('a title stretched across the bar still opens at its start', () => {
    const bar = { x: 16, y: 24, width: 368, height: 64 };
    assert.equal(menuPlacement({ ...base, anchor: bar, edge: 'start' }).left, 16);
  });

  test('a start edge too near the window side moves in', () => {
    const late = { x: 300, y: 24, width: 80, height: 48 };
    assert.equal(menuPlacement({ ...base, anchor: late, edge: 'start' }).left, 400 - 224 - 8);
  });

  test('an overflow button lines up its trailing edge', () => {
    const more = { x: 340, y: 100, width: 48, height: 48 };
    assert.equal(menuPlacement({ ...base, anchor: more, edge: 'end' }).left, 400 - 224 - 12);
    const atEdge = { x: 352, y: 100, width: 48, height: 48 };
    assert.equal(menuPlacement({ ...base, anchor: atEdge, edge: 'end' }).left, 400 - 224 - 8);
  });

  test('right to left, the start edge is the right one', () => {
    const title = { x: 100, y: 24, width: 140, height: 48 };
    assert.equal(menuPlacement({ ...base, rtl: true, anchor: title, edge: 'start' }).left, 240 - 224);
    assert.equal(menuPlacement({ ...base, rtl: true, anchor: title, edge: 'end' }).left, 100);
  });

  test('above the anchor when there is no room below', () => {
    const low = { x: 56, y: 700, width: 48, height: 48 };
    assert.equal(menuPlacement({ ...base, anchor: low, edge: 'start' }).top, 700 - 160);
  });
});
