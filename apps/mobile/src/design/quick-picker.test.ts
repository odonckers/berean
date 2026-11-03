import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  dragCloses,
  MEDIUM_DETENT,
  quickPickerLayout,
  quickPickerPlacement,
  sheetHeight,
} from './quick-picker.ts';

describe('where the Aa picker opens (themes spec §4)', () => {
  test('phones: an M3 bottom sheet, or the iPhone sheet', () => {
    assert.equal(quickPickerPlacement('material', 'compact'), 'bottomSheet');
    assert.equal(quickPickerPlacement('ios', 'compact'), 'sheet');
  });

  test('wider windows: an M3 side sheet, or the iPad popover', () => {
    assert.equal(quickPickerPlacement('material', 'medium'), 'sideSheet');
    assert.equal(quickPickerPlacement('material', 'expanded'), 'sideSheet');
    assert.equal(quickPickerPlacement('ios', 'medium'), 'popover');
    assert.equal(quickPickerPlacement('ios', 'expanded'), 'popover');
  });
});

describe('the sheet at the text size (rule 12)', () => {
  test('default text: the medium detent with the rows', () => {
    assert.deepEqual(quickPickerLayout(379, 1), { layout: 'row', detent: 'medium', accentGrid: false });
  });

  test('large text: the large detent, lists, and accents in a grid of three', () => {
    assert.deepEqual(quickPickerLayout(379, 2), { layout: 'list', detent: 'large', accentGrid: true });
    assert.deepEqual(quickPickerLayout(361, 3.1), { layout: 'list', detent: 'large', accentGrid: true });
  });

  test("the switch is Settings › Appearance's own", () => {
    // Four 72-wide tiles and three gaps of 12 fit 379 up to a scale of about 1.19.
    assert.equal(quickPickerLayout(379, 1.15).detent, 'medium');
    assert.equal(quickPickerLayout(379, 1.25).detent, 'large');
  });
});

describe('sheet height', () => {
  const area = { areaHeight: 760, topInset: 0, lineHeight: 25.5 };

  test('medium is half the reader', () => {
    assert.equal(sheetHeight('medium', area), 760 * MEDIUM_DETENT);
  });

  test('large leaves one reader line, padded, above it', () => {
    assert.equal(sheetHeight('large', area), Math.round(760 - 25.5 - 16));
  });

  test('large also clears a status bar the reader draws under', () => {
    assert.equal(sheetHeight('large', { areaHeight: 800, topInset: 24, lineHeight: 80 }), 800 - 24 - 80 - 16);
  });

  test('large is never shorter than medium', () => {
    assert.equal(sheetHeight('large', { areaHeight: 300, topInset: 24, lineHeight: 200 }), 150);
  });
});

describe('drag to close', () => {
  test('a long drag or a fast flick down closes; a nudge or an upward drag does not', () => {
    assert.equal(dragCloses(120, 0), true);
    assert.equal(dragCloses(20, 1200), true);
    assert.equal(dragCloses(40, 200), false);
    assert.equal(dragCloses(-200, -1500), false);
  });
});
