/**
 * The verse a search hit or a bookmark jump opened the chapter at, marked
 * with the selected verse number's treatment until the reader presses a
 * verse number (which opens or closes a pane; an opened pane then marks its
 * own verse) or the chapter changes. It is not the pane's selection:
 * marking never opens study.
 *
 * An arrival can carry a nonce: each bookmark jump is its own arrival, even
 * to the verse already marked, so it lands (scrolls and takes focus) again.
 * Without one (a search hit, by its route param), the same verse arriving
 * again is the same arrival. A bookmark's source is kept, so its action
 * label says how it was reached.
 */
export type LandedSource = 'search' | 'bookmark';

export type LandedVerse =
  | {
      readonly chapterKey: string;
      readonly verse: number;
      /** The arrival's nonce, if it has one. */
      readonly arrival?: number;
      /** How it was reached; none is a search hit. */
      readonly source?: 'bookmark';
    }
  | undefined;

export type LandedEvent =
  | {
      readonly kind: 'arrive';
      readonly chapterKey: string;
      readonly verse: number;
      readonly arrival?: number;
      readonly source?: 'bookmark';
    }
  | { readonly kind: 'press'; readonly verse: number }
  | { readonly kind: 'chapter'; readonly chapterKey: string };

export function landedVerse(prev: LandedVerse, event: LandedEvent): LandedVerse {
  switch (event.kind) {
    case 'arrive': {
      const { chapterKey, verse, arrival, source } = event;
      if (
        prev?.chapterKey === chapterKey &&
        prev.verse === verse &&
        prev.arrival === arrival &&
        prev.source === source
      ) {
        return prev;
      }
      return {
        chapterKey,
        verse,
        ...(arrival === undefined ? {} : { arrival }),
        ...(source === undefined ? {} : { source }),
      };
    }
    case 'press':
      return undefined;
    case 'chapter':
      return prev?.chapterKey === event.chapterKey ? prev : undefined;
  }
}

/**
 * A verse's action label while it is the landed verse: ", search result",
 * or ", bookmark" for a bookmark jump.
 */
export function landedLabel(label: string, landed: boolean, source: LandedSource = 'search'): string {
  if (!landed) return label;
  return source === 'bookmark' ? `${label}, bookmark` : `${label}, search result`;
}
