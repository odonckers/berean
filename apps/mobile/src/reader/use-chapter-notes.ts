import type { Note } from 'berean-ffi-rn';
import { useMemo } from 'react';

import { userdata } from '@/ffi/core';
import { useNotesRead } from '@/notes/data';
import { byModified } from '@/notes/note-list';
import { notesByVerse } from '@/notes/verse-notes';

/**
 * The chapter's notes by verse, most recently modified first. The core
 * picks them (notes at the chapter's location include its verses'); read
 * once per chapter, again when the notes change or the reader regains
 * focus. On an error the chapter shows no notes rather than failing.
 */
export function useChapterNotes(pubKey: string, book: number, chapter: number): ReadonlyMap<number, Note[]> {
  const read = useNotesRead(`${pubKey}/${book}/${chapter}`, () =>
    userdata().notes({ location: { pubKey, book, chapter }, tagIds: [] }),
  );
  return useMemo(() => notesByVerse(read.ok ? byModified(read.value) : [], { book, chapter }), [read, book, chapter]);
}
