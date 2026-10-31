import { requireNativeView, requireOptionalNativeModule } from 'expo';
import { createElement, useEffect, type ComponentType } from 'react';
import { StyleSheet } from 'react-native';

export type NavigationBarStyle = 'dark' | 'light';

type BereanSystemBarsModule = {
  setNavigationBarStyle(style: NavigationBarStyle): Promise<void>;
};

// Android only; null on iOS and web, so the hook is a no-op there.
const BereanSystemBars = requireOptionalNativeModule<BereanSystemBarsModule>('BereanSystemBars');

// Sets the Android navigation bar buttons: 'dark' for a light background,
// 'light' for a dark one.
export function useNavigationBarStyle(style: NavigationBarStyle) {
  useEffect(() => {
    BereanSystemBars?.setNavigationBarStyle(style);
  }, [style]);
}

type ModalNavigationBarStyleProps = { barStyle: NavigationBarStyle };
type NativeProps = ModalNavigationBarStyleProps & {
  style: object;
  accessible: boolean;
  importantForAccessibility: 'no-hide-descendants';
};

// Looked up only where the module exists (Android): requireNativeView
// throws for a view no platform registered.
const NativeModalNavigationBarStyle: ComponentType<NativeProps> | null = BereanSystemBars
  ? requireNativeView('BereanSystemBars')
  : null;

/**
 * The navigation bar buttons for the Modal this is rendered in. A Modal is
 * its own window on Android, which useNavigationBarStyle (the activity's
 * window) never reaches, so it keeps light buttons unless styled here.
 * Zero-size and hidden from accessibility; renders nothing on iOS and web.
 */
export function ModalNavigationBarStyle({ barStyle }: ModalNavigationBarStyleProps) {
  if (NativeModalNavigationBarStyle === null) return null;
  return createElement(NativeModalNavigationBarStyle, {
    barStyle,
    style: styles.hidden,
    accessible: false,
    importantForAccessibility: 'no-hide-descendants',
  });
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', width: 0, height: 0 },
});
