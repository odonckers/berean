import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { DEFAULT_CHOICE, resolvePalette } from '../design/appearance.ts';
import { contrast } from '../design/contrast.ts';
import { THEME_IDS, THEME_MODES, type ThemeMode } from '../design/theme-tokens.generated.ts';
import {
  IC_TEXT_CONTRAST,
  IC_TINT_FLOOR,
  WASH_FADE_MS,
  WASH_HOLD_MS,
  WASH_TINT,
  contrastCappedTint,
  landingWash,
  searchArrivalWash,
  washAccent,
  washFill,
  washStrength,
  washTint,
} from './landing-wash.ts';

const land = (arrival: number, reducedMotion = false) =>
  ({ kind: 'land', chapterKey: 'a', verse: 16, arrival, reducedMotion }) as const;

describe('the landing wash (spec §3.3, §5)', () => {
  test('a jump to a verse washes it, fading', () => {
    assert.deepEqual(landingWash(undefined, land(1)), { chapterKey: 'a', verse: 16, arrival: 1, fades: true });
  });

  test('under Reduce Motion it is static', () => {
    assert.deepEqual(landingWash(undefined, land(1, true)), { chapterKey: 'a', verse: 16, arrival: 1, fades: false });
  });

  test('the next scroll or tap clears it, fading or static', () => {
    for (const reducedMotion of [false, true]) {
      const wash = landingWash(undefined, land(1, reducedMotion));
      assert.equal(landingWash(wash, { kind: 'scroll' }), undefined);
      assert.equal(landingWash(wash, { kind: 'tap' }), undefined);
    }
  });

  test('its fade ending clears it; a static wash never fades', () => {
    assert.equal(landingWash(landingWash(undefined, land(1)), { kind: 'faded', arrival: 1 }), undefined);
    const still = landingWash(undefined, land(1, true));
    assert.equal(landingWash(still, { kind: 'faded', arrival: 1 }), still);
  });

  test('an older arrival’s fade leaves a newer wash', () => {
    const newer = landingWash(landingWash(undefined, land(1)), land(2));
    assert.equal(landingWash(newer, { kind: 'faded', arrival: 1 }), newer);
  });

  test('another chapter clears it; its own keeps it', () => {
    const wash = landingWash(undefined, land(1));
    assert.equal(landingWash(wash, { kind: 'chapter', chapterKey: 'a' }), wash);
    assert.equal(landingWash(wash, { kind: 'chapter', chapterKey: 'b' }), undefined);
  });
});

describe('the wash’s strength over time', () => {
  test('full for 2 s, then fading to none', () => {
    assert.equal(WASH_HOLD_MS, 2_000);
    assert.equal(washStrength(0, true), 1);
    assert.equal(washStrength(WASH_HOLD_MS, true), 1);
    const mid = washStrength(WASH_HOLD_MS + WASH_FADE_MS / 2, true);
    assert.ok(mid > 0 && mid < 1);
    assert.equal(washStrength(WASH_HOLD_MS + WASH_FADE_MS, true), 0);
    assert.equal(washStrength(WASH_HOLD_MS + 10 * WASH_FADE_MS, true), 0);
  });

  test('it only ever lessens', () => {
    let last = 1;
    for (let ms = 0; ms <= WASH_HOLD_MS + WASH_FADE_MS; ms += 20) {
      const s = washStrength(ms, true);
      assert.ok(s <= last);
      last = s;
    }
  });

  test('a static wash stays full', () => {
    assert.equal(washStrength(60_000, false), 1);
  });
});

describe('the wash’s fill', () => {
  test('at full strength, the accent mixed into the base', () => {
    const fill = washFill('#FFFFFF', '#000000', 1);
    const channel = Math.round(255 * (1 - WASH_TINT));
    const hex = channel.toString(16).toUpperCase().padStart(2, '0');
    assert.equal(fill, `#${hex}${hex}${hex}`);
  });

  test('at none, the base itself', () => {
    assert.equal(washFill('#FFFCF5', '#9B3F2A', 0), '#FFFCF5');
  });

  test('over a highlight, the highlight is the base', () => {
    assert.notEqual(washFill('#FFE58A', '#9B3F2A', 1), washFill('#FFFCF5', '#9B3F2A', 1));
  });

  test('colours it can’t read leave the base', () => {
    assert.equal(washFill('transparent', '#9B3F2A', 1), 'transparent');
    assert.equal(washFill('#FFFCF5', 'rgb(1,2,3)', 1), '#FFFCF5');
  });
});

