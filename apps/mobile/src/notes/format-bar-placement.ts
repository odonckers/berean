// Where the Write view's formatting bar goes (guide §7.1, Lumen on spec
// question 6), kept free of React Native so Node can test it. Android
// tells us nothing about a hardware keyboard, so it's inferred: the body
// holding focus with no soft keyboard up is typed on with one.

/** Above the soft keyboard, docked at the editor's bottom, or not shown. */
export type FormatBarPlacement = 'keyboard' | 'docked' | 'hidden';

export type FormatBarState = {
  /** In Write, with the note there. */
  writing: boolean;
  /** The body field has focus: the bar is the body's, not the title's. */
  bodyFocused: boolean;
  /** The soft keyboard's height, 0 while it's closed. */
  keyboardHeight: number;
};

export function formatBarPlacement({ writing, bodyFocused, keyboardHeight }: FormatBarState): FormatBarPlacement {
  if (!writing || !bodyFocused) return 'hidden';
  return keyboardHeight > 0 ? 'keyboard' : 'docked';
}

export type FormatBarFrame = {
  placement: FormatBarPlacement;
  /** How far the keyboard's top is from the window's bottom (keyboardBottom in palette-frame.ts). */
  keyboardFromWindowBottom: number;
  /** How far the editor's bottom edge is from the window's bottom: a tab bar or the navigation bar below it. */
  bodyGapFromWindowBottom: number;
  /** The bar's offset docked at the editor's bottom, over the system bars. */
  dockedInset: number;
};

/**
 * The tools' `bottom` inside the editor. The keyboard is measured from the
 * window's bottom but the editor may end above it (Android's native tab bar
 * and navigation bar), so whatever lies below the editor comes off; a
 * keyboard shorter than that leaves the bar at the editor's bottom.
 */
export function formatBarBottom({
  placement,
  keyboardFromWindowBottom,
  bodyGapFromWindowBottom,
  dockedInset,
}: FormatBarFrame): number {
  switch (placement) {
    case 'keyboard':
      return Math.max(0, keyboardFromWindowBottom - bodyGapFromWindowBottom);
    case 'docked':
      return dockedInset;
    case 'hidden':
      return 0;
  }
}

export type ScrollFrameState = {
  /** In Write, rather than Read. */
  writing: boolean;
  placement: FormatBarPlacement;
  /** formatBarBottom's answer. */
  toolsBottom: number;
  /** The suggestion and the bar together, as laid out. */
  toolsHeight: number;
  /** The safe area's bottom inset. */
  bottomInset: number;
  /** Room after the last line in Write, and in Read. */
  writeEnd: number;
  readEnd: number;
};

export type ScrollFrame = {
  /** How far above the editor's bottom the scroll view's frame ends. */
  frameBottom: number;
  /** The content's own padding below the last line. */
  paddingBottom: number;
};

/**
 * With the tools up, the scroll view ends at their top instead of padding
 * under them: scrolling to the caret only keeps it inside the scroll
 * view's bounds, so bounds running behind the bar (and the keyboard,
 * Android being edge to edge) let the caret's line hide there.
 */
export function scrollFrame({
  writing,
  placement,
  toolsBottom,
  toolsHeight,
  bottomInset,
  writeEnd,
  readEnd,
}: ScrollFrameState): ScrollFrame {
  if (!writing) return { frameBottom: 0, paddingBottom: bottomInset + readEnd };
  if (placement === 'hidden') return { frameBottom: 0, paddingBottom: bottomInset + writeEnd };
  return { frameBottom: toolsBottom + toolsHeight, paddingBottom: writeEnd };
}

export type CaretReveal = {
  /** The caret's line, in the scroll content's coordinates. */
  caretTop: number;
  caretBottom: number;
  /** The scroll view's offset and the height of its frame. */
  scrollY: number;
  viewportHeight: number;
  /** Room kept between the line and the frame's edge. */
  margin: number;
};

/**
 * Where to scroll so the caret's line shows: just above the frame's bottom
 * if it's below it, at the top (less the margin) if it's above. Undefined
 * while the whole line is in view.
 */
export function caretRevealOffset({ caretTop, caretBottom, scrollY, viewportHeight, margin }: CaretReveal): number | undefined {
  if (caretTop < scrollY) return Math.max(0, caretTop - margin);
  if (caretBottom > scrollY + viewportHeight) return Math.max(0, caretBottom + margin - viewportHeight);
  return undefined;
}
