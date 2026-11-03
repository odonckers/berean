import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { DEFAULT_CHOICE, resolvePalette } from './appearance.ts';
import { glassFace, solidChrome } from './chrome.ts';
import { contrast } from './contrast.ts';
import { THEME_IDS, THEME_MODES } from './theme-tokens.generated.ts';

describe('glass vs solid chrome (themes spec rules 4 and 5)', () => {
  test('the iOS look is solid under Reduce Transparency or Increase Contrast', () => {
    const at = (reduceTransparency: boolean, increaseContrast: boolean) =>
      solidChrome({ look: 'ios', reduceTransparency, increaseContrast });
    assert.equal(at(false, false), false);
    assert.equal(at(true, false), true);
    assert.equal(at(false, true), true);
    assert.equal(at(true, true), true);
  });

  test('the material look is never translucent: Reduce Transparency changes nothing, IC still edges it', () => {
    const at = (reduceTransparency: boolean, increaseContrast: boolean) =>
      solidChrome({ look: 'material', reduceTransparency, increaseContrast });
    assert.equal(at(false, false), false);
    assert.equal(at(true, false), false);
    assert.equal(at(false, true), true);
  });

  test('glass is surfaceRaised with a hairline separator; solid is surfaceRaised with a 1px outline', () => {
    const colors = { surfaceRaised: '#FFFCF5', separator: '#E6DCC2', outline: '#8B8275' };
    assert.deepEqual(glassFace(false, colors, 0.5), { backgroundColor: '#FFFCF5', borderColor: '#E6DCC2', borderWidth: 0.5 });
    assert.deepEqual(glassFace(true, colors, 0.5), { backgroundColor: '#FFFCF5', borderColor: '#8B8275', borderWidth: 1 });
  });

  for (const theme of THEME_IDS) {
    for (const mode of THEME_MODES) {
      test(`${theme} ${mode}: the solid edge is a 3:1 boundary on the page and on surfaceRaised`, () => {
        const { colors } = resolvePalette({ ...DEFAULT_CHOICE, theme }, mode);
        const edge = glassFace(true, colors, 0.5).borderColor;
        assert.ok(contrast(edge, colors.surface) >= 3);
        assert.ok(contrast(edge, colors.surfaceRaised) >= 3);
      });
    }
  }
});
