import { DarkTheme, DefaultTheme, ThemeProvider, type Theme } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Appearance, Platform, useColorScheme } from 'react-native';

import {
  type AppearanceChoice,
  DEFAULT_CHOICE,
  resolveMode,
  resolvePalette,
  type Scheme,
  schemeOf,
  type ThemeId,
  type ThemeMode,
} from '@/design/appearance';
import { loadChoice, saveChoice } from '@/design/appearance-store';
import { solidChrome } from '@/design/chrome';
import { useLook, type Look } from '@/design/look';
import {
  androidIncreaseContrast,
  type SystemAccentOption,
  systemAccentOption,
  type SystemColors,
} from '@/design/system-colors';
import {
  radii,
  readingType,
  spacing,
  uiType,
  verseNumberType,
  type ColorSet,
  type HighlightName,
  type M3Roles,
  type ReadingVariant,
  type StudyPaneColors,
  type TypeRole,
  type UIVariant,
} from '@/design/tokens';

import {
  addSystemColorsListener,
  getContrast,
  getSystemColors,
  systemColorsAvailable,
} from '../../modules/berean-system-colors';

export type { Scheme } from '@/design/appearance';

/**
 * Whether the Accent row offers System colors (§11): Android 12 and later
 * with the native module. Decided by the platform, not the look, which is
 * only a dev preview.
 */
const SYSTEM_COLORS_OFFERED = Platform.OS === 'android' && systemColorsAvailable();

/**
 * The system bars' content for a scheme: dark icons and buttons on the
 * light scheme, light ones on the dark. The status bar, the navigation bar
 * and every Modal's navigation bar use it.
 */
export function systemBarStyle(scheme: Scheme): 'dark' | 'light' {
  return scheme === 'dark' ? 'light' : 'dark';
}

export type Berean = {
  look: Look;
  theme: ThemeId;
  /** The token set: light or dark, plus Increase Contrast. */
  mode: ThemeMode;
  scheme: Scheme;
  colors: ColorSet;
  m3: M3Roles;
  highlights: Record<HighlightName, string>;
  studyPane: StudyPaneColors;
  /** The system's Reduce Transparency (iOS); Android has none, so false (rule 4). */
  reduceTransparency: boolean;
  /** The System colors option in this set; null where it isn't offered. */
  systemAccent: SystemAccentOption | null;
  type: {
    ui: Record<UIVariant, TypeRole>;
    reading: Record<ReadingVariant, TypeRole>;
    verseNumber: TypeRole;
  };
  spacing: typeof spacing;
  radii: typeof radii;
};

function makeBerean(
  look: Look,
  choice: AppearanceChoice,
  mode: ThemeMode,
  system: SystemColors | null,
  reduceTransparency: boolean,
): Berean {
  const { scheme, colors, m3, highlights, studyPane } = resolvePalette(choice, mode, system);
  return {
    look,
    theme: choice.theme,
    mode,
    scheme,
    colors,
    m3,
    highlights,
    studyPane,
    reduceTransparency,
    systemAccent: systemAccentOption(choice.theme, mode, system),
    type: { ui: uiType[look], reading: readingType, verseNumber: verseNumberType },
    spacing,
    radii,
  };
}

// Native headers and stacks read these, so they use Berean colors rather
// than the navigation defaults.
function navigationTheme({ scheme, colors }: Berean): Theme {
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: {
      background: colors.surface,
      card: colors.surface,
      text: colors.text,
      border: colors.separator,
      primary: colors.accent,
      notification: colors.accent,
    },
  };
}

const BereanContext = createContext<Berean>(makeBerean('material', DEFAULT_CHOICE, 'light', null, false));

type AppearanceContextValue = { choice: AppearanceChoice; setChoice: (choice: AppearanceChoice) => void };

const AppearanceContext = createContext<AppearanceContextValue>({ choice: DEFAULT_CHOICE, setChoice: () => {} });

/** What modules/berean-system-colors reports (Android); nothing elsewhere. */
type SystemReadings = { palettes: Record<Scheme, SystemColors | null>; contrast: number | null };

function readSystem(): SystemReadings {
  return {
    palettes: SYSTEM_COLORS_OFFERED
      ? { light: getSystemColors('light'), dark: getSystemColors('dark') }
      : { light: null, dark: null },
    contrast: getContrast(),
  };
}

