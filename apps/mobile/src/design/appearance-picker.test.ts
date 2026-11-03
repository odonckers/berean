import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  accentOptionLabel,
  appearanceOptionHint,
  appearanceOptionLabel,
  LOW_CONTRAST_NOTE,
  pickerLayout,
  SYSTEM_COLORS_NAME,
  systemColorsHint,
  THEME_HINT,
  themeOptionLabel,
  themeSwatch,
} from './appearance-picker.ts';
import { accentOptions } from './appearance.ts';

describe('spoken labels (themes spec §5)', () => {
  test('a theme tile: name, then role; the hint says what it does', () => {
    assert.equal(themeOptionLabel('paper'), 'Paper, theme');
    assert.equal(themeOptionLabel('sage'), 'Sage, theme');
    assert.equal(THEME_HINT, 'Changes the reading colors');
  });

  test('an accent: its tokens.json name, then role', () => {
    assert.equal(accentOptionLabel(accentOptions('paper', 'light')[0].name), 'Terracotta, accent');
  });

  test('System colors: "System colors, accent", "From your wallpaper", plus the low contrast note', () => {
    assert.equal(accentOptionLabel(SYSTEM_COLORS_NAME), 'System colors, accent');
    assert.equal(systemColorsHint(true), 'From your wallpaper');
    assert.equal(LOW_CONTRAST_NOTE, 'Not enough contrast with this theme');
    assert.equal(systemColorsHint(false), 'From your wallpaper. Not enough contrast with this theme');
  });

  test('an appearance; only Automatic has a hint', () => {
    assert.equal(appearanceOptionLabel('automatic'), 'Automatic, appearance');
    assert.equal(appearanceOptionLabel('dark'), 'Dark, appearance');
    assert.equal(appearanceOptionHint('automatic'), 'Follows the system light or dark setting');
    assert.equal(appearanceOptionHint('light'), undefined);
  });
});

describe('theme swatches', () => {
  test('Automatic splits the swatch: light page top-left, dark bottom-right', () => {
    assert.deepEqual(themeSwatch('paper', 'automatic', false), {
      first: { page: '#FBF7EC', ink: '#1F1A14' },
      second: { page: '#15120E', ink: '#EDE6D8' },
    });
  });

  test('Light or Dark shows that mode only', () => {
    assert.deepEqual(themeSwatch('paper', 'light', false), { first: { page: '#FBF7EC', ink: '#1F1A14' } });
    assert.deepEqual(themeSwatch('paper', 'dark', false), { first: { page: '#15120E', ink: '#EDE6D8' } });
  });

  test('Increase Contrast shows the IC sets', () => {
    const ic = themeSwatch('sepia', 'automatic', true);
    const standard = themeSwatch('sepia', 'automatic', false);
    assert.notDeepEqual(ic, standard);
    assert.ok(ic.second);
  });
});

describe('picker layout', () => {
  test('four tiles in a row on a phone at the default text size', () => {
    assert.equal(pickerLayout(343, 1), 'row');
  });

  test('a vertical list when large text would squeeze the tiles', () => {
    assert.equal(pickerLayout(343, 1.35), 'list');
    assert.equal(pickerLayout(343, 3), 'list');
  });

  test('a wide window keeps the row at large text', () => {
    assert.equal(pickerLayout(800, 2), 'row');
  });
});
