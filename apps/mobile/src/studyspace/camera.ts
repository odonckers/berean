// The Studyspace camera's maths (findings §3): zoom limits by device,
// clamping, the log-space rubber band, zoom about a focal point, screen to
// canvas and back, fit-all, restoring a saved camera, the double-tap
// toggle, pinch detents, zoom steps and pan inertia. Pure and free of React
// Native so `node --test` can run it; every function is a worklet so the
// canvas's gestures call it on the UI thread, and none reads a module
// constant in a default parameter, which the worklets plugin doesn't
// capture (worklets.test.ts checks both).
//
// A camera is the core's Viewport: x, y is the canvas point at the CENTRE
// of the view, zoom 1 is 100%. Frames are canvas points at zoom 1, x, y
// their top-left corner. world = centre + (screen − view / 2) / zoom.

export type Camera = { x: number; y: number; zoom: number };
export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };

export type DeviceClass = 'phone' | 'tablet';
export type ZoomLimits = { min: number; max: number; fitFloor: number };

/** Below this shortest window side (dp/pt), a phone (§3.1, §8). */
export const PHONE_SHORTEST_SIDE = 600;

const PHONE_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const;
const TABLET_STEPS = [...PHONE_STEPS, 6, 8] as const;

/** The rubber band's reach, in octaves of zoom (§3.4). */
export const RUBBER_BAND_OCTAVES = 0.5;
const RUBBER_BAND_STIFFNESS = 0.55;

/** A pinch released this close to 100% or fit-all (|ln z/detent|) eases there (§3.3). */
export const DETENT_WINDOW = 0.05;

/** UIKit's normal deceleration, per ms: the iOS look's pan inertia (§3.5). */
export const IOS_DECAY = 0.998;
/** React Native's Android mapping of the native fling, per ms (§3.5). */
export const ANDROID_DECAY = 0.985;
/** Inertia stops once the fling is slower than this, in pt/s. */
const REST_SPEED = 10;

export function deviceClass(window: Size): DeviceClass {
  'worklet';
  return Math.min(window.width, window.height) < PHONE_SHORTEST_SIDE ? 'phone' : 'tablet';
}

/** §3.1: 10% to 400% on a phone, 10% to 800% on a tablet; only fit-all goes to 2%. */
export function zoomLimits(device: DeviceClass): ZoomLimits {
  'worklet';
  return { min: 0.1, max: device === 'phone' ? 4 : 8, fitFloor: 0.02 };
}

/** The ⌘+ / ⌘− and zoom-stack steps (§3.1). */
export function zoomSteps(device: DeviceClass): readonly number[] {
  'worklet';
  return device === 'phone' ? PHONE_STEPS : TABLET_STEPS;
}

export function clamp(value: number, min: number, max: number): number {
  'worklet';
  return Math.min(Math.max(value, min), max);
}

/** Zoom held to the gesture range [min, max]. */
export function clampZoom(zoom: number, limits: ZoomLimits): number {
  'worklet';
  return clamp(zoom, limits.min, limits.max);
}

export function toLog2(zoom: number): number {
  'worklet';
  return Math.log2(zoom);
}

export function fromLog2(octaves: number): number {
  'worklet';
  return Math.pow(2, octaves);
}

/** Zoom `t` of the way from `a` to `b`, in log space. */
export function lerpZoom(a: number, b: number, t: number): number {
  'worklet';
  return fromLog2(toLog2(a) + (toLog2(b) - toLog2(a)) * t);
}

/**
 * The shown overshoot, in octaves, for a finger overshoot of `x` octaves:
 * (1 − 1 / (x · 0.55 / d + 1)) · d, d = RUBBER_BAND_OCTAVES. It never reaches d.
 */
export function rubberBandOvershoot(x: number): number {
  'worklet';
  // Read in the body, not as a default parameter: the worklets plugin
  // captures only what a worklet's body reads (worklets.test.ts).
  const d = RUBBER_BAND_OCTAVES;
  return (1 - 1 / ((x * RUBBER_BAND_STIFFNESS) / d + 1)) * d;
}

/**
 * The zoom shown for the zoom the fingers imply: itself inside [min, max],
 * rubber-banded in log2 past either end (§3.4).
 */
export function rubberBandZoom(fingerZoom: number, min: number, max: number): number {
  'worklet';
  if (fingerZoom > max) return max * fromLog2(rubberBandOvershoot(toLog2(fingerZoom / max)));
  if (fingerZoom < min) return min / fromLog2(rubberBandOvershoot(toLog2(min / fingerZoom)));
  return fingerZoom;
}

