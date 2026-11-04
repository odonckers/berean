// The landing wash (bookmarks spec §3.3, §5): after a bookmark jump to a
// verse, besides the number's accent pill, the verse's text gets a tinted
// wash. It fades out after 2 s, or clears on the next scroll or tap; under
// Reduce Motion it is static and clears only on the next scroll or tap.
// Kept free of React Native so Node can test it.

/** The wash holds this long before it fades (spec §3.3: 2 s). */
export const WASH_HOLD_MS = 2_000;
/** Then fades out over this long. */
export const WASH_FADE_MS = 400;
/** How much of the accent the wash mixes into the text's background at full strength. */
export const WASH_TINT = 0.2;

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

/**
 * The washed text's background: `base` (the page, or the verse's
 * highlight) with `WASH_TINT` × `strength` of the accent mixed in, as an
 * opaque #RRGGBB. Colours that aren't #RRGGBB leave the base as it is.
 */
export function washFill(base: string, accent: string, strength: number): string {
  const from = channels(base);
  const to = channels(accent);
  if (from === undefined || to === undefined) return base;
  const amount = WASH_TINT * Math.max(0, Math.min(1, strength));
  const mixed = from.map((c, i) => Math.round(c + (to[i] - c) * amount));
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}
