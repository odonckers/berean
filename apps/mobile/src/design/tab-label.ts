// Tab bar label sizes under large system text. Pure, for the Node tests.

/**
 * How far a tab label may grow with the system font scale. Material 3
 * navigation bar items have a fixed width (a quarter of a 411dp phone is
 * about 103dp), and the labels aren't meant to grow past it: at font 2.0
 * the 12sp label becomes 24dp and "Studyspace" shows as "Studys…". At 1.3×
 * it is about 82dp, which fits; the tab still has its icon, and its full
 * name is its accessibility label.
 */
export const TAB_LABEL_MAX_SCALE = 1.3;

/**
 * The fontSize to hand a native tab bar whose label the platform scales by
 * the system font scale (Android scales it as sp): the base size while
 * `base × fontScale` is within the cap, then smaller, so the drawn label is
 * never more than `base × TAB_LABEL_MAX_SCALE`. Never larger than `base`.
 */
export function tabLabelFontSize(base: number, fontScale: number, maxScale = TAB_LABEL_MAX_SCALE): number {
  if (!(fontScale > maxScale)) return base;
  return Math.round(((base * maxScale) / fontScale) * 100) / 100;
}
