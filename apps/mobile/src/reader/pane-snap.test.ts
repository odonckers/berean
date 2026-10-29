import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DISMISS_VELOCITY,
  MAX_HEIGHT,
  MIN_HEIGHT,
  cappedDetents,
  dragFraction,
  openFraction,
  paneDetents,
  paneMaxFraction,
  releaseTarget,
} from './pane-snap.ts';

const windowHeight = 800;
const detents = paneDetents(1);
const largeDetents = paneDetents(2);

// A release at `to` after starting at `from`, both window fractions.
function release(from: number, to: number, velocityY = 0, d = detents) {
  return releaseTarget({
    start: from,
    translationY: (from - to) * windowHeight,
    velocityY,
    windowHeight,
    detents: d,
    min: MIN_HEIGHT,
    dismissVelocity: DISMISS_VELOCITY,
  });
}

describe('detents', () => {
  test('25/40/85, plus 60 at large text', () => {
    assert.deepEqual(paneDetents(1), [0.25, 0.4, 0.85]);
    assert.deepEqual(paneDetents(1.49), [0.25, 0.4, 0.85]);
    assert.deepEqual(paneDetents(1.5), [0.25, 0.4, 0.6, 0.85]);
    assert.equal(openFraction(1), 0.4);
    assert.equal(openFraction(1.5), 0.6);
  });
});

describe('releaseTarget', () => {
  test('snaps to the nearest of 25/40/85 in each region', () => {
    for (const [to, expected] of [
      [0.25, 0.25],
      [0.3, 0.25],
      [0.35, 0.4],
      [0.4, 0.4],
      [0.6, 0.4],
      [0.65, 0.85],
      [0.85, 0.85],
    ] as const) {
      assert.deepEqual(release(0.4, to), { kind: 'snap', fraction: expected }, `released at ${to}`);
    }
  });

  test('snaps to the nearest of 25/40/60/85 with large text', () => {
    for (const [to, expected] of [
      [0.3, 0.25],
      [0.45, 0.4],
      [0.55, 0.6],
      [0.7, 0.6],
      [0.75, 0.85],
    ] as const) {
      assert.deepEqual(
        release(0.6, to, 0, largeDetents),
        { kind: 'snap', fraction: expected },
        `released at ${to}`,
      );
    }
  });

  test('dragged up from 40% to about 80% snaps to 85%', () => {
    assert.deepEqual(release(0.4, 0.8), { kind: 'snap', fraction: 0.85 });
    // Past the top, the release still lands on the top detent.
    assert.deepEqual(release(0.4, 0.95), { kind: 'snap', fraction: 0.85 });
  });

  test('an upward fling never closes', () => {
    for (const velocityY of [-DISMISS_VELOCITY - 1, -5000, -100_000]) {
      assert.deepEqual(release(0.4, 0.45, velocityY), { kind: 'snap', fraction: 0.4 });
      assert.deepEqual(release(0.25, 0.3, velocityY), { kind: 'snap', fraction: 0.25 });
      assert.deepEqual(release(0.85, 0.85, velocityY), { kind: 'snap', fraction: 0.85 });
    }
  });

  test('a downward fling over the velocity closes', () => {
    assert.deepEqual(release(0.4, 0.38, DISMISS_VELOCITY + 1), { kind: 'close' });
    assert.deepEqual(release(0.85, 0.8, 3000), { kind: 'close' });
    // At the threshold, or a slow downward drag, it snaps instead.
    assert.deepEqual(release(0.4, 0.38, DISMISS_VELOCITY), { kind: 'snap', fraction: 0.4 });
    assert.deepEqual(release(0.4, 0.3, 200), { kind: 'snap', fraction: 0.25 });
  });

  test('release below 25% closes', () => {
    assert.deepEqual(release(0.4, 0.24), { kind: 'close' });
    assert.deepEqual(release(0.25, 0.1), { kind: 'close' });
    assert.deepEqual(release(0.25, 0.25), { kind: 'snap', fraction: 0.25 });
  });
});

