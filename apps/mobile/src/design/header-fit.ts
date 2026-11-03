// Whether a Material small top app bar has room for its title beside a row
// of text-button actions. Pure, for the Node tests.

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
  /** The gap between action buttons. */
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

/**
 * The width the title plus the actions need in one header row: inset,
 * title, inset, the buttons (each at least the touch target wide) with
 * their gaps, inset. Font sizes grow with the font scale, as Android draws
 * them in sp.
 */
export function headerRowWidth(input: HeaderFitInput): number {
  const { fontScale, title, titleFontSize, actions, labelFontSize, labelInset, minTarget, actionGap, edgeInset } =
    input;
  const buttons = actions.reduce(
    (sum, label) => sum + Math.max(minTarget, textWidth(label, labelFontSize, fontScale) + 2 * labelInset),
    0,
  );
  const gaps = Math.max(0, actions.length - 1) * actionGap;
  return 3 * edgeInset + textWidth(title, titleFontSize, fontScale) + buttons + gaps;
}

/** True while the whole title and every action fit in the header row. */
export function headerFitsActions(input: HeaderFitInput): boolean {
  return headerRowWidth(input) <= input.windowWidth;
}
