// Glass vs solid chrome (themes spec rules 4 and 5). Pure, for the Node tests.

import type { ColorSet, M3Roles } from './colors.ts';

type Look = 'ios' | 'material';

/**
 * Whether chrome that stands in for the system material is solid
 * surfaceRaised with a 1 px outline: under Reduce Transparency or Increase
 * Contrast (rule 5). The material look's chrome is never translucent, so
 * Reduce Transparency changes nothing there; Increase Contrast still edges
 * it, as the Aa picker sheet always has.
 */
export function solidChrome({
  look,
  reduceTransparency,
  increaseContrast,
}: {
  look: Look;
  reduceTransparency: boolean;
  increaseContrast: boolean;
}): boolean {
  return increaseContrast || (look === 'ios' && reduceTransparency);
}

/**
 * The iOS look's approximation of glass (toolbars, the floating tab bar,
 * the search field, the format bar, Done): surfaceRaised with a hairline
 * separator edge, or, when solid, surfaceRaised with a 1 px outline.
 */
export function glassFace(
  solid: boolean,
  colors: Pick<ColorSet, 'surfaceRaised' | 'separator' | 'outline'>,
  hairline: number,
): { backgroundColor: string; borderColor: string; borderWidth: number } {
  return solid
    ? { backgroundColor: colors.surfaceRaised, borderColor: colors.outline, borderWidth: 1 }
    : { backgroundColor: colors.surfaceRaised, borderColor: colors.separator, borderWidth: hairline };
}

/**
 * The material look's side sheet edge against the reading column: an M3
 * outlineVariant hairline, or, when solid (Increase Contrast), a 1 px outline.
 */
export function sideSheetEdge(
  solid: boolean,
  colors: Pick<ColorSet, 'outline'>,
  m3: Pick<M3Roles, 'outlineVariant'>,
  hairline: number,
): { borderLeftWidth: number; borderColor: string } {
  return solid
    ? { borderLeftWidth: 1, borderColor: colors.outline }
    : { borderLeftWidth: hairline, borderColor: m3.outlineVariant };
}

/**
 * The edge of a card that hangs over the reader (the iOS look's anchored
 * cards: the bookmark picker's, its ⋯ menu's, and the Aa popover's). Solid
 * (Increase Contrast, Reduce Transparency): the 1 px outline every sheet
 * gets. Otherwise, in the iOS look's dark schemes, a hairline separator as
 * glassFace draws: the card's surfaceRaised sits barely off the page there
 * (about 1.1:1) and its shadow doesn't show on a dark page. Light pages
 * show the shadow, and Material's cards are tonal or elevated, so neither
 * gets one.
 */
export function cardEdge(
  { look, dark, solid }: { look: Look; dark: boolean; solid: boolean },
  colors: Pick<ColorSet, 'separator' | 'outline'>,
  hairline: number,
): { borderColor: string; borderWidth: number } | undefined {
  if (solid) return { borderColor: colors.outline, borderWidth: 1 };
  if (look === 'ios' && dark) return { borderColor: colors.separator, borderWidth: hairline };
  return undefined;
}
