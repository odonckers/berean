import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  focusCamera,
  freeSpot,
  LANDING_GAP,
  LANDING_GRID,
  LANDING_MARGIN,
  landingTarget,
  NOTE_CARD,
  panIntoView,
} from './landing.ts';

const camera = { x: 0, y: 0, zoom: 1 };
const view = { width: 400, height: 800 };

describe('landing target (§7.2)', () => {
  test('right of the selected card, tops aligned, 24 apart', () => {
    const selected = { x: 100, y: 50, width: 200, height: 300 };
    assert.deepEqual(landingTarget(NOTE_CARD, selected, camera, LANDING_GAP), { x: 324, y: 50, width: 260, height: 180 });
  });

  test('centred in the view with nothing selected', () => {
    assert.deepEqual(landingTarget(NOTE_CARD, undefined, { x: 1000, y: -40, zoom: 0.5 }, LANDING_GAP), {
      x: 870,
      y: -130,
      width: 260,
      height: 180,
    });
  });
});

describe('free spot', () => {
  const target = { x: 0, y: 0, width: 100, height: 100 };

  test('the target when it is clear', () => {
    assert.equal(freeSpot(target, [{ x: 200, y: 0, width: 50, height: 50 }], 24, 8), target);
    assert.equal(freeSpot(target, [], 24, 8), target);
  });

  test('24 of clearance: touching within it isn’t free', () => {
    const near = { x: 120, y: 0, width: 50, height: 50 };
    const spot = freeSpot(target, [near], LANDING_GAP, LANDING_GRID);
    assert.notDeepEqual(spot, target);
  });

  test('the nearest free spot on the 8 grid', () => {
    // A card covering x 0–100, y 0–60: the nearest clear spot is straight
    // down, to y = 60 + 24 = 84 (on the grid: 88), not sideways (124+).
    const other = { x: 0, y: 0, width: 100, height: 60 };
    const spot = freeSpot(target, [other], LANDING_GAP, LANDING_GRID);
    assert.equal(spot.x, 0);
    assert.equal(spot.y, 88);
    assert.equal(spot.width, 100);
    assert.equal((spot.y - target.y) % LANDING_GRID, 0);
  });

  test('never overlaps a card in the middle of a crowd', () => {
    const crowd = [
      { x: -50, y: -50, width: 200, height: 200 },
      { x: 180, y: -50, width: 200, height: 200 },
      { x: -50, y: 180, width: 200, height: 200 },
    ];
    const spot = freeSpot(target, crowd, LANDING_GAP, LANDING_GRID);
    for (const c of crowd) {
      const apart =
        spot.x >= c.x + c.width + 24 ||
        c.x >= spot.x + spot.width + 24 ||
        spot.y >= c.y + c.height + 24 ||
        c.y >= spot.y + spot.height + 24;
      assert.ok(apart, JSON.stringify({ spot, c }));
    }
  });
});

describe('pan into view (§7.2)', () => {
  test('in view already: the same camera', () => {
    assert.equal(panIntoView(camera, view, { x: -100, y: -100, width: 100, height: 100 }, LANDING_MARGIN), camera);
  });

  test('off to the right: the shortest pan to show it plus 24', () => {
    // The view spans x −200…200; the card's right edge plus margin is 324.
    const to = panIntoView(camera, view, { x: 100, y: 0, width: 200, height: 100 }, LANDING_MARGIN);
    assert.deepEqual(to, { x: 124, y: 0, zoom: 1 });
  });

  test('off the top: pans up; the zoom never changes', () => {
    // At 50% the view spans y −800…800 and the margin is 48 canvas units.
    const zoomed = { x: 0, y: 0, zoom: 0.5 };
    const to = panIntoView(zoomed, view, { x: 0, y: -900, width: 100, height: 100 }, LANDING_MARGIN);
    assert.deepEqual(to, { x: 0, y: -148, zoom: 0.5 });
  });

  test('bigger than the view: shows its top-left', () => {
    const to = panIntoView(camera, view, { x: 0, y: 0, width: 1000, height: 100 }, LANDING_MARGIN);
    assert.equal(to.x, -24 + 200);
  });
});

describe('focus zoom on a tapped reader card (§6.1)', () => {
  test('below 100%: 100%, centred on the card', () => {
    const to = focusCamera({ x: 0, y: 0, zoom: 0.5 }, view, { x: 1000, y: 1000, width: 300, height: 200 }, LANDING_MARGIN);
    assert.deepEqual(to, { x: 1150, y: 1100, zoom: 1 });
  });

  test('at 100% or more: the zoom kept, the card only panned into view', () => {
    assert.equal(focusCamera(camera, view, { x: -100, y: -100, width: 100, height: 100 }, LANDING_MARGIN), camera);
    const zoomed = { x: 0, y: 0, zoom: 2 };
    assert.deepEqual(focusCamera(zoomed, view, { x: 300, y: 0, width: 100, height: 100 }, LANDING_MARGIN), {
      x: 312,
      y: 0,
      zoom: 2,
    });
  });

  test('fits the view across but not with the margin: the whole card and its 3 pt outline show', () => {
    // 634 + 2 × 24 > 640: the margin across shrinks to the 3 pt either side.
    const wide = { width: 640, height: 900 };
    const frame = { x: 2000, y: 500, width: 634, height: 400 };
    const across = (to: { x: number; zoom: number }) => {
      const left = (frame.x - 3 - to.x) * to.zoom + wide.width / 2;
      const right = (frame.x + frame.width + 3 - to.x) * to.zoom + wide.width / 2;
      return { left, right };
    };
    for (const from of [
      { x: 0, y: 700, zoom: 1 },
      { x: 3000, y: 700, zoom: 1 },
      { x: 0, y: 0, zoom: 0.4 },
    ]) {
      const to = focusCamera(from, wide, frame, LANDING_MARGIN);
      assert.equal(to.zoom, 1);
      const { left, right } = across(to);
      assert.ok(left >= 0, `left ${left} from ${JSON.stringify(from)}`);
      assert.ok(right <= wide.width, `right ${right} from ${JSON.stringify(from)}`);
    }
  });

  test('taller than the view: its top just inside the margin', () => {
    const to = focusCamera({ x: 0, y: 0, zoom: 0.5 }, view, { x: 0, y: 0, width: 300, height: 2000 }, LANDING_MARGIN);
    assert.deepEqual(to, { x: 150, y: 400 - 24, zoom: 1 });
  });
});
