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
  type Workspace,
} from 'berean-ffi-rn';

import { library, reader, userdata } from '@/ffi/core';
import { displayTitle } from '@/library/labels';
import { load } from '@/library/load';
import { notesChanged } from '@/notes/changes';
import { allNotes, makeReferencer } from '@/notes/data';
import { byModified, noteTitle } from '@/notes/note-list';
import { spanReference } from '@/reader/bible-nav';
import type { Rect } from '@/studyspace/camera';
import { cardAccessibilityLabel, type CardKind } from '@/studyspace/cards';

export type CardView = {
  id: bigint;
  kind: CardKind;
  frame: Rect;
  /** A note card's note, so a note isn't offered twice for one workspace. */
  noteId: string | undefined;
  title: string;
  missing: boolean;
  accessibilityLabel: string;
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

/**
 * Remember `id` as the workspace open last (none clears it). A workspace
 * that has gone (NotFound) isn't remembered; the screen's next read falls
 * back to the first. Any other failure only means a different workspace
 * opens next launch, so neither is shown.
 */
export function rememberWorkspace(id: bigint | undefined) {
  try {
    userdata().setLastWorkspace(id);
  } catch {
    // See above: nothing to tell the reader.
  }
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
    } else {
      kind = 'publication';
      title = reference(card.inner.location) ?? 'Publication';
      missing = card.inner.missing;
    }
    return {
      id: item.id,
      kind,
      frame: item.frame,
      noteId,
      title,
      missing,
      accessibilityLabel: cardAccessibilityLabel(kind, title, missing),
    };
  });
}

/** Something to add to a workspace, with its title for the announcement. */
export type Addable = { card: CardRef; title: string };

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
  return { card: CardRef.Note.new({ noteId: note.id }), title: noteTitle(note) };
}

/** Every installed publication, as a whole-publication card: a location with only its key. */
export function readAddablePublications(): Addable[] {
  const read = load(() => library().installed());
  return (read.ok ? read.value : []).map((p) => ({
    card: CardRef.Publication.new({ location: { pubKey: p.pubKey }, missing: false }),
    title: displayTitle(p),
  }));
}
