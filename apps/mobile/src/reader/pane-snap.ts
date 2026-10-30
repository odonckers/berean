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

/**
 * The tallest the pane may be, as a window fraction: from its top down to
 * the bottom of the chapter's visible area (above the tab bar and the
 * bottom inset), so its bottom never runs under them. All in the viewport's
 * coordinates: paneTop from the top of the visible area, visibleHeight that
 * area's height. It stays within [min, max]: a pane low in the viewport can
 * still be dragged to the minimum.
 */
export function paneMaxFraction({
  paneTop,
  visibleHeight,
  windowHeight,
  min,
  max,
}: {
  paneTop: number;
  visibleHeight: number;
  windowHeight: number;
  min: number;
  max: number;
}): number {
  'worklet';
  if (windowHeight <= 0 || visibleHeight <= 0) return max;
  return clampFraction((visibleHeight - paneTop) / windowHeight, min, max);
}

/**
 * The detents under a cap: those below it, then the cap itself as the
 * top stop, so a release past the cap settles at it.
 */
export function cappedDetents(detents: readonly number[], cap: number): number[] {
  'worklet';
  const under = detents.filter((detent) => detent < cap);
  under.push(cap);
  return under;
}

/**
 * An empty pane's detents: its own short height (the one line and My
 * notes), then the usual detents above it.
 */
export function emptyDetents(short: number, detents: readonly number[]): number[] {
  'worklet';
  return [short, ...detents.filter((detent) => detent > short)];
}

/**
 * An empty pane's short height (spec §4): its header, its body (the one
 * line with the body's padding) and My notes, inside its border, as a
 * window fraction. Undefined until all three parts have laid out.
 */
export function emptyFraction({
  header,
  body,
  footer,
  border,
  windowHeight,
}: {
  header?: number;
  body?: number;
  footer?: number;
  border: number;
  windowHeight: number;
}): number | undefined {
  if (header === undefined || body === undefined || footer === undefined) return undefined;
  if (windowHeight <= 0) return undefined;
  return (header + body + footer + 2 * border) / windowHeight;
}

// Spec §5: opening a verse in the bottom 35% of the viewport scrolls it to
// about 20% from the top so the pane fits.
export const SCROLL_ZONE = 0.65;
export const SCROLL_TARGET = 0.2;

/**
 * How an opening pane fits (spec §5): how far the reader scrolls, in the
 * same animation, and the height the pane opens at. All in pixels from the
 * top of the visible area (below the top inset or app bar): verseTop is the
 * selected verse's first line, paneTop the pane's top, visibleHeight the
 * area down to the tab bar.
 *
 * A verse in the bottom 35% scrolls to about 20% from the top. Otherwise
 * the reader scrolls only as far as the pane needs to fit above the tab
 * bar, and never past that 20%. A pane that still doesn't fit opens
 * shorter, down to `lowest`; if not even that fits, the reader scrolls on
 * until the verse's top reaches the top of the visible area, never above.
 */
export function openFit({
  verseTop,
  paneTop,
  visibleHeight,
  windowHeight,
  wanted,
  lowest,
}: {
  verseTop: number;
  paneTop: number;
  visibleHeight: number;
  windowHeight: number;
  /** The height the pane would open at, as a window fraction. */
  wanted: number;
  /** The lowest it may open at, as a window fraction. */
  lowest: number;
}): { scrollBy: number; fraction: number } {
  if (windowHeight <= 0 || visibleHeight <= 0) return { scrollBy: 0, fraction: wanted };
  const toTarget = Math.max(verseTop - visibleHeight * SCROLL_TARGET, 0);
  const overflow = paneTop + wanted * windowHeight - visibleHeight;
  let scrollBy =
    verseTop > visibleHeight * SCROLL_ZONE ? toTarget : clampFraction(overflow, 0, toTarget);
  let room = visibleHeight - (paneTop - scrollBy);
  const short = lowest * windowHeight - room;
  if (short > 0) {
    const extra = Math.min(short, Math.max(verseTop - scrollBy, 0));
    scrollBy += extra;
    room += extra;
  }
  return { scrollBy, fraction: clampFraction(room / windowHeight, lowest, wanted) };
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
