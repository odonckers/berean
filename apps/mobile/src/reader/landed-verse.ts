/**
 * The verse a search hit opened the chapter at, marked with the selected
 * verse number's treatment until the reader presses a verse number (which
 * opens or closes a pane; an opened pane then marks its own verse) or the
 * chapter changes. It is not the pane's selection: marking never opens
 * study.
 */
export type LandedVerse = { readonly chapterKey: string; readonly verse: number } | undefined;

export type LandedEvent =
  | { readonly kind: 'arrive'; readonly chapterKey: string; readonly verse: number }
  | { readonly kind: 'press'; readonly verse: number }
  | { readonly kind: 'chapter'; readonly chapterKey: string };

export function landedVerse(prev: LandedVerse, event: LandedEvent): LandedVerse {
  switch (event.kind) {
    case 'arrive':
      return prev?.chapterKey === event.chapterKey && prev.verse === event.verse
        ? prev
        : { chapterKey: event.chapterKey, verse: event.verse };
    case 'press':
      return undefined;
    case 'chapter':
      return prev?.chapterKey === event.chapterKey ? prev : undefined;
  }
}

/** A verse's action label, with ", search result" while it is the landed verse. */
export function landedLabel(label: string, landed: boolean): string {
  return landed ? `${label}, search result` : label;
}
