// Undo after a bookmark Delete or Replace (bookmarks spec §3.2, §5, §7),
// and the reader's one bar at a time that offers it or notes where a jump
// went, kept free of React Native so Node can test it. The core keeps the
// bookmarks; an Undo is the held bookmark written back with set_bookmark.

import { UNDO_SCREEN_READER_MS } from '../notes/undo.ts';
import type { BookmarkLocation } from './bookmarks.ts';

/** How long Undo stays (spec §3.2: 6 s). */
export const BOOKMARK_UNDO_MS = 6_000;
/** How long the not-found toast stays: an M3 short snackbar. */
export const BOOKMARK_NOTICE_MS = 4_000;

/** A bookmark as the core held it before a change, kept whole to put back. */
export type HeldBookmark = {
  pubKey: string;
  slot: number;
  location: BookmarkLocation;
  title: string;
  snippet?: string;
};

export type BookmarkChange =
  | { kind: 'delete'; previous: HeldBookmark }
  /** `reference` is what took the slot. */
  | { kind: 'replace'; previous: HeldBookmark; reference: string };

/** The bar over the picker or the reader: Undo for the last change, or a notice. */
export type BookmarkBar =
  | { readonly id: number; readonly kind: 'undo'; readonly change: BookmarkChange }
  | { readonly id: number; readonly kind: 'notice'; readonly message: string }
  | undefined;

export type BookmarkBarEvent =
  /** A Delete or Replace took effect: offer its Undo. */
  | { kind: 'changed'; change: BookmarkChange }
  /** Say where a jump went instead. */
  | { kind: 'notice'; message: string }
  /** Undo was pressed (and the held bookmark written back). */
  | { kind: 'undone' }
  /** Bar `id`'s time is up. */
  | { kind: 'expired'; id: number }
  /** A save wrote into a slot: an Undo that would overwrite it goes. */
  | { kind: 'saved'; pubKey: string; slot: number }
  /** The picker's screen went (the reader lost focus, or its publication changed): spec §7. */
  | { kind: 'left' };

/**
 * One bar at a time: the newest replaces the last (its Undo then gone),
 * and each is its own, so its clock restarts. Nothing is put back over a
 * later save into the same slot (spec §7: nothing is overwritten silently).
 */
export function bookmarkBar(prev: BookmarkBar, event: BookmarkBarEvent): BookmarkBar {
  const id = (prev?.id ?? 0) + 1;
  switch (event.kind) {
    case 'changed':
      return { id, kind: 'undo', change: event.change };
    case 'notice':
      return { id, kind: 'notice', message: event.message };
    case 'undone':
      return prev?.kind === 'undo' ? undefined : prev;
    case 'expired':
      return prev?.id === event.id ? undefined : prev;
    case 'saved': {
      if (prev?.kind !== 'undo') return prev;
      const { pubKey, slot } = prev.change.previous;
      return pubKey === event.pubKey && slot === event.slot ? undefined : prev;
    }
    case 'left':
      return undefined;
  }
}

/** What Undo writes back with set_bookmark: the held bookmark as the core stored it. */
export function restoreArgs(previous: HeldBookmark): {
  pubKey: string;
  slot: number;
  location: BookmarkLocation;
  title: string;
  snippet: string | undefined;
} {
  const { pubKey, slot, location, title, snippet } = previous;
  return { pubKey, slot, location, title, snippet };
}

/**
 * What the bar shows, and what is announced as it appears. Material names
 * what kind of thing changed ("Bookmark deleted"), the iOS look what went
 * (Deleted “John 3:16”), as the notes' Undo does; the announcement says
 * the slot either way.
 */
export function bookmarkUndoMessages(
  look: 'ios' | 'material',
  change: BookmarkChange,
): { label: string; announcement: string } {
  const number = change.previous.slot + 1;
  const { title } = change.previous;
  if (change.kind === 'delete') {
    return {
      label: look === 'material' ? 'Bookmark deleted' : `Deleted “${title}”`,
      announcement: `Slot ${number}, ${title} deleted. Undo available.`,
    };
  }
  return {
    label: look === 'material' ? 'Bookmark replaced' : `Replaced “${title}”`,
    announcement: `Slot ${number} replaced with ${change.reference}. Undo available.`,
  };
}

export function restoredAnnouncement(previous: HeldBookmark): string {
  return `Restored slot ${previous.slot + 1}, ${previous.title}`;
}

/** How long a bar stays; with a screen reader on, long enough to swipe to it (guide). */
export function barDuration(bar: NonNullable<BookmarkBar>, screenReaderOn: boolean): number {
  if (screenReaderOn) return UNDO_SCREEN_READER_MS;
  return bar.kind === 'undo' ? BOOKMARK_UNDO_MS : BOOKMARK_NOTICE_MS;
}