// Every set's wash: each theme, accent slot and look, over the page and
// each highlight, as the reader draws it (the verse text in textPrimary).
function washCases(modes: readonly ThemeMode[]) {
  const cases: { name: string; base: string; accent: string; text: string; highlight: boolean }[] = [];
  for (const theme of THEME_IDS) {
    for (const mode of modes) {
      for (const accent of [1, 2, 3, 4, 5, 6] as const) {
        const palette = resolvePalette({ ...DEFAULT_CHOICE, theme, accent }, mode);
        for (const look of ['ios', 'material'] as const) {
          const ink = washAccent(look, palette.colors, palette.m3);
          const bases = [['page', palette.colors.surface], ...Object.entries(palette.highlights)];
          for (const [where, base] of bases) {
            cases.push({
              name: `${theme} ${mode} slot ${accent} ${look} over ${where}`,
              base,
              accent: ink,
              text: palette.colors.text,
              highlight: where !== 'page',
            });
          }
        }
      }
    }
  }
  return cases;
}

describe('the wash under Increase Contrast', () => {
  const icModes = THEME_MODES.filter((mode) => mode === 'lightIC' || mode === 'darkIC');

  test('the cases cover both IC sets, every theme, slot, look, the page and every highlight', () => {
    assert.deepEqual(icModes, ['lightIC', 'darkIC']);
    assert.equal(washCases(icModes).length, 4 * 2 * 6 * 2 * 7);
  });

  test('the verse text keeps 7:1 on the washed fill, through the fade too', () => {
    for (const { name, base, accent, text } of washCases(icModes)) {
      const tint = washTint(base, accent, text, true);
      assert.ok(tint >= 0 && tint <= WASH_TINT, name);
      for (let step = 0; step <= 12; step++) {
        const ratio = contrast(text, washFill(base, accent, step / 12, tint));
        assert.ok(ratio >= IC_TEXT_CONTRAST, `${name} at ${step}/12: ${ratio.toFixed(2)}:1`);
      }
    }
  });

  // The cap alone (Lumen's ruling on #83 then floors it): washTint no longer
  // is the most tint that holds 7:1 where that is under IC_TINT_FLOOR.
  test('the cap is the most tint that holds 7:1', () => {
    for (const { name, base, accent, text } of washCases(icModes)) {
      const tint = contrastCappedTint(base, accent, text);
      if (tint >= WASH_TINT) continue;
      assert.ok(contrast(text, washFill(base, accent, 1, tint + 0.001)) < IC_TEXT_CONTRAST, name);
    }
  });

  test('Lumen’s measured cases lose the wash over the highlight', () => {
    // Light IC Sepia, orange highlight, accent #005748: 5.48:1 at the full tint.
    const sepia = resolvePalette({ ...DEFAULT_CHOICE, theme: 'sepia' }, 'lightIC');
    const sepiaTint = washTint(sepia.highlights.orange, '#005748', sepia.colors.text, true);
    assert.ok(contrast(sepia.colors.text, washFill(sepia.highlights.orange, '#005748', 1)) < IC_TEXT_CONTRAST);
    assert.ok(contrast(sepia.colors.text, washFill(sepia.highlights.orange, '#005748', 1, sepiaTint)) >= IC_TEXT_CONTRAST);
    // Dark IC Paper, green highlight, accent #9AD6A1: 5.06:1 at the full tint.
    const paper = resolvePalette({ ...DEFAULT_CHOICE, theme: 'paper' }, 'darkIC');
    const paperTint = washTint(paper.highlights.green, '#9AD6A1', paper.colors.text, true);
    assert.ok(contrast(paper.colors.text, washFill(paper.highlights.green, '#9AD6A1', 1)) < IC_TEXT_CONTRAST);
    assert.ok(contrast(paper.colors.text, washFill(paper.highlights.green, '#9AD6A1', 1, paperTint)) >= IC_TEXT_CONTRAST);
  });

  test('a base the text already fails, or colours it can’t read, get no tint', () => {
    assert.equal(washTint('#777777', '#000000', '#FFFFFF', true), 0);
    assert.equal(washTint('transparent', '#9B3F2A', '#000000', true), 0);
  });
});

