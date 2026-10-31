// The soft keyboard's height as drawn, kept free of React Native so Node can
// test it. With a hardware keyboard attached and show_ime_with_hard_keyboard
// off, Android's IME hides its input view but keeps its window, and the IME
// inset stays visible at nearly the window's height (RN's
// checkForKeyboardEvents reported 842 of a 914 window, and no hide after).
// Nothing is drawn there, so an inset leaving no usable room above it is no
// soft keyboard at all.
export const MAX_KEYBOARD_SHARE = 0.75;

/** The reported height, or 0 when it covers more of the window than a keyboard can. */
export function shownKeyboardHeight(reported: number, windowHeight: number): number {
  return reported > windowHeight * MAX_KEYBOARD_SHARE ? 0 : reported;
}
