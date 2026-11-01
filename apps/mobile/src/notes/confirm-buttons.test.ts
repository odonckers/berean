import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { colorSets, m3Roles } from '../design/colors.ts';
import { confirmButtons } from './confirm-buttons.ts';

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
