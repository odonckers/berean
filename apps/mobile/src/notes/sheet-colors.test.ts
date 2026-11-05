import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ACCENT_SLOTS, DEFAULT_CHOICE, resolvePalette } from '../design/appearance.ts';
import { contrast } from '../design/contrast.ts';
import { THEME_IDS, THEME_MODES } from '../design/theme-tokens.generated.ts';
import { swipeActionColors } from './sheet-colors.ts';

// Every theme and accent slot in every set (light, dark and Increase Contrast).
const palettes = THEME_IDS.flatMap((theme) =>
  THEME_MODES.flatMap((mode) =>
    ACCENT_SLOTS.map((accent) => ({
      name: `${theme} ${mode} slot ${accent}`,
      ic: mode === 'lightIC' || mode === 'darkIC',
      ...resolvePalette({ ...DEFAULT_CHOICE, theme, accent }, mode),
    })),
  ),
);

describe('swipe action colors', () => {
  test('iOS look: a destructive action is the destructive red, not the accent', () => {
    for (const { name, colors, m3 } of palettes) {
      assert.equal(swipeActionColors('ios', true, colors, m3).fill, colors.destructive, name);
    }
  });

  test('iOS look: the red action’s label reads at 4.5:1, 7:1 under Increase Contrast', () => {
    for (const { name, ic, colors, m3 } of palettes) {
      const { fill, ink } = swipeActionColors('ios', true, colors, m3);
      const ratio = contrast(ink, fill);
      assert.ok(ratio >= (ic ? 7 : 4.5), `${name}: ${ink} on ${fill}: ${ratio.toFixed(2)}`);
    }
  });

  test('the other actions, and Material, are as before', () => {
    const { colors, m3 } = resolvePalette(DEFAULT_CHOICE, 'light');
    assert.deepEqual(swipeActionColors('ios', false, colors, m3), { fill: colors.textSecondary, ink: m3.onPrimary });
    assert.deepEqual(swipeActionColors('material', true, colors, m3), { fill: m3.primary, ink: m3.onPrimary });
    assert.deepEqual(swipeActionColors('material', false, colors, m3), {
      fill: m3.secondaryContainer,
      ink: m3.onSecondaryContainer,
    });
  });
});
