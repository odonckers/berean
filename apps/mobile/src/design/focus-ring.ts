// The ring Android draws around a view focused from a hardware keyboard, in
// place of the platform's grey focus fill (review 50, Blocking 4): the
// theme's accent, 2 dp, no fill, the same in both looks. The native side
// parses the color with Color.parseColor, so it must be a 6-digit hex token,
// as the theme's colors are; anything else is a bug in the tokens.
export const FOCUS_RING_WIDTH = 2;

export type FocusRing = { color: string; width: number };

export function focusRing(accent: string): FocusRing {
  if (!/^#[0-9A-Fa-f]{6}$/.test(accent)) throw new Error(`focusRing: not a #RRGGBB color: ${accent}`);
  return { color: accent, width: FOCUS_RING_WIDTH };
}
