// Where an added card lands (findings §7.2): beside the selected card or in
// the middle of the view, the nearest free spot on an 8 pt grid, and the
// shortest pan that brings it into view. Runs on the JS thread when a card
// is added. Kept free of React Native for the tests.

import type { Camera, Rect, Size } from '@/studyspace/camera';

/** §7.2: the gap beside the selected card, and the clearance around every card. */
export const LANDING_GAP = 24;
/** §7.2: the spot search's grid. */
export const LANDING_GRID = 8;
/** The view keeps this much screen margin around a landed card. */
export const LANDING_MARGIN = 24;

/** Default sizes by what is added, in canvas units. */
export const NOTE_CARD = { width: 260, height: 180 } as const;
export const PUBLICATION_CARD = { width: 300, height: 200 } as const;

/**
 * Where a card of `size` would land: right of `selected`, top edges aligned,
 * `gap` apart; with nothing selected, centred in the view (whose centre is
 * the camera's x, y).
 */
export function landingTarget(size: Size, selected: Rect | undefined, camera: Camera, gap: number): Rect {
  if (selected !== undefined) {
    return { x: selected.x + selected.width + gap, y: selected.y, ...size };
  }
  return { x: camera.x - size.width / 2, y: camera.y - size.height / 2, ...size };
}

/** Whether `a` comes within `clearance` of `b`. */
function crowds(a: Rect, b: Rect, clearance: number): boolean {
  return (
    a.x < b.x + b.width + clearance &&
    b.x < a.x + a.width + clearance &&
    a.y < b.y + b.height + clearance &&
    b.y < a.y + a.height + clearance
  );
}

/**
 * `target` if it keeps `clearance` from every card in `others`; else the
 * nearest spot that does, searched outward ring by ring on a `grid`.
 */
export function freeSpot(target: Rect, others: readonly Rect[], clearance: number, grid: number): Rect {
  const free = (r: Rect) => others.every((o) => !crowds(r, o, clearance));
  if (free(target)) return target;
  let best: { spot: Rect; distance: number } | undefined;
  // Ring n holds the grid points n steps out on either axis; once a ring
  // starts farther than the best found, nothing nearer is left. Every card
  // is finite, so a free ring is reached: the bound only guards bad input.
  for (let ring = 1; ring < 100_000; ring++) {
    if (best !== undefined && ring * grid > best.distance) break;
    for (let i = -ring; i <= ring; i++) {
      for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
        const spot = { ...target, x: target.x + i * grid, y: target.y + j * grid };
        const distance = Math.hypot(i * grid, j * grid);
        if ((best === undefined || distance < best.distance) && free(spot)) best = { spot, distance };
      }
    }
  }
  return best?.spot ?? target;
}

/** The shortest shift of [low, high] along one axis into [from, to]; low wins if it can't fit. */
function shiftInto(low: number, high: number, from: number, to: number): number {
  if (low < from || high - low > to - from) return from - low;
  if (high > to) return to - high;
  return 0;
}

/**
 * The camera after the shortest pan that brings `rect`, plus `margin`
 * screen points around it, into a view of `view`; the same camera when it
 * is already in view. The zoom never changes. A card bigger than the view
 * shows its top-left.
 */
export function panIntoView(camera: Camera, view: Size, rect: Rect, margin: number): Camera {
  const m = margin / camera.zoom;
  const halfW = view.width / 2 / camera.zoom;
  const halfH = view.height / 2 / camera.zoom;
  const dx = shiftInto(rect.x - m, rect.x + rect.width + m, camera.x - halfW, camera.x + halfW);
  const dy = shiftInto(rect.y - m, rect.y + rect.height + m, camera.y - halfH, camera.y + halfH);
  // The view moves the other way to the card's shift.
  return dx === 0 && dy === 0 ? camera : { x: camera.x - dx, y: camera.y - dy, zoom: camera.zoom };
}
