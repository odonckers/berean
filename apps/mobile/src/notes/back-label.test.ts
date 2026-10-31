import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { backAccessibilityLabel, backTitle } from './back-label.ts';

describe('back label', () => {
  test('the previous screen’s title', () => {
    assert.equal(backTitle('All Notes'), 'All Notes');
    assert.equal(backAccessibilityLabel('Notes'), 'Back to Notes');
  });

  test('"Back" when the previous screen has no title', () => {
    assert.equal(backTitle(undefined), 'Back');
    assert.equal(backTitle('  '), 'Back');
    assert.equal(backAccessibilityLabel(''), 'Back to Back');
  });
});