/**
 * The range a pinch works in. A camera already outside the gesture range
 * (fit-all below 10%, or a restore) is its own end, so the pinch neither
 * jumps nor bands from where it starts.
 */
export function gestureRange(limits: ZoomLimits, startZoom: number): { min: number; max: number } {
  'worklet';
  return { min: Math.min(limits.min, startZoom), max: Math.max(limits.max, startZoom) };
}

/** The canvas point under screen point `screen` (relative to the view's top-left). */
export function screenToCanvas(camera: Camera, view: Size, screen: Point): Point {
  'worklet';
  return {
    x: camera.x + (screen.x - view.width / 2) / camera.zoom,
    y: camera.y + (screen.y - view.height / 2) / camera.zoom,
  };
}

/** Where canvas point `canvas` is on screen. */
export function canvasToScreen(camera: Camera, view: Size, canvas: Point): Point {
  'worklet';
  return {
    x: (canvas.x - camera.x) * camera.zoom + view.width / 2,
    y: (canvas.y - camera.y) * camera.zoom + view.height / 2,
  };
}

/**
 * The camera at `zoom` that keeps canvas point `canvas` under screen point
 * `screen`: the focal-point rule for pinch and the double tap.
 */
export function cameraAbout(canvas: Point, screen: Point, zoom: number, view: Size): Camera {
  'worklet';
  return {
    x: canvas.x - (screen.x - view.width / 2) / zoom,
    y: canvas.y - (screen.y - view.height / 2) / zoom,
    zoom,
  };
}

/** `camera` zoomed to `zoom` about screen point `focal`, which stays put. */
export function zoomAbout(camera: Camera, view: Size, focal: Point, zoom: number): Camera {
  'worklet';
  return cameraAbout(screenToCanvas(camera, view, focal), focal, zoom, view);
}

/**
 * The content layer's transform (origin top-left), for a layer whose
 * top-left is canvas point `origin`: screen = translate + zoom · (canvas − origin).
 */
export function contentTransform(
  camera: Camera,
  view: Size,
  origin: Point,
): { translateX: number; translateY: number; scale: number } {
  'worklet';
  return {
    translateX: view.width / 2 + (origin.x - camera.x) * camera.zoom,
    translateY: view.height / 2 + (origin.y - camera.y) * camera.zoom,
    scale: camera.zoom,
  };
}

/**
 * The content layer's own box in canvas points: around every frame, so
 * Android's accessibility bounds and hit-testing, which clip a child to its
 * parent's untransformed box, see whole cards. A 1 × 1 box at (0,0) for none.
 */
export function layerBox(frames: readonly Rect[]): Rect {
  'worklet';
  return contentBounds(frames) ?? { x: 0, y: 0, width: 1, height: 1 };
}

