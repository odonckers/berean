import { HighlightColor, type Highlight } from 'berean-ffi-rn';
import { useMemo, useState } from 'react';

import type { HighlightName } from '@/design/tokens';
import { userdata } from '@/ffi/core';
import { coreErrorMessage } from '@/ffi/errors';
import {
  type ChapterHighlight,
  type CoreColorName,
  type VerseHighlight,
  highlightsByVerse,
  toCoreColorName,
  toHighlightName,
  wholeVerseRange,
} from '@/reader/highlights';

type ChapterHighlights = {
  /** The highlight on each verse of the chapter. */
  byVerse: ReadonlyMap<number, VerseHighlight>;
  /** Highlight `verse` in `color`, or recolor its highlight. A core error's message, or none. */
  highlight: (verse: number, color: HighlightName) => string | undefined;
  /** Remove the highlight drawn on `verse`. A core error's message, or none. */
  remove: (verse: number) => string | undefined;
};

const coreColor = (name: HighlightName): HighlightColor => HighlightColor[toCoreColorName(name)];

function readChapter(pubKey: string, book: number, chapter: number): ChapterHighlight[] {
  // A synchronous FFI call on the JS thread, as the chapter's own read is.
  // On an error the chapter shows no highlights rather than failing to open.
  let highlights: Highlight[];
  try {
    highlights = userdata().highlights(pubKey, { pubKey, book, chapter });
  } catch {
    return [];
  }
  return highlights.map((h) => ({
    id: h.id,
    span: h.range.span,
    color: toHighlightName(HighlightColor[h.color] as CoreColorName),
  }));
}

/**
 * The chapter's highlights, read from the core when the chapter changes and
 * again after each change. The core keeps them; this is only what the last
 * read returned.
 */
export function useChapterHighlights(
  pubKey: string,
  book: number,
  chapter: number,
  verses: readonly number[],
): ChapterHighlights {
  const key = `${pubKey}/${book}/${chapter}`;
  const [read, setRead] = useState(() => ({ key, highlights: readChapter(pubKey, book, chapter) }));
  let current = read;
  if (read.key !== key) {
    current = { key, highlights: readChapter(pubKey, book, chapter) };
    setRead(current);
  }
  const { highlights } = current;
  const byVerse = useMemo(
    () => highlightsByVerse(highlights, { book, chapter }, verses),
    [highlights, book, chapter, verses],
  );

  // Each change reads the chapter back, whether or not the core took it.
  // A verse under a highlight spanning several verses (an imported one)
  // recolors or removes that whole highlight: the core has no way to split
  // it, and the reader no way to show part of one.
  const change = (apply: () => void): string | undefined => {
    let message: string | undefined;
    try {
      apply();
    } catch (e) {
      message = coreErrorMessage(e);
    }
    setRead({ key, highlights: readChapter(pubKey, book, chapter) });
    return message;
  };

  return {
    byVerse,
    highlight: (verse, color) =>
      change(() => {
        const existing = byVerse.get(verse);
        if (existing === undefined) {
          userdata().addHighlight(wholeVerseRange(pubKey, book, chapter, verse), coreColor(color));
        } else if (existing.color !== color) {
          userdata().setHighlightColor(existing.id, coreColor(color));
        }
      }),
    remove: (verse) =>
      change(() => {
        const existing = byVerse.get(verse);
        if (existing !== undefined) userdata().removeHighlight(existing.id);
      }),
  };
}
