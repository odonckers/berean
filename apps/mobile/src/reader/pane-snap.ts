// The study pane's height math (spec §4, §7), kept free of React Native so
// the resize gesture runs it on the UI thread and Node can test it. Heights
// are fractions of the window height, so rotation keeps them.

// The pane drags between 25% and 85% and settles on the nearest detent.
export const MIN_HEIGHT = 0.25;
export const MAX_HEIGHT = 0.85;

// At accessibility text sizes the pane opens at 60%, which is also a detent.
export const LARGE_TEXT_SCALE = 1.5;

// A fast flick down on the header dismisses the pane, in dp/s. Positive is
// downward, as Gesture Handler reports it.
export const DISMISS_VELOCITY = 800;

export type Release = { kind: 'close' } | { kind: 'snap'; fraction: number };

export function paneDetents(fontScale: number): readonly number[] {
  'worklet';
  return fontScale >= LARGE_TEXT_SCALE ? [0.25, 0.4, 0.6, 0.85] : [0.25, 0.4, 0.85];
}

/** The height the pane opens at. */
export function openFraction(fontScale: number): number {
  'worklet';
  return fontScale >= LARGE_TEXT_SCALE ? 0.6 : 0.4;
}

function clampFraction(value: number, min: number, max: number): number {
  'worklet';
  return Math.min(Math.max(value, min), max);
}

/** The live height while dragging: the start height moved with the finger, clamped. */
export function dragFraction({
  start,
  translationY,
  windowHeight,
  min,
  max,
}: {
  start: number;
  translationY: number;
  windowHeight: number;
  min: number;
  max: number;
}): number {
  'worklet';
  return clampFraction(start - translationY / windowHeight, min, max);
}

export function nearestDetent(fraction: number, detents: readonly number[]): number {
  'worklet';
  let best = detents[0];
  for (const detent of detents) {
    if (Math.abs(detent - fraction) < Math.abs(best - fraction)) best = detent;
  }
  return best;
}

/**
 * Where the pane goes when the finger lifts. It closes only on a downward
 * fling or when dragged below the minimum; otherwise it snaps to the detent
 * nearest the release height. An upward fling never closes it.
 */
export function releaseTarget({
  start,
  translationY,
  velocityY,
  windowHeight,
  detents,
  min,
  dismissVelocity,
}: {
  start: number;
  translationY: number;
  velocityY: number;
  windowHeight: number;
  detents: readonly number[];
  min: number;
  dismissVelocity: number;
}): Release {
  'worklet';
  const released = start - translationY / windowHeight;
  if (velocityY > dismissVelocity || released < min) return { kind: 'close' };
  return { kind: 'snap', fraction: nearestDetent(released, detents) };
}
