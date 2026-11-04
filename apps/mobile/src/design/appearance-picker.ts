// What Settings › Appearance shows (themes spec §3 rule 12, §5): option
// labels, what each theme swatch draws, and when the tiles become a list.
// Pure, for the Node tests.

import {
  type AppearanceSetting,
  resolveMode,
  themeName,
  type ThemeId,
} from './appearance.ts';
import { themeTokens } from './theme-tokens.generated.ts';

type Look = 'ios' | 'material';

export const THEME_HINT = 'Changes the reading colors';
export const AUTOMATIC_HINT = 'Follows the system light or dark setting';

export const APPEARANCE_NAMES: Record<AppearanceSetting, string> = {
  automatic: 'Automatic',
  light: 'Light',
  dark: 'Dark',
};

/** "Paper, theme"; the platform adds "selected" from the option's state. */
export function themeOptionLabel(theme: ThemeId): string {
  return `${themeName(theme)}, theme`;
}

/** "Terracotta, accent". */
export function accentOptionLabel(name: string): string {
  return `${name}, accent`;
}

/** Android's Material You accent (§11), listed first where it is offered. */
export const SYSTEM_COLORS_NAME = 'System colors';
export const SYSTEM_COLORS_HINT = 'From your wallpaper';
/** Shown under System colors, and spoken in its hint, when the guard fails and slot 1 is used. */
export const LOW_CONTRAST_NOTE = 'Not enough contrast with this theme';

/** "From your wallpaper", plus the low contrast note when the guard fails. */
export function systemColorsHint(contrastOk: boolean): string {
  return contrastOk ? SYSTEM_COLORS_HINT : `${SYSTEM_COLORS_HINT}. ${LOW_CONTRAST_NOTE}`;
}

/** "Automatic, appearance". */
export function appearanceOptionLabel(appearance: AppearanceSetting): string {
  return `${APPEARANCE_NAMES[appearance]}, appearance`;
}

/** Only Automatic needs saying what it does. */
export function appearanceOptionHint(appearance: AppearanceSetting): string | undefined {
  return appearance === 'automatic' ? AUTOMATIC_HINT : undefined;
}

/** A swatch half: the theme's page with a line of ink on it. */
export type SwatchHalf = { page: string; ink: string };

/**
 * What a theme tile's swatch draws. Under Automatic it is split
 * diagonally, the light page top-left and the dark page bottom-right; under
 * Light or Dark, that mode only. Increase Contrast shows the IC sets.
 */
export function themeSwatch(
  theme: ThemeId,
  appearance: AppearanceSetting,
  increaseContrast: boolean,
): { first: SwatchHalf; second?: SwatchHalf } {
  const half = (scheme: 'light' | 'dark'): SwatchHalf => {
    const { background, textPrimary } = themeTokens[theme].modes[resolveMode(scheme, scheme, increaseContrast)].roles;
    return { page: background, ink: textPrimary };
  };
  if (appearance === 'automatic') return { first: half('light'), second: half('dark') };
  return { first: half(appearance) };
}

/** A theme tile's least width at font scale 1, and the gap between tiles. */
export const TILE_MIN_WIDTH = 72;
export const TILE_GAP = 12;

/** The selection ring's width; unselected options keep the same box (appearance-groups.tsx). */
export const RING = 3;
/** An Appearance tile's padding inside the ring on each side (spacing.sm). */
export const APPEARANCE_TILE_PADDING = 8;

/**
 * Bold "Automatic" (the selected Appearance label, UI body) at font scale 1,
 * in dp, rounded up. From the system fonts' bold advance widths summed over
 * A-u-t-o-m-a-t-i-c:
 * - ios: SF Pro Text Bold, about 4.91em; at the 17pt body, 83.5. SF's
 *   tracking at 17pt (-0.43pt a letter) would bring it to about 80; it is
 *   left out to err wide, so 84. (The iPad popover's 79dp label truncated.)
 * - material: Roboto Bold, about 4.63em; at the 16sp body, 74.1, so 76.
 */
export const AUTOMATIC_BOLD_WIDTH: Record<Look, number> = { ios: 84, material: 76 };

/**
 * Theme tiles sit in one row while four fit at the font scale and each of
 * the three Appearance tiles, less its ring and padding, still holds bold
 * "Automatic"; otherwise both become vertical lists (swatch, name,
 * checkmark), so no name is truncated.
 */
export function pickerLayout(width: number, fontScale: number, look: Look): 'row' | 'list' {
  const scale = Math.max(1, fontScale);
  const themesFit = width >= 4 * TILE_MIN_WIDTH * scale + 3 * TILE_GAP;
  const appearanceText = (width - 2 * TILE_GAP) / 3 - 2 * (RING + APPEARANCE_TILE_PADDING);
  const appearanceFits = appearanceText >= AUTOMATIC_BOLD_WIDTH[look] * scale;
  return themesFit && appearanceFits ? 'row' : 'list';
}
