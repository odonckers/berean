// The reader's Appearance choice (themes spec §3, §12.2, §12.3): which theme,
// accent slot and appearance, how it is stored, and the palette it resolves
// to. Pure, so Node can test it; appearance-store.ts does the file I/O and
// theme.tsx the React side.

import type { ColorSet, M3Roles, StudyPaneColors } from './colors.ts';
import {
  HIGHLIGHT_KEYS,
  THEME_IDS,
  themeTokens,
  type HighlightKey,
  type ThemeId,
  type ThemeMode,
} from './theme-tokens.generated.ts';

export type { ThemeId, ThemeMode } from './theme-tokens.generated.ts';

/** The per-device storage key (spec §12.3). */
export const APPEARANCE_KEY = 'berean.appearance';

export type AccentSlot = 1 | 2 | 3 | 4 | 5 | 6;
export const ACCENT_SLOTS: readonly AccentSlot[] = [1, 2, 3, 4, 5, 6];

export type AppearanceSetting = 'automatic' | 'light' | 'dark';
export const APPEARANCES: readonly AppearanceSetting[] = ['automatic', 'light', 'dark'];

export type AppearanceChoice = { theme: ThemeId; accent: AccentSlot; appearance: AppearanceSetting };

/** Every device starts here (rule 3). */
export const DEFAULT_CHOICE: AppearanceChoice = Object.freeze({
  theme: 'paper',
  accent: 1,
  appearance: 'automatic',
});

export type Scheme = 'light' | 'dark';

const isObject = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw);

/**
 * The choice in a stored `berean.appearance` value (the decoded JSON). Each
 * field that is missing, unknown or out of range falls back to its default
 * on its own. `"system"` accent isn't offered on this build, so it shows as
 * slot 1 (§12.2); serializeChoice keeps it.
 */
export function parseChoice(raw: unknown): AppearanceChoice {
  if (!isObject(raw)) return DEFAULT_CHOICE;
  const { theme, accent, appearance } = raw;
  return {
    theme: THEME_IDS.find((id) => id === theme) ?? DEFAULT_CHOICE.theme,
    accent: ACCENT_SLOTS.find((slot) => slot === accent) ?? DEFAULT_CHOICE.accent,
    appearance: APPEARANCES.find((a) => a === appearance) ?? DEFAULT_CHOICE.appearance,
  };
}

/**
 * The value to store for a choice, as JSON text. A stored `"system"` accent
 * shows as slot 1, so while the choice is still slot 1 the user hasn't
 * picked another accent and `"system"` is kept (§12.2).
 */
export function serializeChoice(choice: AppearanceChoice, stored?: unknown): string {
  const keepSystem = choice.accent === 1 && isObject(stored) && stored.accent === 'system';
  return JSON.stringify({
    version: 1,
    theme: choice.theme,
    accent: keepSystem ? 'system' : choice.accent,
    appearance: choice.appearance,
  });
}

/** The token set to use (§12.2): the appearance, or the system's under Automatic, plus IC. */
export function resolveMode(
  appearance: AppearanceSetting,
  systemScheme: string | null | undefined,
  increaseContrast: boolean,
): ThemeMode {
  const scheme: Scheme = appearance === 'automatic' ? (systemScheme === 'dark' ? 'dark' : 'light') : appearance;
  return increaseContrast ? `${scheme}IC` : scheme;
}

export function schemeOf(mode: ThemeMode): Scheme {
  return mode === 'dark' || mode === 'darkIC' ? 'dark' : 'light';
}

/** The same contrast level in the other scheme: light ↔ dark, lightIC ↔ darkIC. */
export function oppositeMode(mode: ThemeMode): ThemeMode {
  const opposite: Record<ThemeMode, ThemeMode> = { light: 'dark', dark: 'light', lightIC: 'darkIC', darkIC: 'lightIC' };
  return opposite[mode];
}

export type AccentOption = { slot: AccentSlot; name: string; hex: string; onAccent: string };

/** A theme's six accents in a set, slot 1 first. */
export function accentOptions(theme: ThemeId, mode: ThemeMode): AccentOption[] {
  return themeTokens[theme].accents.map((accent, i) => ({
    slot: ACCENT_SLOTS[i],
    name: accent.name,
    hex: accent.modes[mode].hex,
    onAccent: accent.modes[mode].onAccent,
  }));
}

/** The theme's name, as tokens.json gives it ("Paper"). */
export function themeName(theme: ThemeId): string {
  return themeTokens[theme].name;
}

export type Palette = {
  mode: ThemeMode;
  scheme: Scheme;
  colors: ColorSet;
  m3: M3Roles;
  highlights: Record<HighlightKey, string>;
  studyPane: StudyPaneColors;
};

