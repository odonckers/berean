import { DarkTheme, DefaultTheme, ThemeProvider, type Theme } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Appearance, Platform, useColorScheme } from 'react-native';

import {
  type AppearanceChoice,
  DEFAULT_CHOICE,
  resolveMode,
  resolvePalette,
  type Scheme,
  type ThemeId,
  type ThemeMode,
} from '@/design/appearance';
import { loadChoice, saveChoice } from '@/design/appearance-store';
import { useLook, type Look } from '@/design/look';
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

export type { Scheme } from '@/design/appearance';

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
  type: {
    ui: Record<UIVariant, TypeRole>;
    reading: Record<ReadingVariant, TypeRole>;
    verseNumber: TypeRole;
  };
  spacing: typeof spacing;
  radii: typeof radii;
};

function makeBerean(look: Look, choice: AppearanceChoice, mode: ThemeMode): Berean {
  const { scheme, colors, m3, highlights, studyPane } = resolvePalette(choice, mode);
  return {
    look,
    theme: choice.theme,
    mode,
    scheme,
    colors,
    m3,
    highlights,
    studyPane,
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

const BereanContext = createContext<Berean>(makeBerean('material', DEFAULT_CHOICE, 'light'));

type AppearanceContextValue = { choice: AppearanceChoice; setChoice: (choice: AppearanceChoice) => void };

const AppearanceContext = createContext<AppearanceContextValue>({ choice: DEFAULT_CHOICE, setChoice: () => {} });

// Increase Contrast follows the system (themes spec rule 4). iOS reports it
// as darker system colors; Android has no equivalent yet (spec open item 2),
// so it is off there.
function useIncreaseContrast(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let live = true;
    AccessibilityInfo.isDarkerSystemColorsEnabled()
      .then((value) => live && setOn(value))
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('darkerSystemColorsChanged', setOn);
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);
  return on;
}

/**
 * Holds the device's Appearance choice, read from storage before the first
 * frame and stored on every change, and gives the app its resolved palette.
 */
export function BereanThemeProvider({ children }: { children: ReactNode }) {
  const look = useLook();
  const [choice, setChoiceState] = useState<AppearanceChoice>(loadChoice);

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
  const increaseContrast = useIncreaseContrast();
  const mode = resolveMode(choice.appearance, systemScheme, increaseContrast);
  const berean = useMemo(() => makeBerean(look, choice, mode), [look, choice, mode]);
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

/** The device's Appearance choice and its setter; every change applies at once. */
export function useAppearance(): AppearanceContextValue {
  return useContext(AppearanceContext);
}
