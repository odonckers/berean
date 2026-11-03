import { requireOptionalNativeModule } from 'expo';
import type { EventSubscription } from 'react-native';

/** The wallpaper palette's Material 3 roles, each #RRGGBB (themes spec §12.4). */
export type SystemColors = {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  secondaryContainer: string;
};

type BereanSystemColorsModule = {
  addListener(name: 'onChange', listener: () => void): EventSubscription;
  isAvailable(): boolean;
  getSystemColors(scheme: 'light' | 'dark'): SystemColors | null;
  getContrast(): number;
};

// Android only; null on iOS and web, where there are no system colors and
// Increase Contrast comes from AccessibilityInfo instead.
const BereanSystemColors = requireOptionalNativeModule<BereanSystemColorsModule>('BereanSystemColors');

/** Android 12 (API 31) and later, with the module built in. */
export function systemColorsAvailable(): boolean {
  return BereanSystemColors?.isAvailable() ?? false;
}

/** The wallpaper palette for a scheme; null where it isn't available. */
export function getSystemColors(scheme: 'light' | 'dark'): SystemColors | null {
  return BereanSystemColors?.getSystemColors(scheme) ?? null;
}

/**
 * The system contrast level, -1 to 1 with 0 standard: UiModeManager's on
 * Android 14 and later; below that, 1 when High contrast text is on, else
 * 0. Null without the module (iOS, web).
 */
export function getContrast(): number | null {
  return BereanSystemColors?.getContrast() ?? null;
}

/**
 * Calls `listener` when the palette or the contrast level may have changed
 * (the app returned to the foreground, a configuration change, the contrast
 * setting). Read both again then. Undefined without the module.
 */
export function addSystemColorsListener(listener: () => void): EventSubscription | undefined {
  return BereanSystemColors?.addListener('onChange', listener);
}
