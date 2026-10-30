import { requireOptionalNativeModule } from 'expo';
import { useEffect, useRef } from 'react';
import type { EventSubscription } from 'react-native';

type ShortcutEvent = { key: 'k' };
export type ListKey = 'up' | 'down';
type ListKeyEvent = { key: ListKey };

type BereanShortcutsModule = {
  addListener(name: 'onShortcut', listener: (event: ShortcutEvent) => void): EventSubscription;
  addListener(name: 'onListKey', listener: (event: ListKeyEvent) => void): EventSubscription;
  captureListKeys(viewTag: number): Promise<void>;
  releaseListKeys(viewTag: number): Promise<void>;
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

/**
 * Hardware Up/Down on a text field, for a list it drives. Call `capture`
 * with the field's view tag when it gains focus and `release` when it loses
 * it; while captured the arrows reach `onKey` instead of moving the cursor.
 */
export function useListKeys(onKey: (key: ListKey) => void) {
  const onKeyRef = useRef(onKey);
  useEffect(() => {
    onKeyRef.current = onKey;
  }, [onKey]);

  useEffect(() => {
    const subscription = BereanShortcuts?.addListener('onListKey', (event) => {
      onKeyRef.current(event.key);
    });
    return () => subscription?.remove();
  }, []);

  // The view may already be gone (the field unmounting), which is fine.
  return {
    capture: (viewTag: number) => BereanShortcuts?.captureListKeys(viewTag).catch(() => {}),
    release: (viewTag: number) => BereanShortcuts?.releaseListKeys(viewTag).catch(() => {}),
  };
}
