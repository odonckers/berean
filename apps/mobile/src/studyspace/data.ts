// Studyspace's reads of the core: the workspaces, and one workspace's cards
// with what each shows. Synchronous FFI calls on the JS thread, as the
// Notes screens' are.
import {
  CardRef,
  CoreError,
  CoreError_Tags,
  ItemOrder,
  type BibleBook,
  type CanvasItem,
  type Workspace,
} from 'berean-ffi-rn';

import { reader, userdata } from '@/ffi/core';
import { load } from '@/library/load';
import { allNotes, makeReferencer } from '@/notes/data';
import { noteTitle } from '@/notes/note-list';
import { spanReference } from '@/reader/bible-nav';
import type { Rect } from '@/studyspace/camera';
import { cardAccessibilityLabel, type CardKind } from '@/studyspace/cards';

export type CardView = {
  id: bigint;
  kind: CardKind;
  frame: Rect;
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

/** Workspace `id`'s cards, back to front, with their titles. */
export function readCards(id: bigint): CardView[] {
  const items = userdata().items(id, ItemOrder.Z);
  // The core has no note-by-id read, so the notes are read once and looked up.
  const notes = items.some((i) => CardRef.Note.instanceOf(i.card))
    ? new Map(allNotes().map((n) => [n.id, n]))
    : new Map();
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
    if (CardRef.Note.instanceOf(card)) {
      const note = notes.get(card.inner.noteId);
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
      title,
      missing,
      accessibilityLabel: cardAccessibilityLabel(kind, title, missing),
    };
  });
}
