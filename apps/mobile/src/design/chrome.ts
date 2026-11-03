// Glass vs solid chrome (themes spec rules 4 and 5). Pure, for the Node tests.

import type { ColorSet } from './colors.ts';

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
