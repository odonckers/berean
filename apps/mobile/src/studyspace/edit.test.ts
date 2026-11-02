import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  dragFrame,
  guideOnScreen,
  lineChanged,
  MAX_CARD,
  MIN_CARD,
  moveBy,
  NUDGE,
  nudge,
  resizeBy,
  sameFrame,
  snapFrame,
  snapGuides,
  toCanvas,
} from './edit.ts';

const card = { x: 100, y: 100, width: 200, height: 100 };

describe('moving (§4.3)', () => {
  test('the finger’s screen travel is canvas travel / zoom', () => {
    assert.equal(toCanvas(30, 1), 30);
    assert.equal(toCanvas(30, 0.5), 60);
    assert.equal(toCanvas(30, 2), 15);
    assert.equal(toCanvas(-30, 0.1), -300);
  });

  test('a moved card keeps its size', () => {
    assert.deepEqual(moveBy(card, 40, -20, 2), { x: 120, y: 90, width: 200, height: 100 });
    assert.deepEqual(moveBy(card, 40, -20, 0.5), { x: 180, y: 60, width: 200, height: 100 });
  });
});

describe('resizing (§4.3)', () => {
  test('the corner follows the finger, in canvas units', () => {
    assert.deepEqual(resizeBy(card, 50, 20, 1), { x: 100, y: 100, width: 250, height: 120 });
    assert.deepEqual(resizeBy(card, 50, 20, 0.5), { x: 100, y: 100, width: 300, height: 140 });
    assert.deepEqual(resizeBy(card, 50, 20, 2), { x: 100, y: 100, width: 225, height: 110 });
  });

  test('never below the content minimum (well above the core’s 24)', () => {
    const tiny = resizeBy(card, -1000, -1000, 1);
    assert.equal(tiny.width, MIN_CARD.width);
    assert.equal(tiny.height, MIN_CARD.height);
    assert.ok(MIN_CARD.width >= 24 && MIN_CARD.height >= 24);
  });

  test('never past the core’s 8192', () => {
    const huge = resizeBy(card, 10_000, 10_000, 0.1);
    assert.equal(huge.width, MAX_CARD);
    assert.equal(huge.height, MAX_CARD);
  });
});

describe('snapping (§4.2)', () => {
  const other = { x: 400, y: 300, width: 200, height: 100 };

  test('catches a left edge within 10 screen points at 100%', () => {
    const near = { x: 408, y: 0, width: 100, height: 50 };
    const snap = snapFrame(near, [other], 10, 1);
    assert.equal(snap.frame.x, 400);
    assert.equal(snap.x, 400);
    assert.equal(snap.y, undefined);
    assert.equal(snap.frame.y, 0);
  });

  test('doesn’t catch past 10 screen points', () => {
    const far = { x: 412, y: 0, width: 100, height: 50 };
    const snap = snapFrame(far, [other], 10, 1);
    assert.deepEqual(snap.frame, far);
    assert.equal(snap.x, undefined);
  });

  test('the reach is in screen points: wider in canvas units zoomed out, narrower zoomed in', () => {
    const off = (dx: number) => ({ x: 400 + dx, y: 0, width: 100, height: 50 });
    // 18 canvas units is 9 points at 50%, 36 at 200%.
    assert.equal(snapFrame(off(18), [other], 10, 0.5).x, 400);
    assert.equal(snapFrame(off(18), [other], 10, 2).x, undefined);
    // 4 canvas units is 8 points at 200%.
    assert.equal(snapFrame(off(4), [other], 10, 2).x, 400);
    assert.equal(snapFrame(off(22), [other], 10, 0.5).x, undefined);
  });

  test('centres and right edges catch, and the far side of the other card too', () => {
    // Moving centre (x + 50) 3 from the other's centre (500).
    const centred = snapFrame({ x: 453, y: 0, width: 100, height: 50 }, [other], 10, 1);
    assert.equal(centred.frame.x, 450);
    assert.equal(centred.x, 500);
    // Moving left edge 5 from the other's right edge (600).
    const after = snapFrame({ x: 605, y: 0, width: 100, height: 50 }, [other], 10, 1);
    assert.equal(after.frame.x, 600);
  });

  test('each axis takes its own nearest catch', () => {
    const others = [other, { x: 0, y: 297, width: 50, height: 50 }];
    // x: left 2 from the first card's left; y: top 2 from its top, but 1 from the second card's.
    const snap = snapFrame({ x: 402, y: 298, width: 100, height: 50 }, others, 10, 1);
    assert.equal(snap.frame.x, 400);
    assert.equal(snap.frame.y, 297);
    assert.equal(snap.y, 297);
  });

  test('chooses the nearest line when several are in reach', () => {
    const a = { x: 400, y: 0, width: 30, height: 10 };
    const b = { x: 405, y: 500, width: 10, height: 10 };
    // Left edge at 407: 7 from a's left, 2 from b's left.
    assert.equal(snapFrame({ x: 407, y: 200, width: 100, height: 50 }, [a, b], 10, 1).x, 405);
  });

  test('nothing to snap to leaves the frame alone', () => {
    assert.deepEqual(snapFrame(card, [], 10, 1), { frame: card, x: undefined, y: undefined });
  });
});

