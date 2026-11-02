// Studyspace's reads of the core: the workspaces, the one open last, one
// workspace's cards with what each shows, and what can be added to it.
// Synchronous FFI calls on the JS thread, as the Notes screens' are.
import {
  CardRef,
  CoreError,
  CoreError_Tags,
  ItemOrder,
  type BibleBook,
  type CanvasItem,
  type Location,
  type LocationSpan,
  ReaderState,
  type Workspace,
} from 'berean-ffi-rn';

import { library, reader, userdata } from '@/ffi/core';
import { coreErrorMessage } from '@/ffi/errors';
import { displayTitle } from '@/library/labels';
import { load } from '@/library/load';
import { notesChanged } from '@/notes/changes';
import { allNotes, makeReferencer } from '@/notes/data';
import { byModified, noteTitle } from '@/notes/note-list';
import { spanReference } from '@/reader/bible-nav';
import { blockSegments } from '@/reader/chapter-blocks';
import type { Rect } from '@/studyspace/camera';
import { cardAccessibilityLabel, type CardKind } from '@/studyspace/cards';
import {
  bibleRows,
  documentRows,
  type Position,
  readerAt,
  type ReaderScope,
  type Row,
} from '@/studyspace/reader-state';
import { placeOrDiscard, quietWrite, type Remembered, rememberOutcome } from '@/studyspace/writes';

/**
 * A passage or publication card's live text source (§6.6): the card's own
 * span or location, and where its reader was left, if it has been read.
 */
export type CardReader = {
  card: { kind: 'passage'; span: LocationSpan } | { kind: 'publication'; location: Location };
  /** The saved anchor's location (a verse, or a paragraph) and offset; none if never read. */
  saved: { at: Location; charOffset: number } | undefined;
  /** Names the text the card reads (its chapter or document), so it is read once per card. */
  textKey: string;
};

export type CardView = {
  id: bigint;
  kind: CardKind;
  frame: Rect;
  /** A note card's note, so a note isn't offered twice for one workspace. */
  noteId: string | undefined;
  title: string;
  missing: boolean;
  accessibilityLabel: string;
  /** A passage or publication card's reader; none for a note. */
  reader: CardReader | undefined;
};

/**
 * The core's reason for refusing a workspace name (empty, or taken), as a
 * sentence for the dialog; undefined for any other error.
 */
export function invalidNameMessage(e: unknown): string | undefined {
  // Not `instanceof`: Babel breaks Error subclassing (see ffi/errors.ts).
  if (typeof e !== 'object' || e === null || !CoreError.instanceOf(e) || e.tag !== CoreError_Tags.Invalid) {
    return undefined;
  }
  const reason = e.inner[0];
  return `${reason.charAt(0).toUpperCase()}${reason.slice(1)}.`;
}

export function readWorkspaces(): Workspace[] {
  return userdata().workspaces();
}

/** The workspace open last, kept by the core across launches; none if it can't be read. */
export function readLastWorkspace(): bigint | undefined {
  const read = load(() => userdata().lastWorkspace());
  return read.ok ? read.value : undefined;
}

/** Whether `e` is the core's NotFound. */
function isNotFound(e: unknown): boolean {
  // Not `instanceof`: Babel breaks Error subclassing (see ffi/errors.ts).
  return typeof e === 'object' && e !== null && CoreError.instanceOf(e) && e.tag === CoreError_Tags.NotFound;
}

/**
 * Remember `id` as the workspace open last (none clears it). A workspace
 * that has gone (NotFound) isn't remembered: 'gone', so the screen reads
 * again and falls back to the first. Any other failure only means a
 * different workspace opens next launch. Neither is shown.
 */
export function rememberWorkspace(id: bigint | undefined): Remembered {
  return rememberOutcome(() => userdata().setLastWorkspace(id), isNotFound);
}

/** Workspace `id`'s cards, back to front, with their titles. */
export function readCards(id: bigint): CardView[] {
  const items = userdata().items(id, ItemOrder.Z);
  const books = new Map<string, BibleBook[] | undefined>();
  const bibleBooks = (pubKey: string) => {
    if (!books.has(pubKey)) {
      const read = load(() => reader().bibleBooks(pubKey));
      books.set(pubKey, read.ok ? read.value : undefined);
    }
    return books.get(pubKey);
  };
  const reference = makeReferencer();

  return items.map((item: CanvasItem) => {
    const card = item.card;
    let kind: CardKind;
    let title: string;
    let missing: boolean;
    let noteId: string | undefined;
    let cardReader: CardReader | undefined;
    if (CardRef.Note.instanceOf(card)) {
      noteId = card.inner.noteId;
      // A note that can't be read shows as missing, as a deleted one does.
      const read = load(() => userdata().note(card.inner.noteId));
      const note = read.ok ? read.value : undefined;
      kind = 'note';
      title = note ? noteTitle(note) : 'Deleted note';
      missing = note === undefined;
    } else if (CardRef.Passage.instanceOf(card)) {
      kind = 'passage';
      title = spanReference(bibleBooks(card.inner.span.start.pubKey), card.inner.span) ?? 'Passage';
      missing = card.inner.missing;
      cardReader = readerOf({ kind: 'passage', span: card.inner.span }, item);
    } else {
      kind = 'publication';
      title = reference(card.inner.location) ?? 'Publication';
      missing = card.inner.missing;
      cardReader = readerOf({ kind: 'publication', location: card.inner.location }, item);
    }
    return {
      id: item.id,
      kind,
      frame: item.frame,
      noteId,
      title,
      missing,
      accessibilityLabel: cardAccessibilityLabel(kind, title, missing),
      reader: cardReader,
    };
  });
}

