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

/**
 * Theme tiles sit in one row while four fit at the font scale; otherwise
 * they become a vertical list (swatch, name, checkmark), so no name is
 * truncated. Appearance follows the same choice.
 */
export function pickerLayout(width: number, fontScale: number): 'row' | 'list' {
  const needed = 4 * TILE_MIN_WIDTH * Math.max(1, fontScale) + 3 * TILE_GAP;
  return width >= needed ? 'row' : 'list';
}
