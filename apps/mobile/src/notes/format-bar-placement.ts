// Where the Write view's formatting bar goes (guide §7.1, Lumen on spec
// question 6), kept free of React Native so Node can test it. Android
// tells us nothing about a hardware keyboard, so it's inferred: a Write
// field holding focus with no soft keyboard up is typed on with one.

/** Above the soft keyboard, docked at the editor's bottom, or not shown. */
export type FormatBarPlacement = 'keyboard' | 'docked' | 'hidden';

export type FormatBarState = {
  /** In Write, with the note there. */
  writing: boolean;
  /** The title or the body field has focus. */
  fieldFocused: boolean;
  /** The soft keyboard's height, 0 while it's closed. */
  keyboardHeight: number;
  /** With no field focused and no keyboard: 'show' keeps the bar docked. */
  whenKeyboardClosed: 'hide' | 'show';
};

export function formatBarPlacement({
  writing,
  fieldFocused,
  keyboardHeight,
  whenKeyboardClosed,
}: FormatBarState): FormatBarPlacement {
  if (!writing) return 'hidden';
  if (keyboardHeight > 0) return 'keyboard';
  if (fieldFocused || whenKeyboardClosed === 'show') return 'docked';
  return 'hidden';
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
