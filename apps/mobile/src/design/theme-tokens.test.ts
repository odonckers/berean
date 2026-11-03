import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { GENERATED_PATH, generateThemeTokens, TOKENS_PATH } from '../../scripts/gen-theme-tokens.ts';
import { HIGHLIGHT_KEYS, THEME_IDS, THEME_MODES, themeTokens } from './theme-tokens.generated.ts';

describe('theme-tokens.generated.ts', () => {
  test('matches tokens.json (run `npm run gen:theme-tokens` after changing it)', () => {
    const tokens = JSON.parse(readFileSync(TOKENS_PATH, 'utf8'));
    assert.equal(readFileSync(GENERATED_PATH, 'utf8'), generateThemeTokens(tokens));
  });

  test('four themes, four sets, highlights in the display order', () => {
    assert.deepEqual(THEME_IDS, ['paper', 'sepia', 'stone', 'sage']);
    assert.deepEqual(THEME_MODES, ['light', 'dark', 'lightIC', 'darkIC']);
    assert.deepEqual(HIGHLIGHT_KEYS, ['yellow', 'green', 'blue', 'pink', 'purple', 'orange']);
    assert.deepEqual(
      THEME_IDS.map((id) => themeTokens[id].name),
      ['Paper', 'Sepia', 'Stone', 'Sage'],
    );
  });

  test('every set has six accents and named highlights', () => {
    for (const id of THEME_IDS) {
      assert.equal(themeTokens[id].accents.length, 6);
      for (const mode of THEME_MODES) {
        const purple = themeTokens[id].modes[mode].highlights.purple;
        assert.equal(purple.name, 'Purple');
        assert.equal(purple.spokenName, 'Purple highlight');
        assert.match(purple.hex, /^#[0-9A-F]{6}$/);
      }
    }
  });

  test('refuses tokens missing a role', () => {
    const tokens = JSON.parse(readFileSync(TOKENS_PATH, 'utf8'));
    delete tokens.themes.sage.modes.darkIC.outline;
    assert.throws(() => generateThemeTokens(tokens), /themes\.sage\.modes\.darkIC\.outline/);
  });
});