/** The box around every frame; undefined for none. */
export function contentBounds(frames: readonly Rect[]): Rect | undefined {
  'worklet';
  if (frames.length === 0) return undefined;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const f of frames) {
    left = Math.min(left, f.x);
    top = Math.min(top, f.y);
    right = Math.max(right, f.x + f.width);
    bottom = Math.max(bottom, f.y + f.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Fit-all's screen margin on each side: tldraw's 128 px, capped at 28% of
 * the view's width, split over both sides.
 */
export function fitPadding(view: Size): number {
  'worklet';
  return Math.min(128, view.width * 0.28) / 2;
}

/**
 * The camera that frames every card with `padding` screen points around
 * them, its zoom held to [2%, max]. An empty workspace opens at (0,0), 100%.
 */
export function fitAll(frames: readonly Rect[], view: Size, padding: number, limits: ZoomLimits): Camera {
  'worklet';
  const bounds = contentBounds(frames);
  if (bounds === undefined) return { x: 0, y: 0, zoom: 1 };
  const room = { width: view.width - 2 * padding, height: view.height - 2 * padding };
  const fits =
    room.width > 0 && room.height > 0 && bounds.width > 0 && bounds.height > 0
      ? Math.min(room.width / bounds.width, room.height / bounds.height)
      : 1;
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
    zoom: clamp(fits, limits.fitFloor, limits.max),
  };
}

function finiteCamera(camera: Camera): boolean {
  'worklet';
  return Number.isFinite(camera.x) && Number.isFinite(camera.y) && Number.isFinite(camera.zoom) && camera.zoom > 0;
}

/**
 * The camera a workspace opens at (§7.3): its saved one with the zoom held
 * to this device's range (a saved fit-all may stay down to 2%), or fit-all
 * the first time.
 */
export function restoreCamera(
  saved: Camera | undefined,
  frames: readonly Rect[],
  view: Size,
  limits: ZoomLimits,
): Camera {
  'worklet';
  if (saved === undefined || !finiteCamera(saved)) return fitAll(frames, view, fitPadding(view), limits);
  return { x: saved.x, y: saved.y, zoom: clamp(saved.zoom, limits.fitFloor, limits.max) };
}

/** Whether `zoom` is within the detent window of `detent`. */
export function nearZoom(zoom: number, detent: number): boolean {
  'worklet';
  return Math.abs(Math.log(zoom / detent)) <= DETENT_WINDOW;
}

/**
 * Double tap on empty canvas (§3.2): at 100%, fit-all; anywhere else, 100%
 * with the tapped point staying under the finger.
 */
export function doubleTapTarget(camera: Camera, view: Size, tap: Point, fit: Camera): Camera {
  'worklet';
  if (nearZoom(camera.zoom, 1)) return fit;
  return zoomAbout(camera, view, tap, 1);
}

/**
 * Where a released pinch settles (§3.3, §3.4): back inside [min, max] if it
 * was rubber-banding; onto 100% or fit-all if it is inside their detent
 * window; otherwise exactly where it is.
 */
export function settleZoom(zoom: number, range: { min: number; max: number }, fitZoom: number): number {
  'worklet';
  if (zoom > range.max) return range.max;
  if (zoom < range.min) return range.min;
  if (nearZoom(zoom, 1)) return 1;
  if (nearZoom(zoom, fitZoom)) return fitZoom;
  return zoom;
}

/**
 * The next zoom step in `direction` (§3.1): snap `zoom` to its nearest step
 * in log space (so the boundaries are the log-space midpoints), then move
 * one step, stopping at either end.
 */
export function nextZoomStep(zoom: number, direction: 1 | -1, steps: readonly number[]): number {
  'worklet';
  let nearest = 0;
  for (let i = 1; i < steps.length; i++) {
    if (Math.abs(Math.log(zoom / steps[i])) < Math.abs(Math.log(zoom / steps[nearest]))) nearest = i;
  }
  return steps[clamp(nearest + direction, 0, steps.length - 1)];
}

/**
 * A fling's glide (§3.5), v(t) = v0 · rate^t with t in ms: how far it goes
 * in screen points and how long until it is slower than REST_SPEED. The
 * distance over the whole run is projectedRest(v) = (v / 1000) · r / (1 − r)
 * in the limit; this stops at `duration`, so it travels a little less.
 */
export function inertia(velocity: number, rate: number): { distance: number; duration: number } {
  'worklet';
  const speed = Math.abs(velocity);
  if (speed <= REST_SPEED) return { distance: 0, duration: 0 };
  const lnRate = Math.log(rate);
  const duration = Math.log(REST_SPEED / speed) / lnRate;
  const distance = ((velocity / 1000) * (Math.pow(rate, duration) - 1)) / lnRate;
  return { distance, duration };
}

/** The total glide of a fling that is never cut short: (v / 1000) · r / (1 − r). */
export function projectedRest(velocity: number, rate: number): number {
  'worklet';
  return ((velocity / 1000) * rate) / (1 - rate);
}

/**
 * The fraction of an inertia glide covered at progress u (0 to 1) of its
 * duration: the easing that makes a timing animation follow v0 · rate^t.
 */
export function inertiaProgress(u: number, rate: number, duration: number): number {
  'worklet';
  if (duration <= 0) return 1;
  return (1 - Math.pow(rate, u * duration)) / (1 - Math.pow(rate, duration));
}

/**
 * The camera `t` of the way from `from` to `to`: zoom in log space; with a
 * `focal` screen point the canvas point under it at `from` stays put,
 * otherwise the centre moves in a straight line.
 */
export function cameraBetween(from: Camera, to: Camera, t: number, view: Size, focal?: Point): Camera {
  'worklet';
  const zoom = lerpZoom(from.zoom, to.zoom, t);
  if (focal !== undefined) return zoomAbout(from, view, focal, zoom);
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, zoom };
}

/** Whether canvas point `canvas` is on one of `frames`. */
export function hitsFrame(frames: readonly Rect[], canvas: Point): boolean {
  'worklet';
  for (const f of frames) {
    if (canvas.x >= f.x && canvas.x <= f.x + f.width && canvas.y >= f.y && canvas.y <= f.y + f.height) return true;
  }
  return false;
}
