type Insets = { top: number; bottom: number; left: number; right: number };

export type PaletteFrame = {
  paddingTop: number;
  paddingBottom: number;
  paddingStart: number;
  paddingEnd: number;
  /** The dialog's height cap, footer included. */
  maxHeight: number;
};

// Where the search palette may sit in a window of `height`: inside the
// system bars, above the keyboard, with `margin` clear on every side. The
// keyboard covers the navigation bar where it's open, so the bottom keeps
// whichever reaches higher. Pure, so the Node tests can import it without
// React Native.
export function paletteFrame(
  height: number,
  insets: Insets,
  keyboardHeight: number,
  margin: number,
): PaletteFrame {
  const paddingTop = insets.top + margin;
  const paddingBottom = Math.max(insets.bottom, keyboardHeight) + margin;
  return {
    paddingTop,
    paddingBottom,
    paddingStart: insets.left + margin,
    paddingEnd: insets.right + margin,
    maxHeight: Math.max(0, height - paddingTop - paddingBottom),
  };
}