// Read before the first frame, and again whenever the module says the
// wallpaper palette or the contrast level may have changed; an unchanged
// reading keeps the same object, so nothing re-renders.
function useSystemReadings(): SystemReadings {
  const [readings, setReadings] = useState(readSystem);
  useEffect(() => {
    const subscription = addSystemColorsListener(() => {
      const next = readSystem();
      setReadings((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    });
    return () => subscription?.remove();
  }, []);
  return readings;
}

// A system accessibility setting on iOS, read now and on its change event;
// false elsewhere.
function useIOSAccessibilitySetting(
  read: () => Promise<boolean>,
  event: 'darkerSystemColorsChanged' | 'reduceTransparencyChanged',
): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let live = true;
    read()
      .then((value) => live && setOn(value))
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener(event, setOn);
    return () => {
      live = false;
      subscription.remove();
    };
  }, [read, event]);
  return on;
}

const readDarkerSystemColors = () => AccessibilityInfo.isDarkerSystemColorsEnabled();
const readReduceTransparency = () => AccessibilityInfo.isReduceTransparencyEnabled();

// Increase Contrast follows the system (themes spec rule 4). iOS reports it
// as darker system colors. Android has no exact equivalent (open item 2):
// its contrast level counts from Medium up (androidIncreaseContrast).
function useIncreaseContrast(androidContrast: number | null): boolean {
  const ios = useIOSAccessibilitySetting(readDarkerSystemColors, 'darkerSystemColorsChanged');
  return Platform.OS === 'android' ? androidIncreaseContrast(androidContrast) : ios;
}

// Reduce Transparency (rule 4) is iOS only; Android has no such setting.
function useReduceTransparency(): boolean {
  return useIOSAccessibilitySetting(readReduceTransparency, 'reduceTransparencyChanged');
}

/**
 * Holds the device's Appearance choice, read from storage before the first
 * frame and stored on every change, and gives the app its resolved palette.
 */
export function BereanThemeProvider({ children }: { children: ReactNode }) {
  const look = useLook();
  const [choice, setChoiceState] = useState<AppearanceChoice>(() => loadChoice(SYSTEM_COLORS_OFFERED));

  // Light or Dark forces the scheme app-wide, native headers, alerts and
  // system bars included; Automatic hands it back to the system.
  useLayoutEffect(() => {
    Appearance.setColorScheme(choice.appearance === 'automatic' ? 'unspecified' : choice.appearance);
  }, [choice.appearance]);

  const setChoice = useCallback((next: AppearanceChoice) => {
    setChoiceState(next);
    saveChoice(next);
  }, []);

  const systemScheme = useColorScheme();
  const readings = useSystemReadings();
  const increaseContrast = useIncreaseContrast(readings.contrast);
  const reduceTransparency = useReduceTransparency();
  const mode = resolveMode(choice.appearance, systemScheme, increaseContrast);
  // The palette for the set's scheme; the guard runs again in makeBerean
  // whenever the theme, mode (IC included) or a reading changes.
  const system = readings.palettes[schemeOf(mode)];
  const berean = useMemo(
    () => makeBerean(look, choice, mode, system, reduceTransparency),
    [look, choice, mode, system, reduceTransparency],
  );
  const navTheme = useMemo(() => navigationTheme(berean), [berean]);
  const appearance = useMemo(() => ({ choice, setChoice }), [choice, setChoice]);
  return (
    <AppearanceContext.Provider value={appearance}>
      <BereanContext.Provider value={berean}>
        <ThemeProvider value={navTheme}>{children}</ThemeProvider>
      </BereanContext.Provider>
    </AppearanceContext.Provider>
  );
}

export function useBerean(): Berean {
  return useContext(BereanContext);
}

/**
 * Whether chrome standing in for the system material is solid surfaceRaised
 * with a 1px outline: Reduce Transparency or Increase Contrast (rule 5,
 * solidChrome).
 */
export function useSolidChrome(): boolean {
  const { look, mode, reduceTransparency } = useBerean();
  return solidChrome({ look, reduceTransparency, increaseContrast: mode === 'lightIC' || mode === 'darkIC' });
}

/** The device's Appearance choice and its setter; every change applies at once. */
export function useAppearance(): AppearanceContextValue {
  return useContext(AppearanceContext);
}
