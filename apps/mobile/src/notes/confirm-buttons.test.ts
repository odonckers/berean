import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { colorSets, type ColorSetName, m3Roles } from '../design/colors.ts';
import { contrast } from '../design/contrast.ts';
import { confirmButtons, dialogSurface } from './confirm-buttons.ts';
import { sheetItemInk, sheetSurface } from './sheet-colors.ts';

describe('confirmButtons', () => {
  for (const mode of ['light', 'dark'] as const) {
    const colors = colorSets[mode];
    const m3 = m3Roles[mode];

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
      const buttons = confirmButtons(look, 'Delete', colorSets.light, m3Roles.light);
      assert.equal(buttons.at(-1)?.role, 'confirm');
      for (const { label } of buttons) assert.match(label, /^[A-Z][^A-Z]*$/);
    }
  });

  test('error is the theme’s red, not the M3 baseline', () => {
    assert.equal(m3Roles.light.error, '#D70015');
    assert.equal(m3Roles.dark.error, '#FF453A');
  });
});

// Every iOS-look colour set, and both Material modes.
const themes = [
  ...(Object.keys(colorSets) as ColorSetName[]).map((name) => ({
    name: `iOS ${name}`,
    look: 'ios' as const,
    dark: name === 'dark',
    colors: colorSets[name],
    m3: m3Roles[name === 'dark' ? 'dark' : 'light'],
  })),
  ...(['light', 'dark'] as const).map((mode) => ({
    name: `Material ${mode}`,
    look: 'material' as const,
    dark: mode === 'dark',
    colors: colorSets[mode],
    m3: m3Roles[mode],
  })),
];

describe('destructive labels read at 4.5:1 on their own surface', () => {
  for (const t of themes) {
    test(`${t.name}: the confirm dialog's Delete`, () => {
      const surface = dialogSurface(t.look, t.dark, t.colors, t.m3);
      const { color } = confirmButtons(t.look, 'Delete', t.colors, t.m3)[1];
      assert.ok(contrast(color, surface) >= 4.5, `${color} on ${surface}: ${contrast(color, surface).toFixed(2)}`);
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

  test('the Material light dialog is the raised paper', () => {
    assert.equal(dialogSurface('material', false, colorSets.light, m3Roles.light), '#FFFCF5');
    assert.equal(dialogSurface('material', true, colorSets.dark, m3Roles.dark), m3Roles.dark.surfaceContainerHigh);
  });
});
