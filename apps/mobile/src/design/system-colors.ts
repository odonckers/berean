// Android's Material You "System colors" accent and its contrast guard
// (themes spec §11, §12.2), and when Android's contrast setting counts as
// Increase Contrast (§12.1, open item 2). Pure, so Node can test it; the
// readings come from modules/berean-system-colors through theme.tsx.

import { contrast } from './contrast.ts';
import { themeTokens, type ThemeId, type ThemeMode } from './theme-tokens.generated.ts';

/** The wallpaper palette's roles for one scheme, each #RRGGBB (§12.4). */
export type SystemColors = {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  secondaryContainer: string;
};

/** The floors the palette has to clear against the theme set (§11), standard and IC. */
export const SYSTEM_COLORS_FLOORS = {
  /** primary on background, surface and surfaceRaised: buttons, rings and the focus ring. */
  primaryOnPage: { standard: 3, increased: 4.5 },
  /** onPrimary on primary: labels on filled buttons. */
  onPrimary: { standard: 4.5, increased: 7 },
  /** onPrimaryContainer on primaryContainer. */
  onPrimaryContainer: { standard: 4.5, increased: 4.5 },
  /**
   * The theme's onSecondaryContainer on the system secondaryContainer: the
   * navigation indicator mixes the two palettes, so its label is checked
   * too. Not in §11's list; ink on M3's tone 100 / 700 always clears it, so
   * it only catches a broken palette.
   */
  onSecondaryContainer: { standard: 4.5, increased: 4.5 },
} as const;

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Whether the system palette may replace the accent in this theme set
 * (§11): every pair clears its floor (SYSTEM_COLORS_FLOORS, the IC column
 * in the IC sets). A malformed value fails. When it fails the app uses
 * slot 1 and the option says "Not enough contrast with this theme".
 */
export function systemColorsPass(theme: ThemeId, mode: ThemeMode, system: SystemColors): boolean {
  const values = [
    system.primary,
    system.onPrimary,
    system.primaryContainer,
    system.onPrimaryContainer,
    system.secondaryContainer,
  ];
  if (!values.every((value) => typeof value === 'string' && HEX.test(value))) return false;
  const { roles } = themeTokens[theme].modes[mode];
  const { onSecondaryContainer } = themeTokens[theme].material3[mode];
  const level = mode === 'lightIC' || mode === 'darkIC' ? 'increased' : 'standard';
  const floors = SYSTEM_COLORS_FLOORS;
  return (
    [roles.background, roles.surface, roles.surfaceRaised].every(
      (page) => contrast(system.primary, page) >= floors.primaryOnPage[level],
    ) &&
    contrast(system.onPrimary, system.primary) >= floors.onPrimary[level] &&
    contrast(system.onPrimaryContainer, system.primaryContainer) >= floors.onPrimaryContainer[level] &&
    contrast(onSecondaryContainer, system.secondaryContainer) >= floors.onSecondaryContainer[level]
  );
}

/** What the Accent row shows for System colors: its swatch and whether the guard passes. */
export type SystemAccentOption = { swatch: string; onSwatch: string; contrastOk: boolean };

/** The System colors option in a theme set; null when there is no palette to offer. */
export function systemAccentOption(
  theme: ThemeId,
  mode: ThemeMode,
  system: SystemColors | null,
): SystemAccentOption | null {
  if (!system) return null;
  return { swatch: system.primary, onSwatch: system.onPrimary, contrastOk: systemColorsPass(theme, mode, system) };
}

/**
 * The Android contrast level (UiModeManager.getContrast(), -1 to 1, 0 is
 * standard) at and above which the app uses its Increase Contrast sets.
 *
 * 0.5 is Android 14's "Medium" contrast. We have one raised step (the IC
 * sets), not two, so Medium and High both get it: someone who asked the
 * system for more contrast gets more, rather than nothing until High.
 * Below Android 14 the module reports High contrast text as 1 (§12.4).
 */
export const ANDROID_INCREASE_CONTRAST_AT = 0.5;

/** Whether Android's contrast level counts as Increase Contrast; off when unknown. */
export function androidIncreaseContrast(level: number | null | undefined): boolean {
  return typeof level === 'number' && Number.isFinite(level) && level >= ANDROID_INCREASE_CONTRAST_AT;
}
