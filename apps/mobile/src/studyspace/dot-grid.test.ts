import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { dotGridBackground } from './dot-grid.ts';

describe('dotGridBackground', () => {
  test('phone: 1 px dots every 14', () => {
    assert.deepEqual(dotGridBackground('#112233', 14, 1), {
      backgroundImage: 'radial-gradient(circle at center, #112233 0.5px, transparent 1px)',
      backgroundSize: '14px 14px',
      backgroundRepeat: 'repeat',
      backgroundPosition: '0px 0px',
    });
  });

  test('tablet: 1.2 px dots every 28', () => {
    assert.deepEqual(dotGridBackground('rgba(0, 0, 0, 0.2)', 28, 1.2), {
      backgroundImage: 'radial-gradient(circle at center, rgba(0, 0, 0, 0.2) 0.6px, transparent 1.1px)',
      backgroundSize: '28px 28px',
      backgroundRepeat: 'repeat',
      backgroundPosition: '0px 0px',
    });
  });
});
