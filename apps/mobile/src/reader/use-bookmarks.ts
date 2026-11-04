import type { Bookmark } from 'berean-ffi-rn';
import { useCallback, useState } from 'react';

import { userdata } from '@/ffi/core';
import { coreErrorMessage } from '@/ffi/errors';
import { type Loaded, load } from '@/library/load';
import type { BiblePlace } from '@/reader/bookmarks';
import { bookmarkLocation } from '@/reader/bookmarks';

type PublicationBookmarks = {
  /** The publication's bookmarks as the core last returned them, or the read's error. */
  list: Loaded<Bookmark[]>;
  /** Read them again (the picker opening). */
  refresh: () => void;
  /** Save `place` into `slot` (0–9), replacing it. A core error's message, or none. */
  save: (slot: number, place: BiblePlace, title: string, snippet: string | undefined) => string | undefined;
};

// A synchronous FFI call on the JS thread, as the chapter's own read is.
const read = (pubKey: string) => load(() => userdata().bookmarks(pubKey));

/**
 * The open publication's bookmarks, read when it changes, when asked, and
 * after each save. The core keeps them; this is only what the last read
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

  // Each save reads the list back, whether or not the core took it.
  const save = (slot: number, place: BiblePlace, title: string, snippet: string | undefined) => {
    let message: string | undefined;
    try {
      userdata().setBookmark(pubKey, slot, bookmarkLocation(pubKey, place), title, snippet);
    } catch (e) {
      message = coreErrorMessage(e);
    }
    refresh();
    return message;
  };

  return { list: current.list, refresh, save };
}
