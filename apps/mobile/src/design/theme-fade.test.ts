import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { resolvePalette } from './appearance.ts';
import { shouldCrossFade, THEME_FADE_MS } from './theme-fade.ts';

const page = (theme: 'paper' | 'sage', mode: 'light' | 'dark', accent: 1 | 3 = 1) =>
  resolvePalette({ theme, accent, appearance: 'automatic' }, mode).colors.surface;

describe('theme cross-fade (rule 12)', () => {
  test('200 ms', () => {
    assert.equal(THEME_FADE_MS, 200);
  });

  test('a new theme or appearance fades', () => {
    assert.equal(shouldCrossFade(page('paper', 'light'), page('sage', 'light'), false), true);
    assert.equal(shouldCrossFade(page('paper', 'light'), page('paper', 'dark'), false), true);
  });

  test('under Reduce Motion it swaps at once', () => {
    assert.equal(shouldCrossFade(page('paper', 'light'), page('sage', 'dark'), true), false);
  });

  test('an accent-only change keeps the page, so nothing fades', () => {
    assert.equal(shouldCrossFade(page('paper', 'light', 1), page('paper', 'light', 3), false), false);
  });

  test('the first palette, at launch, never fades', () => {
    assert.equal(shouldCrossFade(undefined, page('paper', 'light'), false), false);
  });
});