describe('the drag’s target (§4.2)', () => {
  const other = { x: 400, y: 300, width: 200, height: 100 };

  test('unsnapped, the card is where the finger has moved it, 1:1', () => {
    const start = { x: 0, y: 0, width: 100, height: 50 };
    const drag = dragFrame(start, 60, 40, 2, [other], 10);
    assert.deepEqual(drag.frame, moveBy(start, 60, 40, 2));
    assert.equal(drag.x, undefined);
    assert.equal(drag.y, undefined);
  });

  test('snapped, it is the snapped frame, which the release commits', () => {
    const start = { x: 300, y: 0, width: 100, height: 50 };
    // The left edge reaches 406, 6 from the other's left.
    const drag = dragFrame(start, 106, 0, 1, [other], 10);
    assert.deepEqual(drag.frame, { x: 400, y: 0, width: 100, height: 50 });
    assert.deepEqual(drag, snapFrame(moveBy(start, 106, 0, 1), [other], 10, 1));
  });

  test('the card springs when a catch starts, ends or moves to another line, not while it holds', () => {
    assert.equal(lineChanged(NaN, undefined), false);
    assert.equal(lineChanged(NaN, 400), true);
    assert.equal(lineChanged(400, 400), false);
    assert.equal(lineChanged(400, 500), true);
    assert.equal(lineChanged(400, undefined), true);
  });
});

describe('snap guides (§4.2)', () => {
  const other = { x: 400, y: 300, width: 200, height: 100 };

  test('none when nothing is caught', () => {
    const snap = snapFrame({ x: 0, y: 0, width: 100, height: 50 }, [other], 10, 1);
    assert.deepEqual(snapGuides(snap, [other], 8), []);
  });

  test('an x snap is a vertical line spanning both cards, with the overhang', () => {
    const snap = snapFrame({ x: 405, y: 0, width: 100, height: 50 }, [other], 10, 1);
    assert.deepEqual(snapGuides(snap, [other], 8), [{ axis: 'x', at: 400, from: -8, to: 408 }]);
  });

  test('a y snap is a horizontal line spanning both cards', () => {
    const snap = snapFrame({ x: 0, y: 404, width: 100, height: 50 }, [other], 10, 1);
    // Its top met the other's bottom, at 400.
    assert.deepEqual(snapGuides(snap, [other], 8), [{ axis: 'y', at: 400, from: -8, to: 608 }]);
  });

  test('both axes caught give both lines', () => {
    const snap = snapFrame({ x: 402, y: 298, width: 100, height: 50 }, [other], 10, 1);
    assert.deepEqual(snapGuides(snap, [other], 0), [
      { axis: 'x', at: 400, from: 300, to: 400 },
      { axis: 'y', at: 300, from: 400, to: 600 },
    ]);
  });

  test('a centre snap spans every card with that centre, and no other', () => {
    const below = { x: 450, y: 600, width: 100, height: 40 };
    const aside = { x: 0, y: 1000, width: 50, height: 50 };
    // Moving centre (x + 50) 3 from the others' centres (500).
    const snap = snapFrame({ x: 453, y: 0, width: 100, height: 50 }, [other, below, aside], 10, 1);
    assert.equal(snap.x, 500);
    assert.deepEqual(snapGuides(snap, [other, below, aside], 0), [{ axis: 'x', at: 500, from: 0, to: 640 }]);
  });

  test('on screen through the camera, centred on the line', () => {
    const view = { width: 400, height: 800 };
    // Canvas (0, 0) at the view's centre, at 200%.
    const camera = { x: 0, y: 0, zoom: 2 };
    assert.deepEqual(guideOnScreen({ axis: 'x', at: 10, from: -20, to: 30 }, camera, view, 1), {
      x: 219.5,
      y: 360,
      width: 1,
      height: 100,
    });
    assert.deepEqual(guideOnScreen({ axis: 'y', at: 10, from: -20, to: 30 }, camera, view, 1), {
      x: 160,
      y: 419.5,
      width: 100,
      height: 1,
    });
  });
});

describe('accessibility actions (WCAG 2.5.7)', () => {
  test('Move steps one nudge', () => {
    assert.deepEqual(nudge(card, 'moveLeft'), { ...card, x: card.x - NUDGE });
    assert.deepEqual(nudge(card, 'moveRight'), { ...card, x: card.x + NUDGE });
    assert.deepEqual(nudge(card, 'moveUp'), { ...card, y: card.y - NUDGE });
    assert.deepEqual(nudge(card, 'moveDown'), { ...card, y: card.y + NUDGE });
  });

  test('Size steps one nudge each way, within the limits', () => {
    assert.deepEqual(nudge(card, 'larger'), { ...card, width: 224, height: 124 });
    assert.deepEqual(nudge(card, 'smaller'), { ...card, width: 176, height: 76 });
    const smallest = { ...card, ...MIN_CARD };
    assert.ok(sameFrame(nudge(smallest, 'smaller'), smallest));
    const largest = { ...card, width: MAX_CARD, height: MAX_CARD };
    assert.ok(sameFrame(nudge(largest, 'larger'), largest));
  });

  test('Bring to front and Remove leave the frame', () => {
    assert.ok(sameFrame(nudge(card, 'front'), card));
    assert.ok(sameFrame(nudge(card, 'remove'), card));
  });
});
