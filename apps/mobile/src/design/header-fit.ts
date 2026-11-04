// Whether a Material small top app bar has room for its title beside a row
// of text-button actions (and the app-bar search field, on wider windows).
// Pure, for the Node tests.

/**
 * Roboto's average advance per character, in em, over mixed-case words. A
 * little generous (Roboto runs nearer 0.5em), so the estimate errs towards
 * moving the actions rather than squeezing the title.
 */
export const UI_AVERAGE_CHAR_EM = 0.55;

export type HeaderFitInput = {
  /** Window width and system font scale, from useWindowDimensions. */
  windowWidth: number;
  fontScale: number;
  /**
   * The navigation rail's laid-out width where it is shown beside the
   * screen: the header is only the window width less the rail.
   */
  railWidth?: number;
  /**
   * The app-bar search field, where it sits in the header before the
   * actions: its full width, and the least it may shrink to.
   */
  search?: { width: number; minWidth: number };
  title: string;
  /** The header title's fontSize at font scale 1 (headerTitleStyle). */
  titleFontSize: number;
  /** The action buttons' labels. */
  actions: readonly string[];
  /** The buttons' label fontSize at font scale 1. */
  labelFontSize: number;
  /** A button's horizontal space around its label, per side. */
  labelInset: number;
  /** A button's least width (the minimum touch target). */
  minTarget: number;
  /** The gap between action buttons, and between the search and them. */
  actionGap: number;
  /**
   * The header's leading and trailing insets, and the least room left
   * between the title and the first action.
   */
  edgeInset: number;
};

function textWidth(text: string, fontSize: number, fontScale: number): number {
  return text.length * fontSize * fontScale * UI_AVERAGE_CHAR_EM;
}

/** The header's own width: the window less the navigation rail. */
export function headerWidth(input: HeaderFitInput): number {
  return input.windowWidth - (input.railWidth ?? 0);
}

// The row without the search field: inset, title, inset, the buttons (each
// at least the touch target wide) with their gaps, inset.
function rowWidthWithoutSearch(input: HeaderFitInput): number {
  const { fontScale, title, titleFontSize, actions, labelFontSize, labelInset, minTarget, actionGap, edgeInset } =
    input;
  const buttons = actions.reduce(
    (sum, label) => sum + Math.max(minTarget, textWidth(label, labelFontSize, fontScale) + 2 * labelInset),
    0,
  );
  const gaps = Math.max(0, actions.length - 1) * actionGap;
  return 3 * edgeInset + textWidth(title, titleFontSize, fontScale) + buttons + gaps;
}

// The search field's gap to the buttons after it; with no buttons, the
// inset between the title and the trailing items already separates it.
function searchGap(input: HeaderFitInput): number {
  return input.actions.length > 0 ? input.actionGap : 0;
}

/**
 * The width the title plus the search field (at its full width) and the
 * actions need in one header row. Font sizes grow with the font scale, as
 * Android draws them in sp.
 */
export function headerRowWidth(input: HeaderFitInput): number {
  const search = input.search ? input.search.width + searchGap(input) : 0;
  return rowWidthWithoutSearch(input) + search;
}

/** True while the whole title, the search field and every action fit in the header. */
export function headerFitsActions(input: HeaderFitInput): boolean {
  return headerRowWidth(input) <= headerWidth(input);
}

/**
 * The search field's width in the header: its full width where that fits,
 * else what the title and actions leave, but never under its minimum. At the
 * minimum (very large text on a narrow tablet) the title may still be
 * squeezed: search stays reachable rather than vanish.
 */
export function headerSearchWidth(input: HeaderFitInput & { search: { width: number; minWidth: number } }): number {
  const room = headerWidth(input) - rowWidthWithoutSearch(input) - searchGap(input);
  return Math.max(input.search.minWidth, Math.min(input.search.width, room));
}
