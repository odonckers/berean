// Colour roles (design guide v3, "Foundations"; docs/design/themes/tokens.json).
// Free of React Native so the Node tests can check contrast on the hexes;
// tokens.ts re-exports them.

export type ColorSet = {
  surface: string;
  surfaceRaised: string;
  text: string;
  textSecondary: string;
  accent: string;
  separator: string;
  /** Borders controls such as segmented buttons; at least 3:1 on surface (guide, Lumen, #57). */
  outline: string;
  /** A present link's underline (guide §7.1 Read). */
  linkUnderline: string;
  /** Destructive actions in the iOS look (Delete Folder…, Delete). */
  destructive: string;
  /** Text on an accent fill, as in the verse notes badge (guide §7.2). */
  onAccent: string;
  /** The Studyspace canvas behind the cards, a step off the page surface (guide §4). */
  canvas: string;
  /** The canvas's dot grid. */
  canvasDot: string;
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
    outline: '#8B8275',
    linkUnderline: '#C9A493',
    destructive: '#D70015',
    onAccent: '#FFFCF5',
    canvas: '#F5EFE0', // guide --paper-1
    canvasDot: '#D9CDB0', // guide --paper-edge
  },
  dark: {
    surface: '#15120E',
    surfaceRaised: '#211D18',
    text: '#EDE6D8',
    textSecondary: '#A39A8B',
    accent: '#E59A7C',
    separator: '#38312A',
    outline: '#7A7165',
    linkUnderline: '#734F40',
    destructive: '#FF453A',
    onAccent: '#211D18',
    // Derived, pending Lumen: tokens.json surfaceContainerLowest, one step
    // below the surface; the dots a quiet warm step above it.
    canvas: '#0F0D0A',
    canvasDot: '#2E2822',
  },
  // Sepia and increaseContrast link underlines are derived pending Lumen:
  // sepia is its accent at light's blend; increaseContrast is the accent
  // itself, so the underline keeps its contrast. Their destructive reds are
  // tokens.json's (Sepia light; Paper lightIC), and their raised paper is onAccent.
  sepia: {
    surface: '#F0E2C4',
    surfaceRaised: '#F7EBD3',
    text: '#3A2817',
    textSecondary: '#66523D',
    accent: '#8A3A22',
    separator: '#D8C39B',
    outline: '#7E7466',
    linkUnderline: '#BD8E73',
    destructive: '#BE222A',
    onAccent: '#F7EBD3',
    // Derived, pending Lumen: light's canvas and dot steps off sepia's surface.
    canvas: '#EADAB9',
    canvasDot: '#CDB78C',
  },
  increaseContrast: {
    surface: '#FBF7EC',
    surfaceRaised: '#FFFDF8',
    text: '#0B0806',
    textSecondary: '#2E2821',
    accent: '#7A2E1C',
    separator: '#8B8275',
    outline: '#5C544A',
    linkUnderline: '#7A2E1C',
    destructive: '#A1000D',
    onAccent: '#FFFDF8',
    // Derived, pending Lumen: light's canvas, with stronger dots.
    canvas: '#F5EFE0',
    canvasDot: '#C4B694',
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
  /** Destructive menu items and buttons (Delete Workspace…, Delete). */
  error: string;
  /** Content on an error fill. */
  onError: string;
  scrim: string;
  /** The iOS look's palette scrim (guide v3 §05): warm ink at 45% in light, no blur; dark's scrim in dark. */
  scrimWarm: string;
};

const darkScrim = 'rgba(0,0,0,0.32)';

// error and onError are tokens.json's Paper material3 roles. There is no
// Increase Contrast m3 set yet; tokens.json's are lightIC #A1000D / #FFFFFF
// and darkIC #FF7667 / #0C0905.
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
    outline: colorSets.light.outline,
    // Derived pending Lumen. Deliberately darker than the 'outline' separator so the
    // unselected filter-chip edge stays visible (M3 baseline outlineVariant is ~1.6:1
    // against surface).
    outlineVariant: '#D2C5AA',
    error: '#D70015',
    onError: '#FFFFFF',
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
    outline: colorSets.dark.outline,
    // Derived pending Lumen. Deliberately darker than the 'outline' separator so the
    // unselected filter-chip edge stays visible (M3 baseline outlineVariant is ~1.6:1
    // against surface).
    outlineVariant: '#4E443B',
    error: '#FF453A',
    onError: '#0C0905',
    scrim: darkScrim,
    // The guide defines no dark warm scrim, so dark uses the theme's scrim token.
    scrimWarm: darkScrim,
  },
};
