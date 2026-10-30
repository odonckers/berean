import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { iconBox } from './icon-box.ts';

describe('iconBox', () => {
  test('is the size at the default font scale', () => {
    assert.deepEqual(iconBox(20, 1), { width: 20, height: 20 });
  });

  test('grows with the font scale, as the glyph does', () => {
    assert.deepEqual(iconBox(20, 1.5), { width: 30, height: 30 });
    assert.deepEqual(iconBox(17, 2), { width: 34, height: 34 });
  });
});
