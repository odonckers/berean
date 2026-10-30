// The Notes screens' reads of the core, and the reader and publication
// lookups they word metadata with. Every read is a synchronous FFI call on
// the JS thread, as the reader's are.
import {
  PubKind,
  type BibleBook,
  type Location,
  type LocationSpan,
  type Note,
  type PublicationSummary,
} from 'berean-ffi-rn';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking } from 'react-native';

import { library, reader, userdata } from '@/ffi/core';
import { coreErrorMessage } from '@/ffi/errors';
import { displayTitle } from '@/library/labels';
import { load, type Loaded } from '@/library/load';
import { spanReference } from '@/reader/bible-nav';
import { chapterBlocks } from '@/reader/chapter-blocks';
import { verseText } from '@/reader/copy-verse';
import { notesChanged, onNotesChanged } from '@/notes/changes';
import { noteSnippet, spanStart, spanVerses, type NoteSpan } from '@/notes/note-text';

/**
 * `read` from the core, read again whenever the screen comes into focus,
 * the notes change, or `key` (what `read` depends on) changes.
 */
export function useNotesRead<T>(key: string, read: () => T): Loaded<T> {
  const [version, setVersion] = useState(0);
  const reread = useCallback(() => setVersion((v) => v + 1), []);
  useFocusEffect(reread);
  useEffect(() => onNotesChanged(reread), [reread]);
  // `read` is new every render; key and version say when it reads anew.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => load(read), [key, version]);
}

/**
 * Apply a change through the core, then tell every Notes screen. A core
 * error's message, or none.
 */
export function changeNotes(apply: () => void): string | undefined {
  let message: string | undefined;
  try {
    apply();
  } catch (e) {
    message = coreErrorMessage(e);
  }
  notesChanged();
  return message;
}

/** Every note. The core has no read by id, so a note is found among them. */
export function allNotes(): Note[] {
  return userdata().notes({ tagIds: [] });
}

export function findNote(id: string): Note | undefined {
  return allNotes().find((n) => n.id === id);
}

// Snippets by note id and modified stamp: a list renders each body once.
const snippets = new Map<string, string>();

/** A note row's snippet, from the core's rendering of its body. */
export function snippetOf(note: Note): string {
  const key = `${note.id}@${note.modified}`;
  let snippet = snippets.get(key);
  if (snippet === undefined) {
    const blocks = load(() => userdata().renderMarkdown(note.content));
    snippet = blocks.ok ? noteSnippet(blocks.value, note.title) : '';
    snippets.set(key, snippet);
  }
  return snippet;
}

/**
 * Words locations as references: "Genesis 1:4" for a Bible verse, the
 * publication's title for a publication. One per list, so each Bible's
 * books and the installed list are read once.
 */
export function makeReferencer(): (location: Location | undefined) => string | undefined {
  const books = new Map<string, BibleBook[] | undefined>();
  let installed: PublicationSummary[] | undefined;
  return (location) => {
    if (location === undefined) return undefined;
    if (location.book !== undefined) {
      if (!books.has(location.pubKey)) {
        const listed = load(() => reader().bibleBooks(location.pubKey));
        books.set(location.pubKey, listed.ok ? listed.value : undefined);
      }
      return spanReference(books.get(location.pubKey), { start: location, end: location });
    }
    installed ??= installedPublications();
    const pub = installed.find((p) => p.pubKey === location.pubKey);
    return pub && displayTitle(pub);
  };
}

function installedPublications(): PublicationSummary[] {
  const read = load(() => library().installed());
  return read.ok ? read.value : [];
}

export function installedPublication(pubKey: string): PublicationSummary | undefined {
  return installedPublications().find((p) => p.pubKey === pubKey);
}

/** The first installed Bible, for the sample notes' links and locations. */
export function firstInstalledBible(): PublicationSummary | undefined {
  return installedPublications().find((p) => p.kind === PubKind.Bible);
}

/**
 * A passage card's verse text, from the reader's own chapter, as Copy verse
 * takes it. Empty when the Bible can't be read or the span runs over
 * chapters; the card then shows its reference alone.
 */
export function passageText(span: NoteSpan): string {
  const verses = spanVerses(span);
  const { pubKey, book, chapter } = span.start;
  if (verses === undefined || book === undefined || chapter === undefined) return '';
  const read = load(() => chapterBlocks(reader().bibleChapter(pubKey, book, chapter).blocks));
  if (!read.ok) return '';
  return verses
    .map((v) => verseText(read.value, v))
    .filter((t) => t !== '')
    .join(' ');
}

/** Open the Read tab's Bible at a passage's first verse, as a search hit does. */
export function openPassage(span: LocationSpan) {
  const at = spanStart(span);
  if (at === undefined) return;
  const pub = installedPublication(at.pubKey);
  router.navigate({
    pathname: '/',
    params: {
      pubKey: at.pubKey,
      title: pub ? displayTitle(pub) : '',
      book: String(at.book),
      chapter: String(at.chapter),
      ...(at.verse === undefined ? {} : { verse: String(at.verse) }),
    },
  });
}

/** Open a publication, or one document of it, in the Read tab. */
export function openPublication(location: Location) {
  const pub = installedPublication(location.pubKey);
  router.navigate({
    pathname: '/publication',
    params: {
      pubKey: location.pubKey,
      title: pub ? displayTitle(pub) : '',
      ...(location.docId === undefined ? {} : { docId: String(location.docId) }),
    },
  });
}

export function openExternal(url: string) {
  Linking.openURL(url).catch(() => {});
}
