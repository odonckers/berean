import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  type Camera,
  type Rect,
  IOS_DECAY,
  canvasToScreen,
  cameraBetween,
  clampZoom,
  contentTransform,
  deviceClass,
  doubleTapTarget,
  fitAll,
  fitPadding,
  gestureRange,
  gridOffset,
  hitsFrame,
  inertia,
  inertiaProgress,
  layerBox,
  lerpZoom,
  nextZoomStep,
  projectedRest,
  restoreCamera,
  rubberBandOvershoot,
  rubberBandZoom,
  screenToCanvas,
  settleZoom,
  zoomAbout,
  zoomLimits,
  zoomSteps,
} from './camera.ts';

const near = (actual: number, expected: number, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

const phone = zoomLimits('phone');
const tablet = zoomLimits('tablet');
const view = { width: 390, height: 700 };

describe('device class and limits', () => {
  test('a phone is under 600 on its shortest side, in either orientation', () => {
    assert.equal(deviceClass({ width: 390, height: 844 }), 'phone');
    assert.equal(deviceClass({ width: 844, height: 390 }), 'phone');
    assert.equal(deviceClass({ width: 599, height: 900 }), 'phone');
    assert.equal(deviceClass({ width: 600, height: 960 }), 'tablet');
    assert.equal(deviceClass({ width: 1366, height: 1024 }), 'tablet');
  });

  test('phone 10–400%, tablet 10–800%, fit-all floor 2% on both', () => {
    assert.deepEqual(phone, { min: 0.1, max: 4, fitFloor: 0.02 });
    assert.deepEqual(tablet, { min: 0.1, max: 8, fitFloor: 0.02 });
  });

  test('clampZoom holds to the gesture range per device', () => {
    assert.equal(clampZoom(12, phone), 4);
    assert.equal(clampZoom(12, tablet), 8);
    assert.equal(clampZoom(6, phone), 4);
    assert.equal(clampZoom(6, tablet), 6);
    assert.equal(clampZoom(0.05, phone), 0.1);
    assert.equal(clampZoom(0.05, tablet), 0.1);
    assert.equal(clampZoom(1.5, phone), 1.5);
  });

  test('steps end at each device’s maximum', () => {
    assert.equal(zoomSteps('phone').at(-1), 4);
    assert.equal(zoomSteps('tablet').at(-1), 8);
    assert.equal(zoomSteps('phone')[0], 0.1);
  });
});

describe('rubber band (§3.4)', () => {
  test('the curve: 0 at 0, rising, never reaching d', () => {
    assert.equal(rubberBandOvershoot(0), 0);
    assert.ok(rubberBandOvershoot(1) > rubberBandOvershoot(0.5));
    assert.ok(rubberBandOvershoot(1000) < 0.5);
    near(rubberBandOvershoot(1e9), 0.5, 1e-6);
  });

  test('inside the range the fingers are followed 1:1', () => {
    assert.equal(rubberBandZoom(2.5, 0.1, 8), 2.5);
    assert.equal(rubberBandZoom(8, 0.1, 8), 8);
    assert.equal(rubberBandZoom(0.1, 0.1, 8), 0.1);
  });

  test('the spec’s example: fingers at 1100% show about 899% on a tablet', () => {
    near(rubberBandZoom(11, tablet.min, tablet.max), 8.99, 0.005);
  });

  test('over the top it tops out at max · 2^0.5 (about 1130% tablet, 566% phone)', () => {
    // The curve is hyperbolic, so it closes in slowly.
    for (const [limits, top] of [[tablet, 8 * Math.SQRT2], [phone, 4 * Math.SQRT2]] as const) {
      const far = rubberBandZoom(1e12, limits.min, limits.max);
      assert.ok(far < top && far > top * 0.98, `${far} vs ${top}`);
    }
  });

  test('below the minimum it bottoms out near 7%', () => {
    const floor = rubberBandZoom(1e-12, phone.min, phone.max);
    assert.ok(floor > 0.1 / Math.SQRT2 && floor < 0.072, String(floor));
    assert.ok(rubberBandZoom(0.08, 0.1, 4) > 0.08);
    assert.ok(rubberBandZoom(0.08, 0.1, 4) < 0.1);
  });

  test('a pinch that starts below the minimum (fit-all) treats its start as the floor', () => {
    const range = gestureRange(phone, 0.03);
    assert.deepEqual(range, { min: 0.03, max: 4 });
    assert.equal(rubberBandZoom(0.03, range.min, range.max), 0.03);
    assert.deepEqual(gestureRange(phone, 1), { min: 0.1, max: 4 });
  });
});

describe('screen and canvas', () => {
  const camera: Camera = { x: 100, y: -50, zoom: 2 };

  test('the view’s centre is the camera’s point', () => {
    assert.deepEqual(screenToCanvas(camera, view, { x: 195, y: 350 }), { x: 100, y: -50 });
    assert.deepEqual(canvasToScreen(camera, view, { x: 100, y: -50 }), { x: 195, y: 350 });
  });

  test('round trip', () => {
    const p = { x: 12.5, y: 640 };
    const back = canvasToScreen(camera, view, screenToCanvas(camera, view, p));
    near(back.x, p.x);
    near(back.y, p.y);
  });

  test('the content transform draws canvas points where canvasToScreen says', () => {
    const t = contentTransform(camera, view);
    const c = { x: 37, y: 91 };
    const s = canvasToScreen(camera, view, c);
    near(t.translateX + t.scale * c.x, s.x);
    near(t.translateY + t.scale * c.y, s.y);
  });

  test('a layer laid out at its box, origin at the parent’s (0,0), draws every point where it was', () => {
    // React Native: screen = layout + origin + translate + scale · (local − origin),
    // with the layer at left/top = box, transformOrigin = −box, and a card at p − box.
    for (const box of [{ x: -1200, y: 340 }, { x: 0, y: 0 }, { x: 5000, y: -75.5 }]) {
      for (const zoom of [0.05, 1, 3.5]) {
        const cam: Camera = { ...camera, zoom };
        const t = contentTransform(cam, view);
        const origin = { x: -box.x, y: -box.y };
        for (const p of [{ x: 37, y: 91 }, { x: -1500, y: 2000 }, box]) {
          const local = { x: p.x - box.x, y: p.y - box.y };
          const s = canvasToScreen(cam, view, p);
          near(box.x + origin.x + t.translateX + t.scale * (local.x - origin.x), s.x, 1e-6);
          near(box.y + origin.y + t.translateY + t.scale * (local.y - origin.y), s.y, 1e-6);
        }
      }
    }
  });
});

describe('dot grid offset', () => {
  test('always in [−spacing, 0)', () => {
    for (const spacing of [14, 28]) {
      for (const t of [0, 1, -1, 13.999999, 14, -14, 1e-17, -1e-17, 12345.67, -98765.4321]) {
        const o = gridOffset(t, spacing);
        assert.ok(o >= -spacing && o < 0, `${t} → ${o}`);
        // A whole number of spacings from the translate, so the grid lines up with it.
        const steps = (t - o) / spacing;
        near(steps, Math.round(steps), 1e-6);
      }
    }
  });

  test('continuous under a pan, wrapping by exactly one spacing', () => {
    let last = gridOffset(0, 14);
    for (let t = 0.5; t <= 60; t += 0.5) {
      const o = gridOffset(t, 14);
      const step = o - last;
      assert.ok(Math.abs(step - 0.5) < 1e-9 || Math.abs(step - 0.5 + 14) < 1e-9, `${t}: ${step}`);
      last = o;
    }
  });

  test('a pan moves a fixed canvas point and the grid by the same screen delta', () => {
    const before: Camera = { x: 120, y: -40, zoom: 0.8 };
    const after: Camera = { x: 120 - 3 / 0.8, y: -40 + 2 / 0.8, zoom: 0.8 };
    const p = { x: 500, y: 250 };
    const a = canvasToScreen(before, view, p);
    const b = canvasToScreen(after, view, p);
    const ta = contentTransform(before, view);
    const tb = contentTransform(after, view);
    near(gridOffset(tb.translateX, 14) - gridOffset(ta.translateX, 14), b.x - a.x);
    near(gridOffset(tb.translateY, 14) - gridOffset(ta.translateY, 14), b.y - a.y);
  });
});

describe('content layer box', () => {
  test('holds every frame, however far from (0,0)', () => {
    const frames: Rect[] = [
      { x: -800, y: 1200, width: 240, height: 160 },
      { x: 3000, y: -450, width: 300, height: 200 },
      { x: 10, y: 20, width: 30, height: 40 },
    ];
    const box = layerBox(frames);
    assert.deepEqual(box, { x: -800, y: -450, width: 4100, height: 1810 });
    for (const f of frames) {
      // In the layer's own coordinates each card is inside [0, width] × [0, height].
      assert.ok(f.x - box.x >= 0 && f.y - box.y >= 0, JSON.stringify(f));
      assert.ok(f.x - box.x + f.width <= box.width, JSON.stringify(f));
      assert.ok(f.y - box.y + f.height <= box.height, JSON.stringify(f));
    }
  });

  test('a 1 × 1 box at (0,0) with no cards', () => {
    assert.deepEqual(layerBox([]), { x: 0, y: 0, width: 1, height: 1 });
  });
});

describe('focal zoom', () => {
  test('the canvas point under the fingers stays put', () => {
    const camera: Camera = { x: 300, y: 200, zoom: 0.75 };
    const focal = { x: 80, y: 600 };
    const before = screenToCanvas(camera, view, focal);
    for (const zoom of [0.1, 0.5, 1, 3.7, 8]) {
      const after = zoomAbout(camera, view, focal, zoom);
      assert.equal(after.zoom, zoom);
      const under = screenToCanvas(after, view, focal);
      near(under.x, before.x, 1e-9);
      near(under.y, before.y, 1e-9);
    }
  });

  test('zooming about the centre keeps the centre', () => {
    const camera: Camera = { x: 5, y: 6, zoom: 1 };
    const after = zoomAbout(camera, view, { x: 195, y: 350 }, 3);
    near(after.x, 5);
    near(after.y, 6);
  });

  test('a flight about a focal point keeps it put the whole way', () => {
    const from: Camera = { x: 0, y: 0, zoom: 0.2 };
    const to = zoomAbout(from, view, { x: 50, y: 60 }, 1);
    const anchor = screenToCanvas(from, view, { x: 50, y: 60 });
    for (const t of [0, 0.25, 0.5, 1]) {
      const c = cameraBetween(from, to, t, view, { x: 50, y: 60 });
      const under = screenToCanvas(c, view, { x: 50, y: 60 });
      near(under.x, anchor.x);
      near(under.y, anchor.y);
    }
    near(cameraBetween(from, to, 1, view, { x: 50, y: 60 }).zoom, 1);
  });

  test('zoom interpolates in log space', () => {
    near(lerpZoom(0.25, 4, 0.5), 1);
    near(cameraBetween({ x: 0, y: 0, zoom: 1 }, { x: 10, y: 20, zoom: 4 }, 0.5, view).zoom, 2);
  });
});

describe('fit-all', () => {
  const frames: Rect[] = [
    { x: 0, y: 0, width: 260, height: 180 },
    { x: 600, y: 400, width: 260, height: 180 },
  ];

  test('frames the cards’ box, centred, within the padding', () => {
    const c = fitAll(frames, view, 20, phone);
    assert.equal(c.x, 430);
    assert.equal(c.y, 290);
    near(c.zoom, (390 - 40) / 860);
    const left = canvasToScreen(c, view, { x: 0, y: 0 });
    near(left.x, 20);
  });

  test('a huge workspace goes below 10%, down to the 2% floor and no further', () => {
    const wide: Rect[] = [{ x: 0, y: 0, width: 4000, height: 100 }];
    near(fitAll(wide, view, 0, phone).zoom, 390 / 4000);
    const vast: Rect[] = [{ x: -1e5, y: 0, width: 260, height: 180 }, { x: 1e5, y: 0, width: 260, height: 180 }];
    assert.equal(fitAll(vast, view, 0, phone).zoom, 0.02);
  });

  test('a single small card stops at the device’s maximum', () => {
    const one: Rect[] = [{ x: 10, y: 10, width: 24, height: 24 }];
    assert.equal(fitAll(one, view, 0, phone).zoom, 4);
    assert.equal(fitAll(one, { width: 1024, height: 1366 }, 0, tablet).zoom, 8);
  });

  test('an empty workspace opens at (0,0), 100%', () => {
    assert.deepEqual(fitAll([], view, 20, phone), { x: 0, y: 0, zoom: 1 });
  });

  test('padding is tldraw’s 128, capped at 28% of the width, split over both sides', () => {
    assert.equal(fitPadding({ width: 390, height: 800 }), (390 * 0.28) / 2);
    assert.equal(fitPadding({ width: 1024, height: 800 }), 64);
  });
});

describe('restore', () => {
  const frames: Rect[] = [{ x: 0, y: 0, width: 260, height: 180 }];

  test('800% saved on a tablet opens at 400% on a phone, same centre', () => {
    assert.deepEqual(restoreCamera({ x: 12, y: 34, zoom: 8 }, frames, view, phone), { x: 12, y: 34, zoom: 4 });
    assert.deepEqual(restoreCamera({ x: 12, y: 34, zoom: 8 }, frames, view, tablet), { x: 12, y: 34, zoom: 8 });
  });

  test('a saved fit-all below 10% is kept, down to 2%', () => {
    assert.equal(restoreCamera({ x: 0, y: 0, zoom: 0.05 }, frames, view, phone).zoom, 0.05);
    assert.equal(restoreCamera({ x: 0, y: 0, zoom: 0.001 }, frames, view, phone).zoom, 0.02);
  });

  test('nothing saved, or a broken camera, opens at fit-all', () => {
    const fit = fitAll(frames, view, fitPadding(view), phone);
    assert.deepEqual(restoreCamera(undefined, frames, view, phone), fit);
    assert.deepEqual(restoreCamera({ x: NaN, y: 0, zoom: 1 }, frames, view, phone), fit);
    assert.deepEqual(restoreCamera({ x: 0, y: 0, zoom: 0 }, frames, view, phone), fit);
    assert.deepEqual(restoreCamera(undefined, [], view, phone), { x: 0, y: 0, zoom: 1 });
  });
});

describe('double tap (§3.2)', () => {
  const fit: Camera = { x: 400, y: 300, zoom: 0.3 };

  test('from fit-all (or anywhere not 100%) it goes to 100% at the tap point', () => {
    const tap = { x: 100, y: 200 };
    const target = doubleTapTarget(fit, view, tap, fit);
    assert.equal(target.zoom, 1);
    const before = screenToCanvas(fit, view, tap);
    const after = screenToCanvas(target, view, tap);
    near(after.x, before.x);
    near(after.y, before.y);
  });

  test('from 100% (within the detent window) it goes to fit-all', () => {
    assert.deepEqual(doubleTapTarget({ x: 0, y: 0, zoom: 1 }, view, { x: 1, y: 1 }, fit), fit);
    assert.deepEqual(doubleTapTarget({ x: 0, y: 0, zoom: 1.04 }, view, { x: 1, y: 1 }, fit), fit);
  });

  test('toggles back and forth', () => {
    const tap = { x: 300, y: 500 };
    const in1 = doubleTapTarget(fit, view, tap, fit);
    assert.deepEqual(doubleTapTarget(in1, view, tap, fit), fit);
  });

  test('hits on cards are not empty canvas', () => {
    const frames: Rect[] = [{ x: 0, y: 0, width: 100, height: 100 }];
    assert.equal(hitsFrame(frames, { x: 50, y: 50 }), true);
    assert.equal(hitsFrame(frames, { x: 150, y: 50 }), false);
  });
});

describe('pinch settle (§3.3)', () => {
  const range = { min: 0.1, max: 4 };

  test('rubber band springs back to the limit', () => {
    assert.equal(settleZoom(5, range, 0.4), 4);
    assert.equal(settleZoom(0.08, range, 0.4), 0.1);
  });

  test('inside ±5% (log) of 100% or fit-all it eases there', () => {
    assert.equal(settleZoom(1.04, range, 0.4), 1);
    assert.equal(settleZoom(0.96, range, 0.4), 1);
    assert.equal(settleZoom(0.41, range, 0.4), 0.4);
  });

  test('outside every window it stays exactly put', () => {
    assert.equal(settleZoom(1.06, range, 0.4), 1.06);
    assert.equal(settleZoom(2.5, range, 0.4), 2.5);
  });
});

describe('zoom steps', () => {
  const steps = zoomSteps('phone');

  test('from a step, one step on', () => {
    assert.equal(nextZoomStep(1, 1, steps), 1.5);
    assert.equal(nextZoomStep(1, -1, steps), 0.75);
  });

  test('snaps by log-space midpoints, not linear ones', () => {
    // Between 100% and 150% the log midpoint is about 122%; linear is 125%.
    assert.equal(nextZoomStep(1.23, -1, steps), 1);
    assert.equal(nextZoomStep(1.21, -1, steps), 0.75);
  });

  test('stops at either end', () => {
    assert.equal(nextZoomStep(4, 1, steps), 4);
    assert.equal(nextZoomStep(0.1, -1, steps), 0.1);
    assert.equal(nextZoomStep(0.03, 1, steps), 0.25);
  });
});

describe('pan inertia (§3.5)', () => {
  test('a 1000 pt/s fling at 0.998/ms projects to 499 pt', () => {
    near(projectedRest(1000, IOS_DECAY), 499, 1e-9);
  });

  test('the glide stops a little short of that, slowing to rest', () => {
    const glide = inertia(1000, IOS_DECAY);
    assert.ok(glide.distance > 490 && glide.distance < 499);
    near(1000 * Math.pow(IOS_DECAY, glide.duration), 10, 1e-6);
    assert.ok(inertia(-1000, IOS_DECAY).distance < 0);
    assert.deepEqual(inertia(5, IOS_DECAY), { distance: 0, duration: 0 });
  });

  test('the easing starts at the release velocity and ends at 1', () => {
    const { distance, duration } = inertia(1000, IOS_DECAY);
    assert.equal(inertiaProgress(0, IOS_DECAY, duration), 0);
    near(inertiaProgress(1, IOS_DECAY, duration), 1);
    // The slope at the start, in pt/ms, is the fling's 1 pt/ms.
    const h = 1e-6;
    near((inertiaProgress(h, IOS_DECAY, duration) * distance) / (h * duration), 1, 1e-3);
  });
});
