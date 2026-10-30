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
  setFocusRing(color: string, widthDp: number): Promise<void>;
  followFocusRingIn(viewTag: number): Promise<void>;
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
 * Android's keyboard focus indicator: instead of the platform's grey fill,
 * the view focused from a hardware keyboard (Enter, Tab, arrows) gets a
 * ring of `color` (#RRGGBB), `widthDp` wide, with no fill. It isn't shown
 * after a touch. Mounted once at the root, with the theme's ring.
 */
export function useKeyboardFocusRing(color: string, widthDp: number) {
  useEffect(() => {
    BereanShortcuts?.setFocusRing(color, widthDp).catch(() => {});
  }, [color, widthDp]);
}

/**
 * Gives the window holding this view the keyboard focus ring too, until it
 * closes. A Modal is its own window, which the root's ring never sees. Call
 * it from the view's onFocus with `e.nativeEvent.target`.
 */
export function followFocusRingIn(viewTag: number) {
  BereanShortcuts?.followFocusRingIn(viewTag).catch(() => {});
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
