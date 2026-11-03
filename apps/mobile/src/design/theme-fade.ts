// The theme cross-fade (themes spec rule 12): when the page changes color,
// fade from the old page over 200 ms with no movement; under Reduce Motion,
// swap at once. Pure, for the Node tests.

/** The cross-fade's length; the spec's proposal, to check on device. */
export const THEME_FADE_MS = 200;

/**
 * Whether a palette change fades. The fade is a veil of the old page color
 * lifting off the new page, so it only shows when the page color changes
 * (a theme, appearance, system scheme or Increase Contrast change). An
 * accent-only change keeps the page, so it swaps at once like the
 * selected states it colors.
 */
export function shouldCrossFade(
  previousPage: string | undefined,
  nextPage: string,
  reduceMotion: boolean,
): boolean {
  return !reduceMotion && previousPage !== undefined && previousPage !== nextPage;
}