/** The reader state's location: its verse span's start, or its location; none if never read. */
function savedAt(item: CanvasItem): CardReader['saved'] {
  const state = item.reader;
  if (state === undefined) return undefined;
  const at = state.at;
  if (CardRef.Passage.instanceOf(at)) return { at: at.inner.span.start, charOffset: state.charOffset };
  if (CardRef.Publication.instanceOf(at)) return { at: at.inner.location, charOffset: state.charOffset };
  return undefined;
}

function readerOf(card: CardReader['card'], item: CanvasItem): CardReader {
  const saved = savedAt(item);
  // The text is the saved anchor's chapter or document when there is one,
  // so a reader left in another one (by another device) still restores.
  const textKey =
    card.kind === 'passage'
      ? `${card.span.start.pubKey}:${saved?.at.book ?? card.span.start.book}:${saved?.at.chapter ?? card.span.start.chapter}`
      : `${card.location.pubKey}:${saved?.at.docId ?? card.location.docId ?? 'toc'}`;
  return { card, saved, textKey };
}

/** A reader card's live text: its rows, what they are (for saving), and the anchor to start at. */
export type ReaderTextRead = { rows: Row[]; scope: ReaderScope; wanted: Position | undefined };

/**
 * A reader card's text (§5 L3 and L4), read synchronously: a passage's
 * chapter (the saved verse's, else its span start's), or a publication's
 * document (the saved paragraph's, else its location's, else the first
 * TOC entry with a document, in the core's order). Throws as the core
 * does; wrap it in load().
 */
export function readReaderText({ card, saved }: CardReader): ReaderTextRead {
  if (card.kind === 'passage') {
    const start = card.span.start;
    const book = saved?.at.book ?? start.book;
    const chapter = saved?.at.chapter ?? start.chapter;
    if (book === undefined || chapter === undefined) throw new Error('This passage has no chapter to read.');
    const read = reader().bibleChapter(start.pubKey, book, chapter);
    // No reader state: the span's first verse (none for a whole chapter: its first block).
    const verse = saved?.at.verse ?? start.verse;
    return {
      rows: bibleRows(read.blocks, blockSegments),
      scope: { kind: 'passage', verse: start, book, chapter },
      wanted: verse === undefined ? undefined : { key: verse, charOffset: saved?.charOffset ?? 0 },
    };
  }
  const { pubKey } = card.location;
  // Core ask (Echo): a publication card's starting document (a location
  // with no docId) is picked app-side, as the first TOC entry with one.
  const docId =
    saved?.at.docId ?? card.location.docId ?? reader().toc(pubKey).find((e) => e.docId !== undefined)?.docId;
  if (docId === undefined) throw new Error('This publication has no text to read.');
  const read = reader().document(pubKey, docId);
  const paragraph = saved?.at.paragraph ?? (card.location.docId === docId ? card.location.paragraph : undefined);
  return {
    rows: documentRows(read.blocks),
    scope: { kind: 'publication', pubKey, docId },
    wanted: paragraph === undefined ? undefined : { key: paragraph, charOffset: saved?.charOffset ?? 0 },
  };
}

function logWriteError(what: string) {
  return (e: unknown) => console.warn(`Studyspace: couldn’t ${what}: ${coreErrorMessage(e)}`);
}

/**
 * Save where card `id`'s reader is (§6.6), once its scroll settles. The
 * core checks the anchor and bumps the card's last_used_at. A failure is
 * logged, never thrown.
 */
export function saveReaderState(id: bigint, scope: ReaderScope, position: Position): boolean {
  const at = readerAt(scope, position);
  const ref =
    at.kind === 'passage'
      ? CardRef.Passage.new({ span: at.span, missing: false })
      : CardRef.Publication.new({ location: at.location, missing: false });
  return quietWrite(
    () => userdata().setReaderState(id, ReaderState.new({ at: ref, charOffset: position.charOffset })),
    logWriteError('save a reader card’s place'),
  );
}

/** Mark card `id` as just used (§6.6): it became the card being read. Logged, never thrown. */
export function touchCard(id: bigint): boolean {
  return quietWrite(() => userdata().touchItem(id), logWriteError('mark a card as used'));
}

/**
 * Something to add to a workspace, with its title for the announcement;
 * and the note made for it, if New note made one.
 */
export type Addable = { card: CardRef; title: string; createdNoteId?: string };

/**
 * The notes not on the workspace with `cards` yet (the core takes a note
 * once per workspace), most recently changed first.
 */
export function readAddableNotes(cards: readonly CardView[]): Addable[] {
  const there = new Set(cards.map((c) => c.noteId));
  return byModified(allNotes())
    .filter((n) => !there.has(n.id))
    .map((n) => ({ card: CardRef.Note.new({ noteId: n.id }), title: noteTitle(n) }));
}

/** A new empty note, made as the Notes list's New Note makes one, to add as a card. */
export function newNote(): Addable {
  const note = userdata().addNote('', '', undefined, undefined, undefined);
  notesChanged();
  return { card: CardRef.Note.new({ noteId: note.id }), title: noteTitle(note), createdNoteId: note.id };
}

/**
 * `place()`'s result; if it throws, the note New note made for `made` is
 * removed (the core has no make-and-place call), and the error rethrown.
 */
export function placeAddable<T>(made: Addable, place: () => T): T {
  return placeOrDiscard(made, place, (id) => {
    userdata().removeNote(id);
    notesChanged();
  });
}

/** Every installed publication, as a whole-publication card: a location with only its key. */
export function readAddablePublications(): Addable[] {
  const read = load(() => library().installed());
  return (read.ok ? read.value : []).map((p) => ({
    card: CardRef.Publication.new({ location: { pubKey: p.pubKey }, missing: false }),
    title: displayTitle(p),
  }));
}