/** `a` moved `t` of the way to `b`, per sRGB channel; both #RRGGBB. */
export function mix(a: string, b: string, t: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
  const out = [0, 1, 2].map((i) => {
    const v = Math.round(channel(a, i) + (channel(b, i) - channel(a, i)) * t);
    return v.toString(16).padStart(2, '0');
  });
  return `#${out.join('')}`.toUpperCase();
}

type Derived = Pick<ColorSet, 'canvas' | 'canvasDot'> & StudyPaneColors;

// Paper light and dark keep the values shipped before themes wherever the
// rules below land near but not on them.
const PAPER_SHIPPED: Partial<Record<ThemeMode, Partial<Derived>>> = {
  light: { canvas: '#F5EFE0', iosFooter: '#F5EFE0', canvasDot: '#D9CDB0', materialRing: '#E0D4BC' },
  dark: { canvasDot: '#2E2822', segmentTrack: '#2A241F', iosFooter: '#2A241F', segmentThumb: '#5C544A' },
};

/**
 * The roles tokens.json doesn't define: the Studyspace canvas and the study
 * pane's colors, one rule each from the set's tokens. "Dark" covers darkIC.
 * - canvas: light, the midpoint of background and surfaceSunken; dark, surfaceSunken.
 * - canvasDot: the canvas 30% of the way to outline.
 * - materialRing: M3 outlineVariant. materialFooter: M3 surfaceContainerHigh.
 * - segmentTrack: light, separator; dark, the midpoint of surfaceRaised and separator.
 * - segmentThumb: light, surfaceRaised (with a shadow); dark, surfaceRaised 60% of the way to outline.
 * - iosFooter: light, the canvas; dark, the segment track. segmentText: textPrimary.
 * Paper light and dark then take their shipped values (PAPER_SHIPPED).
 */
function derivedRoles(theme: ThemeId, mode: ThemeMode): Derived {
  const roles = themeTokens[theme].modes[mode].roles;
  const m3 = themeTokens[theme].material3[mode];
  const dark = schemeOf(mode) === 'dark';
  const canvas = dark ? roles.surfaceSunken : mix(roles.background, roles.surfaceSunken, 0.5);
  const segmentTrack = dark ? mix(roles.surfaceRaised, roles.separator, 0.5) : roles.separator;
  const ruled: Derived = {
    canvas,
    canvasDot: mix(canvas, roles.outline, 0.3),
    materialRing: m3.outlineVariant,
    materialFooter: m3.surfaceContainerHigh,
    iosFooter: dark ? segmentTrack : canvas,
    segmentTrack,
    segmentThumb: dark ? mix(roles.surfaceRaised, roles.outline, 0.6) : roles.surfaceRaised,
    segmentText: roles.textPrimary,
  };
  return theme === 'paper' ? { ...ruled, ...PAPER_SHIPPED[mode] } : ruled;
}

/**
 * Everything the app draws a choice with, in a set. The chosen accent slot
 * replaces accent and onAccent; any slot but 1 (which the tokens' M3 roles
 * are built on) also replaces M3 primary and onPrimary (§9). The focus ring
 * is drawn in `colors.accent` (rule 9).
 */
export function resolvePalette(choice: AppearanceChoice, mode: ThemeMode): Palette {
  const tokens = themeTokens[choice.theme];
  const set = tokens.modes[mode];
  const roles = set.roles;
  const slot = tokens.accents[choice.accent - 1];
  const accent = slot.modes[mode];
  const material3 = tokens.material3[mode];
  const { canvas, canvasDot, ...studyPane } = derivedRoles(choice.theme, mode);
  return {
    mode,
    scheme: schemeOf(mode),
    colors: {
      surface: roles.background,
      surfaceRaised: roles.surfaceRaised,
      text: roles.textPrimary,
      textSecondary: roles.textSecondary,
      accent: accent.hex,
      separator: roles.separator,
      outline: roles.outline,
      linkUnderline: roles.linkUnderline,
      destructive: roles.destructive,
      onAccent: accent.onAccent,
      canvas,
      canvasDot,
    },
    m3: {
      ...material3,
      primary: choice.accent === 1 ? material3.primary : accent.hex,
      onPrimary: choice.accent === 1 ? material3.onPrimary : accent.onAccent,
      inversePrimary: slot.modes[oppositeMode(mode)].hex,
    },
    highlights: Object.fromEntries(HIGHLIGHT_KEYS.map((key) => [key, set.highlights[key].hex])) as Record<
      HighlightKey,
      string
    >,
    studyPane,
  };
}
