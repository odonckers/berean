import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { TAB_LABEL_MAX_SCALE, tabLabelFontSize } from './tab-label.ts';

describe('tab label size under large text', () => {
  test('the base size up to the cap', () => {
    assert.equal(tabLabelFontSize(12, 1), 12);
    assert.equal(tabLabelFontSize(12, 0.85), 12);
    assert.equal(tabLabelFontSize(12, TAB_LABEL_MAX_SCALE), 12);
  });

  test('past the cap, the drawn size (fontSize × scale) stays at base × 1.3', () => {
    for (const scale of [1.5, 1.8, 2]) {
      const drawn = tabLabelFontSize(12, scale) * scale;
      assert.ok(Math.abs(drawn - 12 * TAB_LABEL_MAX_SCALE) < 0.02, `${scale}: ${drawn}`);
    }
  });

  test('at font 2.0 the 12sp M3 label draws at 15.6dp, not 24', () => {
    assert.equal(tabLabelFontSize(12, 2), 7.8);
  });

  test('a cap can be given', () => {
    assert.equal(tabLabelFontSize(10, 2, 1.5), 7.5);
  });
});
