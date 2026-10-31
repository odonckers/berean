import { useEffect, useState } from 'react';
import { Keyboard, Platform, useWindowDimensions } from 'react-native';

import { shownKeyboardHeight } from '@/design/shown-keyboard';

// The height of the open keyboard, 0 while it's closed. Android sends only
// the did-show/did-hide events; iOS sends will-* as well, and listening to
// will-* there moves the layout with the keyboard instead of after it.
// The height means different things per platform: on Android it excludes
// the bottom system bar (ReactRootView.checkForKeyboardEvents reports
// imeInsets.bottom minus systemBars().bottom); on iOS it's the keyboard's
// full height from the screen bottom, home indicator inset included. Combine
// it with the bottom inset through keyboardBottom in palette-frame.ts.
// On Android the IME inset can stay visible with no keyboard drawn (a
// hardware keyboard attached, the input view hidden but the IME window
// kept), so the height goes through shownKeyboardHeight there.
export function useKeyboardHeight(): number {
  const { height: windowHeight } = useWindowDimensions();
  const [height, setHeight] = useState(() => Keyboard.metrics()?.height ?? 0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    const willShow = Keyboard.addListener('keyboardWillShow', (e) =>
      setHeight(e.endCoordinates.height),
    );
    const willHide = Keyboard.addListener('keyboardWillHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
      willShow.remove();
      willHide.remove();
    };
  }, []);
  return Platform.OS === 'android' ? shownKeyboardHeight(height, windowHeight) : height;
}
