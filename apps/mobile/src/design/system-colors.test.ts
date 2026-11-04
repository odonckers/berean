import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { contrast } from './contrast.ts';
import {
  ANDROID_INCREASE_CONTRAST_AT,
  androidIncreaseContrast,
  SYSTEM_COLORS_FLOORS,
  systemAccentOption,
  type SystemColors,
  systemColorsPass,
} from './system-colors.ts';
import { themeTokens, THEME_IDS } from './theme-tokens.generated.ts';

// F04's made-up palette (spec §11), light, and an M3-shaped dark partner.
const LIGHT: SystemColors = {
  primary: '#3E6375',
  onPrimary: '#FFFFFF',
  primaryContainer: '#C2E8FF',
  onPrimaryContainer: '#001E2C',
  secondaryContainer: '#CFE6F1',
};
const DARK: SystemColors = {
  primary: '#A6CCE0',
  onPrimary: '#0B3445',
  primaryContainer: '#254B5C',
  onPrimaryContainer: '#C2E8FF',
  secondaryContainer: '#344A54',
};

describe('the System colors contrast guard (spec §11)', () => {
  test('the floors: 3:1 on the page (4.5 in IC), onPrimary 4.5:1 (7 in IC), onPrimaryContainer 4.5:1', () => {
    assert.deepEqual(SYSTEM_COLORS_FLOORS.primaryOnPage, { standard: 3, increased: 4.5 });
    assert.deepEqual(SYSTEM_COLORS_FLOORS.onPrimary, { standard: 4.5, increased: 7 });
    assert.deepEqual(SYSTEM_COLORS_FLOORS.onPrimaryContainer, { standard: 4.5, increased: 4.5 });
  });

  test("F04's palette passes on Paper light, and every theme's light and dark", () => {
    assert.ok(systemColorsPass('paper', 'light', LIGHT));
    for (const theme of THEME_IDS) {
      assert.ok(systemColorsPass(theme, 'light', LIGHT), `${theme} light`);
      assert.ok(systemColorsPass(theme, 'dark', DARK), `${theme} dark`);
    }
  });

  test('IC raises the floors: white on #3E6375 (6.4:1) passes standard, fails lightIC', () => {
    const ratio = contrast(LIGHT.onPrimary, LIGHT.primary);
    assert.ok(ratio >= 4.5 && ratio < 7, ratio.toFixed(2));
    assert.ok(systemColorsPass('paper', 'light', LIGHT));
    assert.equal(systemColorsPass('paper', 'lightIC', LIGHT), false);
    // A deeper primary clears 7:1 and 4.5:1 on the IC page.
    assert.ok(systemColorsPass('paper', 'lightIC', { ...LIGHT, primary: '#22495A' }));
  });

  test('IC page floor: a primary at 3–4.5:1 on the page passes standard, fails IC', () => {
    const primary = '#4F8299';
    const { roles } = themeTokens.paper.modes.lightIC;
    const onPage = contrast(primary, roles.background);
    assert.ok(onPage >= 3 && onPage < 4.5, onPage.toFixed(2));
    const palette = { ...LIGHT, primary, onPrimary: '#000000' };
    assert.ok(systemColorsPass('paper', 'light', palette));
    assert.equal(systemColorsPass('paper', 'lightIC', palette), false);
  });

  test('a pale primary fails on a light page', () => {
    assert.equal(systemColorsPass('paper', 'light', { ...LIGHT, primary: '#E8D8C8', onPrimary: '#000000' }), false);
  });

  test('a light palette fails on a dark page', () => {
    assert.equal(systemColorsPass('paper', 'dark', { ...LIGHT, primary: '#3E6375' }), false);
  });

  test('each pair is checked: onPrimary, onPrimaryContainer, the theme ink on secondaryContainer', () => {
    assert.equal(systemColorsPass('sage', 'light', { ...LIGHT, onPrimary: '#6A8D9E' }), false);
    assert.equal(systemColorsPass('sage', 'light', { ...LIGHT, onPrimaryContainer: '#8FB5CC' }), false);
    assert.equal(systemColorsPass('sage', 'light', { ...LIGHT, secondaryContainer: '#3A3A3A' }), false);
  });

  test('a malformed value fails rather than throws', () => {
    assert.equal(systemColorsPass('paper', 'light', { ...LIGHT, primary: 'rgba(0,0,0,1)' }), false);
    assert.equal(systemColorsPass('paper', 'light', { ...LIGHT, secondaryContainer: '' }), false);
  });

  test('the option shows the system primary and whether it passes; none without a palette', () => {
    assert.deepEqual(systemAccentOption('paper', 'light', LIGHT), {
      swatch: '#3E6375',
      onSwatch: '#FFFFFF',
      contrastOk: true,
    });
    assert.equal(systemAccentOption('paper', 'lightIC', LIGHT)?.contrastOk, false);
    assert.equal(systemAccentOption('paper', 'light', null), null);
  });
});

describe('Android contrast as Increase Contrast (spec §12.1, open item 2)', () => {
  test("from Android 14's Medium (0.5) up", () => {
    assert.equal(ANDROID_INCREASE_CONTRAST_AT, 0.5);
    assert.equal(androidIncreaseContrast(0.5), true);
    assert.equal(androidIncreaseContrast(1), true);
  });

  test('standard and reduced contrast are off', () => {
    for (const level of [0, 0.25, 0.49, -0.5, -1]) assert.equal(androidIncreaseContrast(level), false, String(level));
  });

  test('High contrast text below Android 14 is reported as 1, so it is on', () => {
    assert.equal(androidIncreaseContrast(1.0), true);
  });

  test('unknown is off', () => {
    for (const level of [null, undefined, NaN]) assert.equal(androidIncreaseContrast(level), false);
  });
});
