import { requireOptionalNativeModule } from 'expo';
import { useEffect } from 'react';

type NavigationBarStyle = 'dark' | 'light';

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
