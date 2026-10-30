import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { edgeFade } from './edge-fade.ts';

describe('edgeFade', () => {
  test('solid over the inset, then to the same color at zero alpha', () => {
    assert.equal(
      edgeFade('#FBF7EC', 24),
      'linear-gradient(to bottom, #FBF7EC 0px, #FBF7EC 24px, #FBF7EC00 100%)',
    );
    assert.equal(
      edgeFade('#15120E', 47),
      'linear-gradient(to bottom, #15120E 0px, #15120E 47px, #15120E00 100%)',
    );
  });

  test('never fades through transparent black', () => {
    assert.ok(!edgeFade('#F0E2C4', 24).includes('transparent'));
  });
});
