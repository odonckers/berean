// When the note editor saves: the decisions behind useNoteDraft, kept free
// of React and React Native so Node can test them. Saving itself is the
// core's updateNote; nothing here reads the Markdown.

/** The editor's title and Markdown, as typed. */
export type Draft = { title: string; content: string };

/** How long typing pauses before the draft saves. */
export const SAVE_DELAY_MS = 800;

/** Nothing written: title and body blank. */
export function isEmptyDraft(draft: Draft): boolean {
  return draft.title.trim() === '' && draft.content.trim() === '';
}

/** Whether the draft differs from what the core last saved. */
export function shouldSave(draft: Draft, saved: Draft): boolean {
  return draft.title !== saved.title || draft.content !== saved.content;
}

/**
 * What leaving the editor does: a note made for it and still empty goes
 * again; otherwise any unsaved change saves.
 */
export function leaveStep(draft: Draft, saved: Draft, fresh: boolean): 'remove' | 'save' | 'none' {
  if (fresh && isEmptyDraft(draft)) return 'remove';
  return shouldSave(draft, saved) ? 'save' : 'none';
}

/**
 * The mode a note opens in: the one asked for (Read from a list, Write for
 * a new note), but Write for a note with nothing in its body, there being
 * nothing to read. Not remembered per note.
 */
export function openingMode(requested: 'write' | 'read', content: string): 'write' | 'read' {
  return content.trim() === '' ? 'write' : requested;
}

/** Runs `task` later; the returned function cancels it if it hasn't run. */
export type Scheduler = (task: () => void) => () => void;

/** The next turn of the event loop. */
export const nextTurn: Scheduler = (task) => {
  const timer = setTimeout(task, 0);
  return () => clearTimeout(timer);
};

export type DraftSessionDeps = {
  /** The note's saved text, or undefined when the note isn't there. */
  initial: Draft | undefined;
  /** Made for the editor: removed again if left empty. */
  fresh: boolean;
  /** Saves through the core; false when it failed (the draft is kept). */
  save: (draft: Draft) => boolean;
  /** Removes the note through the core. */
  remove: () => void;
  /** Whether the note is still there (it may be deleted beside the list). */
  exists: () => boolean;
  schedule?: Scheduler;
};

export type DraftSession = {
  draft: () => Draft;
  /** Changes not yet saved. */
  dirty: () => boolean;
  /** The fields changed. */
  update: (draft: Draft) => void;
  /** Saves any change now. */
  flush: () => void;
  /** Leaves: a fresh note still empty goes, else any change saves. */
  leave: () => void;
  /** The note was deleted: nothing saves again. */
  forget: () => void;
  /** The core's text again, after a change made outside the fields. */
  reload: (draft: Draft) => void;
  /** The editor mounted (again). */
  mount: () => void;
  /** The editor unmounted: leaves a turn later unless it mounts again first. */
  unmount: () => void;
};

/**
 * One editor's draft and its saves. Leaving runs a turn after the editor
 * unmounts, not during it: React's StrictMode (dev) unmounts and mounts
 * every effect once more right after the first mount, and that remount
 * cancels the leave, so a fresh note isn't removed while it's on screen.
 * A real unmount has no remount, so the leave runs: unsaved edits save and
 * a fresh note still empty goes. Leaving on each way out instead (Back,
 * Done, X, predictive back, the iOS swipe, the list pane switching notes)
 * would miss any way we don't hear of; unmount hears them all.
 */
export function createDraftSession({
  initial,
  fresh,
  save,
  remove,
  exists,
  schedule = nextTurn,
}: DraftSessionDeps): DraftSession {
  let current: Draft = initial ?? { title: '', content: '' };
  let saved = current;
  // Deleted, removed on leaving, or never there: nothing saves again.
  let gone = initial === undefined;
  let cancelLeave: (() => void) | undefined;

  const flush = () => {
    if (gone || !shouldSave(current, saved)) return;
    const next = current;
    if (save(next)) saved = next;
  };

  const leave = () => {
    if (gone) return;
    switch (leaveStep(current, saved, fresh)) {
      case 'remove':
        gone = true;
        remove();
        break;
      case 'save':
        if (!exists()) gone = true;
        else flush();
        break;
      case 'none':
        break;
    }
  };

  return {
    draft: () => current,
    dirty: () => !gone && shouldSave(current, saved),
    update: (draft) => {
      current = draft;
    },
    flush,
    leave,
    forget: () => {
      gone = true;
    },
    reload: (draft) => {
      current = draft;
      saved = draft;
    },
    mount: () => {
      cancelLeave?.();
      cancelLeave = undefined;
    },
    unmount: () => {
      cancelLeave?.();
      cancelLeave = schedule(() => {
        cancelLeave = undefined;
        leave();
      });
    },
  };
}
