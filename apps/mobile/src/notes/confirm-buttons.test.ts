import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { DEFAULT_CHOICE, resolvePalette } from '../design/appearance.ts';
import { contrast } from '../design/contrast.ts';
import { confirmButtons, dialogSurface, nameDialogInk } from './confirm-buttons.ts';
import { sheetItemInk, sheetSurface } from './sheet-colors.ts';
import { THEME_IDS, THEME_MODES } from '../design/theme-tokens.generated.ts';

// Paper, the default, in light and dark.
const paper = {
  light: resolvePalette(DEFAULT_CHOICE, 'light'),
  dark: resolvePalette(DEFAULT_CHOICE, 'dark'),
};

describe('confirmButtons', () => {
  for (const mode of ['light', 'dark'] as const) {
    const { colors, m3 } = paper[mode];

    test(`Material ${mode}: Cancel in primary, then Delete in error`, () => {
      assert.deepEqual(confirmButtons('material', 'Delete', colors, m3), [
        { role: 'cancel', label: 'Cancel', color: m3.primary, bold: false },
        { role: 'confirm', label: 'Delete', color: m3.error, bold: false },
      ]);
    });

    test(`iOS ${mode}: bold Cancel, then Delete in the destructive red`, () => {
      assert.deepEqual(confirmButtons('ios', 'Delete', colors, m3), [
        { role: 'cancel', label: 'Cancel', color: colors.accent, bold: true },
        { role: 'confirm', label: 'Delete', color: colors.destructive, bold: false },
      ]);
    });
  }

  test('labels are sentence case and the action is last in both looks', () => {
    for (const look of ['ios', 'material'] as const) {
      const buttons = confirmButtons(look, 'Delete', paper.light.colors, paper.light.m3);
      assert.equal(buttons.at(-1)?.role, 'confirm');
      for (const { label } of buttons) assert.match(label, /^[A-Z][^A-Z]*$/);
    }
  });

  test('error is the theme’s red, not the M3 baseline', () => {
    assert.equal(paper.light.m3.error, '#D70015');
    assert.equal(paper.dark.m3.error, '#FF453A');
  });
});

// Every theme in every set (light, dark and Increase Contrast), in both looks.
const palettes = THEME_IDS.flatMap((theme) =>
  THEME_MODES.map((mode) => ({ name: `${theme} ${mode}`, ...resolvePalette({ ...DEFAULT_CHOICE, theme }, mode) })),
);
const themes = (['ios', 'material'] as const).flatMap((look) =>
  palettes.map((p) => ({
    name: `${look === 'ios' ? 'iOS' : 'Material'} ${p.name}`,
    look,
    dark: p.scheme === 'dark',
    colors: p.colors,
    m3: p.m3,
  })),
);

describe('destructive labels read at 4.5:1 on their own surface', () => {
  for (const t of themes) {
    test(`${t.name}: the confirm dialog's Delete`, () => {
      const surface = dialogSurface(t.look, t.dark, t.colors, t.m3);
      const { color } = confirmButtons(t.look, 'Delete', t.colors, t.m3)[1];
      assert.ok(contrast(color, surface) >= 4.5, `${color} on ${surface}: ${contrast(color, surface).toFixed(2)}`);
    });

    test(`${t.name}: the name dialog's inline error`, () => {
      const surface = dialogSurface(t.look, t.dark, t.colors, t.m3);
      const { error } = nameDialogInk(t.look, true, t.colors, t.m3);
      assert.ok(contrast(error, surface) >= 4.5, `${error} on ${surface}: ${contrast(error, surface).toFixed(2)}`);
    });

    // Delete Workspace… and the Notes ⋮ menu's Delete: an anchored menu on
    // the Material look, a sheet otherwise.
    for (const menu of [true, false]) {
      test(`${t.name}: a destructive ${menu ? 'menu' : 'sheet'} item`, () => {
        const surface = sheetSurface(t.look, t.colors, t.m3);
        const ink = sheetItemInk(t.look, true, menu, t.colors, t.m3);
        assert.ok(contrast(ink, surface) >= 4.5, `${ink} on ${surface}: ${contrast(ink, surface).toFixed(2)}`);
      });
    }
  }

  // The iOS-look field is the paper on the raised paper (about 1:1); its
  // border is what shows where it is.
  for (const { name, scheme, colors, m3 } of palettes) {
    test(`iOS ${name}: the name dialog's field border reads at 3:1`, () => {
      const surface = dialogSurface('ios', scheme === 'dark', colors, m3);
      const { fieldBorder } = nameDialogInk('ios', false, colors, m3);
      assert.ok(
        contrast(fieldBorder, surface) >= 3,
        `${fieldBorder} on ${surface}: ${contrast(fieldBorder, surface).toFixed(2)}`,
      );
    });
  }

  test('nameDialogInk: iOS look bolds the confirm action; Material bolds neither', () => {
    assert.equal(nameDialogInk('ios', false, paper.light.colors, paper.light.m3).confirmBold, true);
    assert.equal(nameDialogInk('material', false, paper.light.colors, paper.light.m3).confirmBold, false);
  });

  test('nameDialogInk: Material field border is primary, error while refused', () => {
    assert.equal(nameDialogInk('material', false, paper.light.colors, paper.light.m3).fieldBorder, paper.light.m3.primary);
    assert.equal(nameDialogInk('material', true, paper.light.colors, paper.light.m3).fieldBorder, paper.light.colors.destructive);
  });

  test('the Material light dialog is the raised paper', () => {
    assert.equal(dialogSurface('material', false, paper.light.colors, paper.light.m3), '#FFFCF5');
    assert.equal(dialogSurface('material', true, paper.dark.colors, paper.dark.m3), paper.dark.m3.surfaceContainerHigh);
  });
});
