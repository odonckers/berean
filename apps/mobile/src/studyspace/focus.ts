// A reader card's focus (findings §6.1): which card is focused, the view
// before the focus zoom, and whether the canvas moved since, so leaving can
// go back. Session-only, never saved (§6.6). Kept free of React Native for
// the tests.

import type { Camera } from '@/studyspace/camera';

export type Focus = {
  id: bigint;
  /** The camera before the focus zoom (preFocusViewport). */
  preFocus: Camera;
  /** The canvas was panned or zoomed while focused (moved_while_focused). */
  moved: boolean;
} | null;

/** Focus card `id`, the camera being `camera` before its focus zoom. */
export function enterFocus(id: bigint, camera: Camera): Focus {
  return { id, preFocus: camera, moved: false };
}

/**
 * A pan, pinch or double tap moved the canvas while focused. Scrolling the
 * card's text and the focus zoom itself don't count. The same state when
 * nothing changes, so it doesn't draw again.
 */
export function canvasMoved(focus: Focus): Focus {
  return focus === null || focus.moved ? focus : { ...focus, moved: true };
}

/** Where leaving focus returns the camera: the view before it, only if the canvas didn't move; else it stays. */
export function leaveFocus(focus: Focus): Camera | undefined {
  return focus === null || focus.moved ? undefined : focus.preFocus;
}

/** Said on focusing a reader card (§9): "Reading Romans 8, verse 28"; "Reading Romans 8" without a verse. */
export function readingAnnouncement(title: string, verse: number | undefined): string {
  return verse === undefined ? `Reading ${title}` : `Reading ${title}, verse ${verse}`;
}

/** Said on leaving a focused card (§9): "Left Romans 8". */
export function leftAnnouncement(title: string): string {
  return `Left ${title}`;
}

/**
 * A card's label and value for its focus. Android's BaseViewManager clears the
 * content description when accessibilityValue goes back to undefined and
 * doesn't rebuild it from the label, so there "focused" goes in the label.
 */
export function focusedLabel(
  label: string,
  focused: boolean,
  os: string,
): { accessibilityLabel: string; accessibilityValue?: { text: string } } {
  if (os === 'android') return { accessibilityLabel: focused ? `${label}, focused` : label };
  return focused ? { accessibilityLabel: label, accessibilityValue: { text: 'focused' } } : { accessibilityLabel: label };
}
