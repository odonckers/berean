import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, BackHandler } from 'react-native';

import { userdata } from '@/ffi/core';
import { changeNotes, findNote } from '@/notes/data';
import { type Draft, SAVE_DELAY_MS, leaveStep, shouldSave } from '@/notes/note-draft';

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
 * save says so and keeps the draft.
 */
export function useNoteDraft(id: string, fresh: boolean) {
  // Read once: the fields own the text from here.
  const [initial] = useState(() => readDraft(id));
  const [draft, setDraftState] = useState<Draft>(initial ?? { title: '', content: '' });
  // The latest draft and the last saved one, for saves outside a render.
  const current = useRef(draft);
  const saved = useRef(draft);
  // Deleted (More, Delete) or removed on leaving: nothing saves again.
  const gone = useRef(initial === undefined);

  const setDraft = useCallback((next: Draft) => {
    current.current = next;
    setDraftState(next);
  }, []);

  const flush = useCallback(() => {
    const next = current.current;
    if (gone.current || !shouldSave(next, saved.current)) return;
    const error = changeNotes(() => userdata().updateNote(id, next.title, next.content));
    if (error !== undefined) {
      Alert.alert('Couldn’t save the note', error);
      return;
    }
    saved.current = next;
  }, [id]);

  const leave = useCallback(() => {
    if (gone.current) return;
    switch (leaveStep(current.current, saved.current, fresh)) {
      case 'remove':
        gone.current = true;
        changeNotes(() => userdata().removeNote(id));
        break;
      case 'save':
        // Deleted elsewhere meanwhile (beside the list): nothing to save to.
        if (findNote(id) === undefined) gone.current = true;
        else flush();
        break;
      case 'none':
        break;
    }
  }, [id, fresh, flush]);

  /** The note was deleted: drop the draft unsaved. */
  const forget = useCallback(() => {
    gone.current = true;
  }, []);

  /** Take the core's text again after a change made outside the fields (a checklist tick). */
  const reload = useCallback(() => {
    const read = readDraft(id);
    if (read === undefined) return;
    saved.current = read;
    setDraft(read);
  }, [id, setDraft]);

  // Saves a moment after typing stops.
  useEffect(() => {
    if (!shouldSave(draft, saved.current)) return;
    const timer = setTimeout(flush, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, flush]);

  // Saves now when the app goes to the background, or Android's Back is
  // pressed (Back still goes back).
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

  // Leaving: the screen going back, or a list-detail pane switching notes.
  // The screen under it hears the change and reads again.
  useEffect(() => leave, [leave]);

  return { found: initial !== undefined, draft, setDraft, flush, forget, reload };
}
