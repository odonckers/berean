type Insets = { top: number; bottom: number; left: number; right: number };

export type PaletteFrame = {
  paddingTop: number;
  paddingBottom: number;
  paddingStart: number;
  paddingEnd: number;
  /** The dialog's height cap, footer included. */
  maxHeight: number;
};

// How much of the window's bottom the keyboard and the system bars cover,
// given the keyboard height React Native reports (0 while it's closed). The
// platforms report it differently: on Android it excludes the bottom system
// bar (ReactRootView.checkForKeyboardEvents sends imeInsets.bottom minus
// systemBars().bottom), so the navigation bar adds to it; on iOS it's the
// keyboard's full height from the screen bottom, which already covers the
// home indicator inset, so the larger of the two wins. Callers pass
// `excludesBottomBar` as Platform.OS === 'android'.
export function keyboardBottom(
  keyboardHeight: number,
  bottomInset: number,
  excludesBottomBar: boolean,
): number {
  if (keyboardHeight <= 0) return bottomInset;
  return excludesBottomBar ? bottomInset + keyboardHeight : Math.max(bottomInset, keyboardHeight);
}

// Where the search palette may sit in a window of `height`: inside the
// system bars, above the keyboard, with `margin` clear on every side; see
// keyboardBottom for how the keyboard height meets the bottom inset on each
// platform. Pure, so the Node tests can import it without React Native.
export function paletteFrame(
  height: number,
  insets: Insets,
  keyboardHeight: number,
  keyboardExcludesBottomBar: boolean,
  margin: number,
): PaletteFrame {
  const paddingTop = insets.top + margin;
  const paddingBottom =
    keyboardBottom(keyboardHeight, insets.bottom, keyboardExcludesBottomBar) + margin;
  return {
    paddingTop,
    paddingBottom,
    paddingStart: insets.left + margin,
    paddingEnd: insets.right + margin,
    maxHeight: Math.max(0, height - paddingTop - paddingBottom),
  };
}
