// The landing wash (bookmarks spec §3.3, §5): after a bookmark jump to a
// verse, besides the number's accent pill, the verse's text gets a tinted
// wash. It fades out after 2 s, or clears on the next scroll or tap; under
// Reduce Motion it is static and clears only on the next scroll or tap.
// Kept free of React Native so Node can test it.

import { contrast } from '../design/contrast.ts';

/** The wash holds this long before it fades (spec §3.3: 2 s). */
export const WASH_HOLD_MS = 2_000;
/** Then fades out over this long. */
export const WASH_FADE_MS = 400;
/** How much of the accent the wash mixes into the text's background at full strength. */
export const WASH_TINT = 0.2;
/** Under Increase Contrast, the verse text keeps at least this against the washed fill. */
export const IC_TEXT_CONTRAST = 7;
/**
 * Under Increase Contrast, a capped tint below this is no wash at all
 * (Lumen's ruling on #83): too faint to read as a wash, it would only
 * smudge the page. The number's accent pill still marks the landing.
 */
export const IC_TINT_FLOOR = 0.05;
/** The clamped tint is found in steps this fine. */
const TINT_STEP = 0.001;

export type Wash =
  | {
      readonly chapterKey: string;
      readonly verse: number;
      /** The jump's arrival, so a later one restarts the wash. */
      readonly arrival: number;
      /** False under Reduce Motion: static until a scroll or tap. */
      readonly fades: boolean;
    }
  | undefined;

export type WashEvent =
  | { kind: 'land'; chapterKey: string; verse: number; arrival: number; reducedMotion: boolean }
  /** The reader scrolled or touched the chapter. */
  | { kind: 'scroll' }
  | { kind: 'tap' }
  /** Arrival `arrival`'s wash has faded out. */
  | { kind: 'faded'; arrival: number }
  /** The chapter shown now. */
  | { kind: 'chapter'; chapterKey: string };

export function landingWash(prev: Wash, event: WashEvent): Wash {
  switch (event.kind) {
    case 'land': {
      const { chapterKey, verse, arrival, reducedMotion } = event;
      return { chapterKey, verse, arrival, fades: !reducedMotion };
    }
    case 'scroll':
    case 'tap':
      return undefined;
    case 'faded':
      // A static wash never fades; a newer arrival's wash isn't this one.
      return prev?.fades === true && prev.arrival === event.arrival ? undefined : prev;
    case 'chapter':
      return prev?.chapterKey === event.chapterKey ? prev : undefined;
  }
}

/**
 * The wash's strength (1 to 0) `elapsed` ms after it showed: full for the
 * hold, then easing out over the fade. A static wash stays full.
 */
export function washStrength(elapsed: number, fades: boolean): number {
  if (!fades || elapsed <= WASH_HOLD_MS) return 1;
  const t = Math.min(1, (elapsed - WASH_HOLD_MS) / WASH_FADE_MS);
  // Ease out: quick at first, settling at none.
  return (1 - t) ** 2;
}

function channels(hex: string): [number, number, number] | undefined {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (match === null) return undefined;
  const n = Number.parseInt(match[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** The wash's accent, by look: M3 primary in Material, the accent in the iOS look. */
export function washAccent(
  look: 'ios' | 'material',
  colors: { readonly accent: string },
  m3: { readonly primary: string },
): string {
  return look === 'material' ? m3.primary : colors.accent;
}

/**
 * The washed text's background: `base` (the page, or the verse's
 * highlight) with `tint` × `strength` of the accent mixed in, as an
 * opaque #RRGGBB. Colours that aren't #RRGGBB leave the base as it is.
 */
export function washFill(base: string, accent: string, strength: number, tint: number = WASH_TINT): string {
  const from = channels(base);
  const to = channels(accent);
  if (from === undefined || to === undefined) return base;
  const amount = tint * Math.max(0, Math.min(1, strength));
  const mixed = from.map((c, i) => Math.round(c + (to[i] - c) * amount));
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/**
 * The most tint (up to `WASH_TINT`) that keeps `text` at
 * `IC_TEXT_CONTRAST` against the fill at every tint up to it, so the fade
 * never dips below the floor either. A base the text already fails, or
 * colours it can't read, get none.
 */
export function contrastCappedTint(base: string, accent: string, text: string): number {
  if (channels(base) === undefined || channels(accent) === undefined || channels(text) === undefined) return 0;
  let tint = 0;
  for (let step = 1; step <= Math.round(WASH_TINT / TINT_STEP); step++) {
    const next = step * TINT_STEP;
    if (contrast(text, washFill(base, accent, 1, next)) < IC_TEXT_CONTRAST) break;
    tint = next;
  }
  // The base itself must pass too, or the text fails before any wash.
  return contrast(text, base) < IC_TEXT_CONTRAST ? 0 : tint;
}

/**
 * How much of the accent the wash mixes into `base` at full strength.
 * Normally `WASH_TINT`. Under Increase Contrast, the contrast-capped tint
 * (7:1 kept through the fade), or none where that is under
 * `IC_TINT_FLOOR`: over a highlight, which already sits near 7:1, the cap
 * leaves next to nothing, so there is no wash and the number's accent pill
 * marks the landing.
 */
export function washTint(base: string, accent: string, text: string, increaseContrast: boolean): number {
  if (!increaseContrast) return WASH_TINT;
  const tint = contrastCappedTint(base, accent, text);
  return tint < IC_TINT_FLOOR ? 0 : tint;
}

/**
 * The wash a search arrival starts (spec §3.3: the landing marker is "the
 * same as Search"): a search hit (or a passage link) that opens a chapter
 * at a verse washes it as a bookmark jump does. Arrivals are told apart
 * from jumps by their sign: a search arrival's id is negative.
 */
export function searchArrivalWash(
  chapterKey: string,
  verse: number | undefined,
  count: number,
  reducedMotion: boolean,
): WashEvent | undefined {
  if (verse === undefined) return undefined;
  return { kind: 'land', chapterKey, verse, arrival: -count, reducedMotion };
}
