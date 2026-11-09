import type { Bookmark } from 'berean-ffi-rn';
import { useCallback, useState } from 'react';

import { userdata } from '@/ffi/core';
import { coreErrorMessage } from '@/ffi/errors';
import { type Loaded, load } from '@/library/load';
import type { BookmarkPlace } from '@/reader/bookmarks';
import { bookmarkLocation } from '@/reader/bookmarks';
import { type HeldBookmark, restoreArgs } from '@/reader/bookmark-undo';

type PublicationBookmarks = {
  /** The publication's bookmarks as the core last returned them, or the read's error. */
  list: Loaded<Bookmark[]>;
  /** Read them again (the picker opening). */
  refresh: () => void;
  /** Save `place` into `slot` (0–9), replacing it. A core error's message, or none. */
  save: (slot: number, place: BookmarkPlace, title: string, snippet: string | undefined) => string | undefined;
  /** Empty `slot`. A core error's message, or none. */
  remove: (slot: number) => string | undefined;
  /** Put a held bookmark back as it was (Undo). A core error's message, or none. */
  restore: (held: HeldBookmark) => string | undefined;
};

// A synchronous FFI call on the JS thread, as the chapter's own read is.
const read = (pubKey: string) => load(() => userdata().bookmarks(pubKey));

/**
 * The open publication's bookmarks, read when it changes, when asked, and
 * after each change. The core keeps them; this is only what the last read
 * returned.
 */
export function useBookmarks(pubKey: string): PublicationBookmarks {
  const [state, setState] = useState(() => ({ pubKey, list: read(pubKey) }));
  let current = state;
  if (state.pubKey !== pubKey) {
    current = { pubKey, list: read(pubKey) };
    setState(current);
  }

  const refresh = useCallback(() => setState({ pubKey, list: read(pubKey) }), [pubKey]);

  // Each change reads the list back, whether or not the core took it.
  const write = (change: () => void) => {
    let message: string | undefined;
    try {
      change();
    } catch (e) {
      message = coreErrorMessage(e);
    }
    refresh();
    return message;
  };
  const save = (slot: number, place: BookmarkPlace, title: string, snippet: string | undefined) =>
    write(() => userdata().setBookmark(pubKey, slot, bookmarkLocation(pubKey, place), title, snippet));
  const remove = (slot: number) => write(() => userdata().removeBookmark(pubKey, slot));
  const restore = (held: HeldBookmark) =>
    write(() => {
      const { pubKey: key, slot, location, title, snippet } = restoreArgs(held);
      userdata().setBookmark(key, slot, location, title, snippet);
    });

  return { list: current.list, refresh, save, remove, restore };
}
