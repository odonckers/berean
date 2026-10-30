import { Platform, StyleSheet, type TextStyle } from 'react-native';

// Semantic design tokens (design guide v3, "Foundations"). Screens use these
// names only, never raw hex.

export type ColorSet = {
  surface: string;
  surfaceRaised: string;
  text: string;
  textSecondary: string;
  accent: string;
  separator: string;
};

export type ColorSetName = 'light' | 'dark' | 'sepia' | 'increaseContrast';

// Only light and dark follow the system scheme for now; sepia and
// increaseContrast (light + Increase Contrast) are defined for later rows.
export const colorSets: Record<ColorSetName, ColorSet> = {
  light: {
    surface: '#FBF7EC',
    surfaceRaised: '#FFFCF5',
    text: '#1F1A14',
    textSecondary: '#5C544A',
    accent: '#9B3F2A',
    separator: '#E6DCC2',
  },
  dark: {
    surface: '#15120E',
    surfaceRaised: '#211D18',
    text: '#EDE6D8',
    textSecondary: '#A39A8B',
    accent: '#E59A7C',
    separator: '#38312A',
  },
  sepia: {
    surface: '#F0E2C4',
    surfaceRaised: '#F7EBD3',
    text: '#3A2817',
    textSecondary: '#66523D',
    accent: '#8A3A22',
    separator: '#D8C39B',
  },
  increaseContrast: {
    surface: '#FBF7EC',
    surfaceRaised: '#FFFDF8',
    text: '#0B0806',
    textSecondary: '#2E2821',
    accent: '#7A2E1C',
    separator: '#8B8275',
  },
};

// Highlights are a fill only, named by color. Each has a spoken name and a
// shape for Differentiate Without Color.
export type HighlightName = 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'orange';
export type HighlightShape = 'circle' | 'square' | 'triangle' | 'diamond' | 'bar' | 'ring';

export const highlightShapes: Record<HighlightName, HighlightShape> = {
  yellow: 'circle',
  green: 'square',
  blue: 'triangle',
  purple: 'diamond',
  pink: 'bar',
  orange: 'ring',
};

export const highlightSpokenNames: Record<HighlightName, string> = {
  yellow: 'yellow',
  green: 'green',
  blue: 'blue',
  purple: 'purple',
  pink: 'pink',
  orange: 'orange',
};

// Converted to sRGB hex from the OKLCH L/C/h values in the guide.
export const highlightFills: Record<ColorSetName, Record<HighlightName, string>> = {
  light: {
    yellow: '#F0E2AD',
    green: '#C1EFC9',
    blue: '#BBE7FF',
    purple: '#ECD6FF',
    pink: '#FFCFE4',
    orange: '#FFD6B5',
  },
  dark: {
    yellow: '#3D3519',
    green: '#243C29',
    blue: '#21384B',
    purple: '#3B2F48',
    pink: '#482C36',
    orange: '#472F1E',
  },
  sepia: {
    yellow: '#DFD19D',
    green: '#B1DFB9',
    blue: '#ABD7FD',
    purple: '#DBC6F7',
    pink: '#F7BFD3',
    orange: '#F6C6A6',
  },
  increaseContrast: {
    yellow: '#EDDB96',
    green: '#B0ECBC',
    blue: '#A8E2FF',
    purple: '#E8CCFF',
    pink: '#FFC2DE',
    orange: '#FFCCA2',
  },
};

// Material 3 roles mapped from the tokens: primary = accent, surface
// containers = paper steps. The guide gives only the light primary,
// secondaryContainer and surfaceContainer; the rest are derived pending Lumen.
export type M3Roles = {
  primary: string;
  onPrimary: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
  surface: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;
  onSurface: string;
  onSurfaceVariant: string;
  outline: string;
  outlineVariant: string;
  scrim: string;
  /** The iOS look's palette scrim (guide v3 §05): warm ink at 45% in light, no blur; dark's scrim in dark. */
  scrimWarm: string;
};

const darkScrim = 'rgba(0,0,0,0.32)';

export const m3Roles: Record<'light' | 'dark', M3Roles> = {
  light: {
    primary: colorSets.light.accent,
    onPrimary: '#FFFFFF',
    secondaryContainer: '#F1DCD1',
    onSecondaryContainer: '#3A1A10',
    surface: colorSets.light.surface,
    surfaceContainerLow: '#F7F1E4',
    surfaceContainer: '#F3ECDD',
    surfaceContainerHigh: '#EEE5D3', // Lumen
    surfaceContainerHighest: '#E9E0CC',
    onSurface: colorSets.light.text,
    onSurfaceVariant: colorSets.light.textSecondary,
    outline: colorSets.light.separator,
    // Derived pending Lumen. Deliberately darker than the 'outline' separator so the
    // unselected filter-chip edge stays visible (M3 baseline outlineVariant is ~1.6:1
    // against surface).
    outlineVariant: '#D2C5AA',
    scrim: 'rgba(0,0,0,0.32)',
    scrimWarm: 'rgba(31,26,20,0.45)', // text #1F1A14
  },
  dark: {
    primary: colorSets.dark.accent,
    onPrimary: '#3A140A',
    secondaryContainer: '#4A2C22',
    onSecondaryContainer: '#F6DDD2',
    surface: colorSets.dark.surface,
    surfaceContainerLow: '#1A1612',
    surfaceContainer: '#1C1814',
    surfaceContainerHigh: '#26211C',
    surfaceContainerHighest: '#312B25',
    onSurface: colorSets.dark.text,
    onSurfaceVariant: colorSets.dark.textSecondary,
    outline: colorSets.dark.separator,
    // Derived pending Lumen. Deliberately darker than the 'outline' separator so the
    // unselected filter-chip edge stays visible (M3 baseline outlineVariant is ~1.6:1
    // against surface).
    outlineVariant: '#4E443B',
    scrim: darkScrim,
    // The guide defines no dark warm scrim, so dark uses the theme's scrim token.
    scrimWarm: darkScrim,
  },
};

