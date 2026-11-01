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
  /** The editor's height and the tools' (their clearance above included), as laid out; 0 or absent while unknown. */
  bodyHeight?: number;
  toolsHeight?: number;
};

/** The least the Write scroll view keeps above the tools, or the whole body if it's shorter. */
export const MIN_WRITE_SCROLL_HEIGHT = 120;

const minScrollHeight = (bodyHeight: number) => Math.min(MIN_WRITE_SCROLL_HEIGHT, bodyHeight);

/**
 * The room below the tools inside the editor. The keyboard is measured
 * from the window's bottom but the editor may end above it (Android's
 * native tab bar and navigation bar), so whatever lies below it comes off; a
 * keyboard shorter than that leaves the bar at the editor's bottom. Never
 * so high the tools leave the body or the scroll view less than its
 * minimum above them, whatever height the keyboard reports.
 */
export function formatBarBottom(frame: FormatBarFrame): number {
  const { bodyHeight = 0, toolsHeight = 0 } = frame;
  const bottom = placedBottom(frame);
  if (bodyHeight <= 0) return bottom;
  return Math.min(bottom, Math.max(0, bodyHeight - toolsHeight - minScrollHeight(bodyHeight)));
}

function placedBottom({ placement, keyboardFromWindowBottom, bodyGapFromWindowBottom, dockedInset }: FormatBarFrame): number {
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
  /** The safe area's bottom inset. */
  bottomInset: number;
  /** Room after the last line in Write, and in Read. */
  writeEnd: number;
  readEnd: number;
};

export type ScrollFrame = {
  /** The content's own padding below the last line. */
  paddingBottom: number;
};

/**
 * With the tools up they follow the scroll view in the editor's flow, so
 * its frame ends above them by layout and its content pads only the room
 * after the last line; with them hidden it runs to the editor's bottom and
 * pads clear of the system bars there.
 */
export function scrollFrame({ writing, placement, bottomInset, writeEnd, readEnd }: ScrollFrameState): ScrollFrame {
  if (!writing) return { paddingBottom: bottomInset + readEnd };
  if (placement === 'hidden') return { paddingBottom: bottomInset + writeEnd };
  return { paddingBottom: writeEnd };
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
