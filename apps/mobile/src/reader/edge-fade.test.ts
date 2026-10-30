import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { edgeFade } from './edge-fade.ts';

describe('edgeFade', () => {
  test('from the color to the same color at zero alpha, top to bottom', () => {
    assert.equal(edgeFade('#FBF7EC'), 'linear-gradient(to bottom, #FBF7EC, #FBF7EC00)');
    assert.equal(edgeFade('#15120E'), 'linear-gradient(to bottom, #15120E, #15120E00)');
  });

  test('never fades through transparent black', () => {
    assert.ok(!edgeFade('#F0E2C4').includes('transparent'));
  });
});
