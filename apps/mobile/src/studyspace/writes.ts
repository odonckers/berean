// What the Studyspace screen does when one of its writes to the core fails:
// undo a New note that couldn't be placed, and tell a workspace that has
// gone from any other failure to remember it. The core calls come in as
// arguments (data.ts passes them), so `node --test` can run this.

/**
 * `place()`'s result. If it throws and `made` is a note just made for it
 * (New note), that note is discarded first, so no empty note is left in
 * Notes; a failed discard is ignored, and the place's error is rethrown.
 * A note picked from the existing ones is never discarded.
 */
export function placeOrDiscard<T>(
  made: { createdNoteId?: string },
  place: () => T,
  discard: (noteId: string) => void,
): T {
  try {
    return place();
  } catch (e) {
    if (made.createdNoteId !== undefined) {
      try {
        discard(made.createdNoteId);
      } catch {
        // The empty note stays in Notes; the add's own error is what's shown.
      }
    }
    throw e;
  }
}

/** Whether remembering a workspace worked, found it gone (NotFound), or failed otherwise. */
export type Remembered = 'ok' | 'gone' | 'failed';

/** `write()`'s outcome, `isGone` telling a NotFound from any other error. */
export function rememberOutcome(write: () => void, isGone: (e: unknown) => boolean): Remembered {
  try {
    write();
    return 'ok';
  } catch (e) {
    return isGone(e) ? 'gone' : 'failed';
  }
}
