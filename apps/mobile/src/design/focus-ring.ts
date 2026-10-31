// The ring Android draws around a view focused from a hardware keyboard, in
// place of the platform's grey focus fill (review 50, Blocking 4): the
// theme's accent, 2 dp, no fill, the same in both looks. It is a rounded
// rect whose inner edge sits FOCUS_RING_OFFSET outside the view on every
// side, so it never touches the field's glyphs (PR 61, Blocking 1). The
// native side parses the color with Color.parseColor, so it must be a
// 6-digit hex token, as the theme's colors are; anything else is a bug in
// the tokens.
export const FOCUS_RING_WIDTH = 2;
export const FOCUS_RING_RADIUS = 8;
export const FOCUS_RING_OFFSET = 2;

export type FocusRing = { color: string; width: number; radius: number; offset: number };

export function focusRing(accent: string): FocusRing {
  if (!/^#[0-9A-Fa-f]{6}$/.test(accent)) throw new Error(`focusRing: not a #RRGGBB color: ${accent}`);
  return { color: accent, width: FOCUS_RING_WIDTH, radius: FOCUS_RING_RADIUS, offset: FOCUS_RING_OFFSET };
}
