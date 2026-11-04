import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  accentOptionLabel,
  appearanceOptionHint,
  APPEARANCE_TILE_PADDING,
  appearanceOptionLabel,
  AUTOMATIC_BOLD_WIDTH,
  LOW_CONTRAST_NOTE,
  pickerLayout,
  RING,
  SYSTEM_COLORS_NAME,
  systemColorsHint,
  THEME_HINT,
  themeOptionLabel,
  themeSwatch,
  TILE_GAP,
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
    assert.equal(pickerLayout(343, 1, 'ios'), 'row');
    assert.equal(pickerLayout(343, 1, 'material'), 'row');
  });

  test('a vertical list when large text would squeeze the tiles', () => {
    assert.equal(pickerLayout(343, 1.35, 'ios'), 'list');
    assert.equal(pickerLayout(343, 3, 'ios'), 'list');
    assert.equal(pickerLayout(343, 1.35, 'material'), 'list');
    assert.equal(pickerLayout(343, 3, 'material'), 'list');
  });

  test('a wide window keeps the row at large text', () => {
    assert.equal(pickerLayout(800, 2, 'ios'), 'row');
    assert.equal(pickerLayout(800, 2, 'material'), 'row');
  });

  test('the row needs each Appearance tile, less ring and padding, to hold bold "Automatic"', () => {
    const text = (width: number) => (width - 2 * TILE_GAP) / 3 - 2 * (RING + APPEARANCE_TILE_PADDING);
    // The iPad popover's 328: four theme tiles fit (324), but each
    // Appearance label gets about 79, short of SF Pro's bold 84.
    assert.ok(4 * 72 + 3 * TILE_GAP <= 328);
    assert.ok(text(328) < AUTOMATIC_BOLD_WIDTH.ios);
    assert.equal(pickerLayout(328, 1, 'ios'), 'list');
    // The M3 side sheet, also 328: Roboto's bold 76 fits.
    assert.ok(text(328) >= AUTOMATIC_BOLD_WIDTH.material);
    assert.equal(pickerLayout(328, 1, 'material'), 'row');
  });

  test('the Automatic width scales with the text', () => {
    // 379: the theme tiles fit to about 1.19, the bold Automatic label to about 1.15 (iOS).
    assert.equal(pickerLayout(379, 1.1, 'ios'), 'row');
    assert.equal(pickerLayout(379, 1.17, 'ios'), 'list');
    assert.equal(pickerLayout(379, 1.17, 'material'), 'row');
  });
});