describe('the IC wash floor (Lumen’s ruling on #83)', () => {
  const icModes = THEME_MODES.filter((mode) => mode === 'lightIC' || mode === 'darkIC');

  test('a capped tint under 5% is no wash; at or over it, the capped tint', () => {
    assert.equal(IC_TINT_FLOOR, 0.05);
    let floored = 0;
    let kept = 0;
    for (const { name, base, accent, text } of washCases(icModes)) {
      const capped = contrastCappedTint(base, accent, text);
      const tint = washTint(base, accent, text, true);
      if (capped < IC_TINT_FLOOR) {
        assert.equal(tint, 0, name);
        floored += 1;
      } else {
        assert.equal(tint, capped, name);
        kept += 1;
      }
    }
    // Both happen across the sets: the page keeps a wash, some highlights lose it.
    assert.ok(floored > 0 && kept > 0);
  });

  test('Lumen’s measured cases: the cap left 0.7% and 2%, so no wash over those highlights', () => {
    const sepia = resolvePalette({ ...DEFAULT_CHOICE, theme: 'sepia' }, 'lightIC');
    assert.equal(contrastCappedTint(sepia.highlights.orange, '#005748', sepia.colors.text), 0.007);
    assert.equal(washTint(sepia.highlights.orange, '#005748', sepia.colors.text, true), 0);
    const paper = resolvePalette({ ...DEFAULT_CHOICE, theme: 'paper' }, 'darkIC');
    assert.equal(contrastCappedTint(paper.highlights.green, '#9AD6A1', paper.colors.text), 0.02);
    assert.equal(washTint(paper.highlights.green, '#9AD6A1', paper.colors.text, true), 0);
    // With no tint the fill is the highlight itself.
    assert.equal(washFill(paper.highlights.green, '#9AD6A1', 1, 0), paper.highlights.green);
  });

  test('the page itself keeps the full wash under IC', () => {
    const sepia = resolvePalette({ ...DEFAULT_CHOICE, theme: 'sepia' }, 'lightIC');
    assert.equal(washTint(sepia.colors.surface, '#005748', sepia.colors.text, true), WASH_TINT);
  });

  test('without Increase Contrast there is no floor: the full tint', () => {
    assert.equal(washTint('#FFFCF5', '#9B3F2A', '#000000', false), WASH_TINT);
  });
});

describe('a search arrival’s wash (spec §3.3, “same as Search”)', () => {
  test('a search hit at a verse washes it, as a jump does', () => {
    const event = searchArrivalWash('a', 16, 1, false);
    assert.deepEqual(event, { kind: 'land', chapterKey: 'a', verse: 16, arrival: -1, reducedMotion: false });
    assert.deepEqual(landingWash(undefined, event!), { chapterKey: 'a', verse: 16, arrival: -1, fades: true });
  });

  test('under Reduce Motion it is static', () => {
    assert.equal(landingWash(undefined, searchArrivalWash('a', 16, 1, true)!)?.fades, false);
  });

  test('an arrival at a chapter, with no verse, washes nothing', () => {
    assert.equal(searchArrivalWash('a', undefined, 1, false), undefined);
  });

  test('each search arrival is its own, and never a bookmark jump’s', () => {
    const first = landingWash(undefined, searchArrivalWash('a', 16, 1, false)!);
    const second = landingWash(first, searchArrivalWash('a', 16, 2, false)!);
    assert.notEqual(first?.arrival, second?.arrival);
    // A jump's arrivals count up from 1; a search's down from -1.
    assert.equal(landingWash(second, { kind: 'faded', arrival: 2 }), second);
    assert.equal(landingWash(second, { kind: 'faded', arrival: -2 }), undefined);
  });
});

describe('the wash without Increase Contrast', () => {
  test('every light and dark set keeps the full tint', () => {
    for (const { name, base, accent, text } of washCases(['light', 'dark'])) {
      assert.equal(washTint(base, accent, text, false), WASH_TINT, name);
    }
  });

  test('the full tint is the default fill', () => {
    assert.equal(washFill('#FFFCF5', '#9B3F2A', 1), washFill('#FFFCF5', '#9B3F2A', 1, WASH_TINT));
  });
});