// Study pane colors that have no general role (Lumen review of the inline
// study pane). Material: the 1dp ring and the My notes footer. iOS: the
// segmented control and the My notes footer.
export type StudyPaneColors = {
  materialRing: string;
  materialFooter: string;
  iosFooter: string;
  segmentTrack: string;
  segmentThumb: string;
  segmentText: string;
};

export const studyPaneColors: Record<'light' | 'dark', StudyPaneColors> = {
  light: {
    materialRing: '#E0D4BC',
    materialFooter: m3Roles.light.surfaceContainerHigh,
    iosFooter: '#F5EFE0',
    segmentTrack: colorSets.light.separator,
    // Light thumb is surfaceRaised with a small shadow.
    segmentThumb: colorSets.light.surfaceRaised,
    segmentText: colorSets.light.text,
  },
  dark: {
    materialRing: m3Roles.dark.outlineVariant,
    materialFooter: m3Roles.dark.surfaceContainerHigh,
    // Derived: Lumen gave only the light value. The light footer is one step
    // darker than the raised pane, so the dark one is one step lighter than
    // the dark pane (#211D18), the same step as the segment track.
    iosFooter: '#2A241F',
    segmentTrack: '#2A241F',
    segmentThumb: '#5C544A',
    segmentText: colorSets.dark.text,
  },
};

// Reading column horizontal padding, and the study pane's inset from the
// column's outer edge (so the pane runs wider than the text).
export const readingColumnPadding = { ios: 22, material: 20 } as const;
export const studyPaneInset = { ios: 10, material: 12 } as const;

// 4-pt grid.
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radii = {
  chip: 6,
  materialChip: 8, // M3 assist/filter/input chips
  card: 12,
  studyPane: 18,
  materialPane: 16, // also the M3 FAB
  sheet: 28, // also M3 dialogs
  capsule: 999,
} as const;

// Window width breakpoints in dp.
export const breakpoints = {
  medium: 600,
  expanded: 840,
} as const;

export const hairline = StyleSheet.hairlineWidth;

// Type. Sizes and line heights are in pt/sp. React Native scales both
// fontSize and lineHeight by the system font scale (allowFontScaling is on by
// default), so these never need multiplying by hand.
export type TypeRole = Pick<TextStyle, 'fontSize' | 'lineHeight' | 'fontWeight' | 'fontFamily' | 'fontVariant'>;

export type UIVariant = 'largeTitle' | 'title' | 'body' | 'caption' | 'label';
export type ReadingVariant = 'chapterHeading' | 'sectionHeading' | 'scripture' | 'noteBody';

// The UI font is the system font in both looks (no fontFamily): SF on iOS,
// Roboto on Android. `label` is the tab label size.
export const uiType: Record<'ios' | 'material', Record<UIVariant, TypeRole>> = {
  ios: {
    largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700' },
    title: { fontSize: 22, lineHeight: 28, fontWeight: '600' },
    body: { fontSize: 17, lineHeight: 22, fontWeight: '400' },
    caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
    label: { fontSize: 10, lineHeight: 12, fontWeight: '500' },
  },
  material: {
    largeTitle: { fontSize: 32, lineHeight: 40, fontWeight: '400' }, // M3 headline
    title: { fontSize: 22, lineHeight: 28, fontWeight: '400' }, // M3 title large
    body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
    caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
    label: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  },
};

// Literata is bundled on Android (expo-font plugin in app.json); iOS uses
// New York through the 'ui-serif' system family.
const serif = Platform.OS === 'ios' ? 'ui-serif' : 'Literata';

const scriptureFontSize = 17;

// Reading roles are the same in both looks.
export const readingType: Record<ReadingVariant, TypeRole> = {
  chapterHeading: { fontFamily: serif, fontSize: 25.5, lineHeight: 32, fontWeight: '600' },
  sectionHeading: { fontFamily: serif, fontSize: 21, lineHeight: 28, fontWeight: '500' },
  scripture: { fontFamily: serif, fontSize: scriptureFontSize, lineHeight: 25.5, fontWeight: '400' },
  noteBody: { fontFamily: serif, fontSize: 15, lineHeight: 22.5, fontWeight: '400' },
};

// Reading measure: scripture never runs wider than about 70 characters; on
// wide windows the column stays put and the margins grow. Bundled Literata
// (default instance, opsz 12 / wght 400) averages 0.48em per character over
// the ASV John 1:1-18 sample (fontTools hmtx advances, spaces and punctuation
// included), so 70ch at 17pt is 70 * 0.48 * 17 = 571dp. New York runs close
// enough to share it. Multiply by the font scale where it is used.
const averageCharEm = 0.48;
export const readingMeasure = Math.round(70 * averageCharEm * scriptureFontSize);

// Verse numbers use the UI font with tabular figures. They are spans in the
// serif scripture text, so they name the system family ('System' on iOS;
// Android falls back to its default sans) rather than inherit the serif.
export const verseNumberType: TypeRole = {
  fontFamily: 'System',
  fontSize: 11,
  fontWeight: '600',
  fontVariant: ['tabular-nums'],
};
