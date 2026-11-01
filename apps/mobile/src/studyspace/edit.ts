// Moving and resizing a card (findings §4.2, §4.3): the finger's screen
// travel in canvas units, the resize clamps, snapping to other cards' edges
// and centres, and the accessibility actions' steps. Pure and free of React
// Native so `node --test` can run it; every function is a worklet, since a
// card's drag runs on the UI thread, and none reads a module constant in a
// default parameter (worklets.test.ts checks both).

import type { Rect } from '@/studyspace/camera';

/** A card's smallest size from its content (§4.3): a title line and a caption. */
export const MIN_CARD = { width: 120, height: 72 } as const;
/** The core's sanity maximum for a side (§2). Its minimum, 24, is below MIN_CARD. */
export const MAX_CARD = 8192;
/** §4.2: a snap catches within 10 screen points with touch. */
export const SNAP_DISTANCE = 10;
/** One step of the Move and Size actions, in canvas units (§4.3, WCAG 2.5.7). */
export const NUDGE = 24;

/** `screen` points of finger travel, in canvas units at `zoom`. */
export function toCanvas(screen: number, zoom: number): number {
  'worklet';
  return screen / zoom;
}

/** `frame` moved by a screen travel of dx, dy at `zoom`. */
export function moveBy(frame: Rect, dx: number, dy: number, zoom: number): Rect {
  'worklet';
  return { ...frame, x: frame.x + toCanvas(dx, zoom), y: frame.y + toCanvas(dy, zoom) };
}

/** A side clamped to MIN_CARD's `min` and MAX_CARD. */
function side(value: number, min: number): number {
  'worklet';
  return Math.min(MAX_CARD, Math.max(min, value));
}

/** `frame` with its bottom-right corner dragged by dx, dy screen points at `zoom`, within the size limits. */
export function resizeBy(frame: Rect, dx: number, dy: number, zoom: number): Rect {
  'worklet';
  return {
    ...frame,
    width: side(frame.width + toCanvas(dx, zoom), MIN_CARD.width),
    height: side(frame.height + toCanvas(dy, zoom), MIN_CARD.height),
  };
}

/** The lines a snap can catch along one axis: start, centre, end. */
function lines(start: number, length: number): [number, number, number] {
  'worklet';
  return [start, start + length / 2, start + length];
}

/**
 * How far to shift a span (start, length) so the nearest of its lines meets
 * the nearest line of `others` along that axis, within `reach`; and the line
 * it meets. None when nothing is within reach.
 */
function snapAxis(
  start: number,
  length: number,
  others: readonly { start: number; length: number }[],
  reach: number,
): { shift: number; line: number } | undefined {
  'worklet';
  let best: { shift: number; line: number } | undefined;
  const mine = lines(start, length);
  for (const other of others) {
    for (const line of lines(other.start, other.length)) {
      for (const own of mine) {
        const shift = line - own;
        if (Math.abs(shift) <= reach && (best === undefined || Math.abs(shift) < Math.abs(best.shift))) {
          best = { shift, line };
        }
      }
    }
  }
  return best;
}

export type Snap = {
  frame: Rect;
  /** The canvas x of the vertical line caught, if one is. */
  x: number | undefined;
  /** The canvas y of the horizontal line caught, if one is. */
  y: number | undefined;
};

/**
 * §4.2: a moving card's left, centre and right snap to other cards' left,
 * centres and rights (and top, middle, bottom likewise) when within
 * `screenReach` points on screen, so the same distance at every zoom. Each
 * axis takes its nearest catch on its own. No grid snapping.
 */
export function snapFrame(frame: Rect, others: readonly Rect[], screenReach: number, zoom: number): Snap {
  'worklet';
  const reach = toCanvas(screenReach, zoom);
  const sx = snapAxis(frame.x, frame.width, others.map((o) => ({ start: o.x, length: o.width })), reach);
  const sy = snapAxis(frame.y, frame.height, others.map((o) => ({ start: o.y, length: o.height })), reach);
  return {
    frame: { ...frame, x: frame.x + (sx?.shift ?? 0), y: frame.y + (sy?.shift ?? 0) },
    x: sx?.line,
    y: sy?.line,
  };
}

export type CardAction =
  | 'moveLeft'
  | 'moveRight'
  | 'moveUp'
  | 'moveDown'
  | 'larger'
  | 'smaller'
  | 'front'
  | 'remove';

/** The frame a Move or Size action leaves; the other actions don't change it. */
export function nudge(frame: Rect, action: CardAction): Rect {
  'worklet';
  switch (action) {
    case 'moveLeft':
      return { ...frame, x: frame.x - NUDGE };
    case 'moveRight':
      return { ...frame, x: frame.x + NUDGE };
    case 'moveUp':
      return { ...frame, y: frame.y - NUDGE };
    case 'moveDown':
      return { ...frame, y: frame.y + NUDGE };
    case 'larger':
      return resizeBy(frame, NUDGE, NUDGE, 1);
    case 'smaller':
      return resizeBy(frame, -NUDGE, -NUDGE, 1);
    default:
      return frame;
  }
}

/** Whether two frames are the same, so an unchanged one isn't written. */
export function sameFrame(a: Rect, b: Rect): boolean {
  'worklet';
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
