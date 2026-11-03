// The colour role shapes the screens read (design guide §8, Themes). The
// values come from docs/design/themes/tokens.json through appearance.ts,
// which maps a theme's roles onto these shapes. Free of React Native so the
// Node tests can check contrast on the hexes; tokens.ts re-exports them.

export type ColorSet = {
  /** The page (the theme's `background`). */
  surface: string;
  surfaceRaised: string;
  /** The theme's `textPrimary`. */
  text: string;
  textSecondary: string;
  accent: string;
  /** Decorative only; boundaries that must be seen use `outline`. */
  separator: string;
  /** Borders controls such as segmented buttons, tiles and fields; at least 3:1 on every surface. */
  outline: string;
  /** A present link's underline (guide §7.1 Read); decorative. */
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

// Material 3 roles (themes spec §9), with primary and onPrimary swapped for
// the chosen accent slot.
export type M3Roles = {
  primary: string;
  onPrimary: string;
  /** The chosen accent in the opposite light or dark set: snackbar actions. */
  inversePrimary: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
  surface: string;
  surfaceContainerLowest: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;
  onSurface: string;
  onSurfaceVariant: string;
  outline: string;
  /** Decorative. */
  outlineVariant: string;
  /** Destructive menu items and buttons (Delete Workspace…, Delete). */
  error: string;
  /** Content on an error fill. */
  onError: string;
  scrim: string;
  /** The iOS look's palette scrim (guide v3 §05): warm ink at 45% in light, no blur; the scrim in dark. */
  scrimWarm: string;
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
  /** The selected thumb's 1px edge: `outline` under Increase Contrast (rule 5); none otherwise. */
  segmentThumbEdge: string | undefined;
  segmentText: string;
};
