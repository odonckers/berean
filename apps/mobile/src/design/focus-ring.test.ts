import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { FOCUS_RING_OFFSET, FOCUS_RING_RADIUS, FOCUS_RING_WIDTH, focusRing } from './focus-ring.ts';

describe('focusRing', () => {
  test("is the scheme's accent, 2 dp, 8 dp corners, 2 dp outside the view", () => {
    assert.deepEqual(focusRing('#9B3F2A'), { color: '#9B3F2A', width: 2, radius: 8, offset: 2 });
    assert.deepEqual(focusRing('#E59A7C'), {
      color: '#E59A7C',
      width: FOCUS_RING_WIDTH,
      radius: FOCUS_RING_RADIUS,
      offset: FOCUS_RING_OFFSET,
    });
  });

  test('rejects colors Color.parseColor would not read the same way', () => {
    assert.throws(() => focusRing('#9B3'));
    assert.throws(() => focusRing('rgb(155, 63, 42)'));
    assert.throws(() => focusRing('#9B3F2A80'));
  });
});
