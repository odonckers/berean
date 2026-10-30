import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

// The height of the open keyboard, 0 while it's closed. Android sends only
// the did-show/did-hide events; iOS sends will-* as well, and listening to
// will-* there moves the layout with the keyboard instead of after it.
// The height means different things per platform: on Android it excludes
// the bottom system bar (ReactRootView.checkForKeyboardEvents reports
// imeInsets.bottom minus systemBars().bottom); on iOS it's the keyboard's
// full height from the screen bottom, home indicator inset included. Combine
// it with the bottom inset through keyboardBottom in palette-frame.ts.
export function useKeyboardHeight(): number {
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
  return height;
}
