import { DarkTheme, DefaultTheme, ThemeProvider, type Theme } from 'expo-router';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { useLook, type Look } from '@/design/look';
import {
  colorSets,
  highlightFills,
  m3Roles,
  radii,
  readingType,
  spacing,
  studyPaneColors,
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

export type Scheme = 'light' | 'dark';

export type Berean = {
  look: Look;
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

function makeBerean(look: Look, scheme: Scheme): Berean {
  return {
    look,
    scheme,
    colors: colorSets[scheme],
    m3: m3Roles[scheme],
    highlights: highlightFills[scheme],
    studyPane: studyPaneColors[scheme],
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

const BereanContext = createContext<Berean>(makeBerean('material', 'light'));

export function BereanThemeProvider({ children }: { children: ReactNode }) {
  const look = useLook();
  const scheme: Scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const berean = useMemo(() => makeBerean(look, scheme), [look, scheme]);
  const navTheme = useMemo(() => navigationTheme(berean), [berean]);
  return (
    <BereanContext.Provider value={berean}>
      <ThemeProvider value={navTheme}>{children}</ThemeProvider>
    </BereanContext.Provider>
  );
}

export function useBerean(): Berean {
  return useContext(BereanContext);
}
