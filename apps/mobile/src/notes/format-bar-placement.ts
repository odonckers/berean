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