describe('dragFraction', () => {
  const drag = (start: number, translationY: number) =>
    dragFraction({ start, translationY, windowHeight, min: MIN_HEIGHT, max: MAX_HEIGHT });

  test('follows the finger: up grows, down shrinks', () => {
    assert.ok(Math.abs(drag(0.4, -0.2 * windowHeight) - 0.6) < 1e-9);
    assert.ok(Math.abs(drag(0.4, 0.1 * windowHeight) - 0.3) < 1e-9);
  });

  test('clamps to [0.25, 0.85]', () => {
    assert.equal(drag(0.4, -windowHeight), MAX_HEIGHT);
    assert.equal(drag(0.4, windowHeight), MIN_HEIGHT);
    assert.equal(drag(0.85, -1), MAX_HEIGHT);
    assert.equal(drag(0.25, 1), MIN_HEIGHT);
  });

  test('stops at a lower cap', () => {
    const cap = 0.5;
    const capped = dragFraction({
      start: 0.4,
      translationY: -windowHeight,
      windowHeight,
      min: MIN_HEIGHT,
      max: cap,
    });
    assert.equal(capped, cap);
  });
});

describe('paneMaxFraction', () => {
  // A window of 800 with a 64 app bar, an 80 tab bar and a 24 status bar:
  // the chapter's visible area is 632 tall.
  const visibleHeight = 632;
  const cap = (paneTop: number, visible = visibleHeight) =>
    paneMaxFraction({ paneTop, visibleHeight: visible, windowHeight, min: MIN_HEIGHT, max: MAX_HEIGHT });

  test('from the pane top to the bottom of the visible area', () => {
    // A pane 20% down the visible area: room for 632 - 126.4 = 505.6.
    assert.ok(Math.abs(cap(126.4) - 505.6 / windowHeight) < 1e-9);
    assert.ok(cap(126.4) < MAX_HEIGHT);
    // Its bottom lands on the tab bar's top, never under it.
    assert.ok(Math.abs(126.4 + cap(126.4) * windowHeight - visibleHeight) < 1e-9);
  });

  test('never above 85%, however much room', () => {
    assert.equal(cap(0, 2000), MAX_HEIGHT);
    assert.equal(cap(-500), MAX_HEIGHT);
  });

  test('never below 25%: a pane low in the viewport keeps its minimum', () => {
    assert.equal(cap(600), MIN_HEIGHT);
    assert.equal(cap(visibleHeight + 100), MIN_HEIGHT);
  });

  test('unmeasured, it falls back to 85%', () => {
    assert.equal(cap(100, 0), MAX_HEIGHT);
    assert.equal(
      paneMaxFraction({ paneTop: 0, visibleHeight, windowHeight: 0, min: MIN_HEIGHT, max: MAX_HEIGHT }),
      MAX_HEIGHT,
    );
  });
});

describe('cappedDetents', () => {
  test('the detents under the cap, then the cap', () => {
    assert.deepEqual(cappedDetents(detents, 0.6), [0.25, 0.4, 0.6]);
    assert.deepEqual(cappedDetents(largeDetents, 0.7), [0.25, 0.4, 0.6, 0.7]);
  });

  test('a cap on a detent or above the top one', () => {
    assert.deepEqual(cappedDetents(detents, 0.4), [0.25, 0.4]);
    assert.deepEqual(cappedDetents(detents, MAX_HEIGHT), [0.25, 0.4, 0.85]);
    assert.deepEqual(cappedDetents(detents, MIN_HEIGHT), [0.25]);
  });

  test('a release past the cap settles at it', () => {
    const capped = cappedDetents(detents, 0.6);
    assert.deepEqual(release(0.4, 0.8, 0, capped), { kind: 'snap', fraction: 0.6 });
    assert.deepEqual(release(0.4, 0.45, 0, capped), { kind: 'snap', fraction: 0.4 });
  });
});
