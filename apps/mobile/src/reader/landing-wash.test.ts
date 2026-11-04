import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { WASH_FADE_MS, WASH_HOLD_MS, WASH_TINT, landingWash, washFill, washStrength } from './landing-wash.ts';

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
