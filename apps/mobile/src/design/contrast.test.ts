import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { contrast, luminance } from './contrast.ts';

describe('contrast', () => {
  test('black on white is 21:1, either way round', () => {
    assert.ok(Math.abs(contrast('#000', '#FFF') - 21) < 1e-9);
    assert.ok(Math.abs(contrast('#FFFFFF', '#000000') - 21) < 1e-9);
  });

  test('a colour on itself is 1:1', () => {
    assert.equal(contrast('#9B3F2A', '#9b3f2a'), 1);
  });

  test('matches known WCAG ratios', () => {
    // #767676 on white is the classic 4.54:1 grey.
    assert.ok(Math.abs(contrast('#767676', '#FFFFFF') - 4.54) < 0.01);
    assert.ok(Math.abs(luminance('#808080') - 0.2159) < 0.0001);
  });

  test('refuses what is not an opaque hex', () => {
    assert.throws(() => luminance('rgba(0,0,0,0.32)'));
  });
});
