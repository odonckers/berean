import { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, BackHandler } from 'react-native';

import { userdata } from '@/ffi/core';
import { changeNotes, findNote } from '@/notes/data';
import { type Draft, SAVE_DELAY_MS, createDraftSession } from '@/notes/note-draft';

function readDraft(id: string): Draft | undefined {
  try {
    const note = findNote(id);
    return note && { title: note.title, content: note.content };
  } catch {
    return undefined;
  }
}

/**
 * The note editor's draft and its saves (guide §7.1: no Save button). The
 * draft saves through the core a moment after typing stops, and at once on
 * `flush` (switching to Read), on leaving the screen, on Android's Back and
 * when the app goes to the background; only a change saves. A `fresh` note
 * (made for the editor) still empty on leaving is removed instead. A failed
 * save says so and keeps the draft. createDraftSession holds the rules.
 */
export function useNoteDraft(id: string, fresh: boolean) {
  // Read once: the fields own the text from here.
  const [initial] = useState(() => readDraft(id));
  const [session] = useState(() =>
    createDraftSession({
      initial,
      fresh,
      save: (next) => {
        const error = changeNotes(() => userdata().updateNote(id, next.title, next.content));
        if (error !== undefined) Alert.alert('Couldn’t save the note', error);
        return error === undefined;
      },
      // The screen under it hears the change and reads again.
      remove: () => {
        changeNotes(() => userdata().removeNote(id));
      },
      exists: () => findNote(id) !== undefined,
    }),
  );
  const found = initial !== undefined;
  const [draft, setDraftState] = useState<Draft>(session.draft);

  const setDraft = useCallback(
    (next: Draft) => {
      session.update(next);
      setDraftState(next);
    },
    [session],
  );

  const flush = session.flush;

  /** The note was deleted: drop the draft unsaved. */
  const forget = session.forget;

  /** Take the core's text again after a change made outside the fields (a checklist tick). */
  const reload = useCallback(() => {
    const read = readDraft(id);
    if (read === undefined) return;
    session.reload(read);
    setDraftState(read);
  }, [id, session]);

  // Saves a moment after typing stops.
  useEffect(() => {
    if (!session.dirty()) return;
    const timer = setTimeout(flush, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, session, flush]);

  // Saves now when the app goes to the background, or Android's Back is
  // pressed (Back still goes back, and leaving then does the rest).
  useEffect(() => {
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'background') flush();
    });
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      flush();
      return false;
    });
    return () => {
      appState.remove();
      back.remove();
    };
  }, [flush]);

  // Leaving: the screen going back, by any way out, or a list-detail pane
  // switching notes. The session waits a turn, so StrictMode's dev remount
  // doesn't count as leaving.
  useEffect(() => {
    session.mount();
    return session.unmount;
  }, [session]);

  return { found, draft, setDraft, flush, forget, reload };
}
