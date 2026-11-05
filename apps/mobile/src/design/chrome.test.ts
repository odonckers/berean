import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { DEFAULT_CHOICE, resolvePalette } from './appearance.ts';
import { cardEdge, glassFace, sideSheetEdge, solidChrome } from './chrome.ts';
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

  test('the M3 side sheet edge: an outlineVariant hairline; solid, a 1px outline', () => {
    const colors = { outline: '#8B8275' };
    const m3 = { outlineVariant: '#D3C4B4' };
    assert.deepEqual(sideSheetEdge(false, colors, m3, 0.5), { borderLeftWidth: 0.5, borderColor: '#D3C4B4' });
    assert.deepEqual(sideSheetEdge(true, colors, m3, 0.5), { borderLeftWidth: 1, borderColor: '#8B8275' });
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

describe('the edge of a card over the reader (Lumen, #80 and #83)', () => {
  const colors = { separator: '#38312A', outline: '#8B8275' };

  test('look × scheme × solid: IC’s outline anywhere; the iOS look’s dark hairline; else none', () => {
    for (const look of ['ios', 'material'] as const) {
      for (const dark of [false, true]) {
        // Increase Contrast (or Reduce Transparency) keeps the outline every sheet gets.
        assert.deepEqual(cardEdge({ look, dark, solid: true }, colors, 0.5), { borderColor: '#8B8275', borderWidth: 1 });
      }
    }
    assert.deepEqual(cardEdge({ look: 'ios', dark: true, solid: false }, colors, 0.5), { borderColor: '#38312A', borderWidth: 0.5 });
    assert.equal(cardEdge({ look: 'ios', dark: false, solid: false }, colors, 0.5), undefined);
    assert.equal(cardEdge({ look: 'material', dark: true, solid: false }, colors, 0.5), undefined);
    assert.equal(cardEdge({ look: 'material', dark: false, solid: false }, colors, 0.5), undefined);
  });

  test('the dark hairline is glassFace’s edge', () => {
    const face = glassFace(false, { ...colors, surfaceRaised: '#211D18' }, 0.5);
    assert.deepEqual(cardEdge({ look: 'ios', dark: true, solid: false }, colors, 0.5), {
      borderColor: face.borderColor,
      borderWidth: face.borderWidth,
    });
  });

  for (const theme of THEME_IDS) {
    test(`${theme} dark: the hairline stands further off the page than the card's own fill`, () => {
      const { colors: set } = resolvePalette({ ...DEFAULT_CHOICE, theme }, 'dark');
      const edge = cardEdge({ look: 'ios', dark: true, solid: false }, set, 0.5);
      assert.ok(edge !== undefined);
      assert.ok(contrast(edge.borderColor, set.surface) > contrast(set.surfaceRaised, set.surface));
    });
  }
});
