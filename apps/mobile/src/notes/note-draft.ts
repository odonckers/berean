// When the note editor saves: the decisions behind useNoteDraft, kept free
// of React Native so Node can test them. Saving itself is the core's
// updateNote; nothing here reads the Markdown.

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
