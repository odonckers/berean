import { requireOptionalNativeModule } from 'expo';
import { useEffect, useRef } from 'react';
import type { EventSubscription } from 'react-native';

type ShortcutEvent = { key: 'k' };

type BereanShortcutsModule = {
  addListener(name: 'onShortcut', listener: (event: ShortcutEvent) => void): EventSubscription;
};

// Android only for now; null on iOS and web, so the hook is a no-op there.
// TODO(iOS): Cmd+K through UIKeyCommand.
const BereanShortcuts = requireOptionalNativeModule<BereanShortcutsModule>('BereanShortcuts');

// Calls `callback` when Ctrl+K (or Meta+K) is pressed on a hardware keyboard.
export function useSearchShortcut(callback: () => void) {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    const subscription = BereanShortcuts?.addListener('onShortcut', (event) => {
      if (event.key === 'k') callbackRef.current();
    });
    return () => subscription?.remove();
  }, []);
}
