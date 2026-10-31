// The Undo snackbar's (Material) and toast's (iOS look) timing and words,
// kept free of React Native so Node can test them.

/** How long Undo stays (guide: 8 s). */
export const UNDO_MS = 8_000;
/** How long it stays while VoiceOver or TalkBack is on, to reach it by swiping. */
export const UNDO_SCREEN_READER_MS = 16_000;

export function undoDuration(screenReaderOn: boolean): number {
  return screenReaderOn ? UNDO_SCREEN_READER_MS : UNDO_MS;
}

/**
 * What the bar shows and what is announced as it appears (guide §7.1).
 * Material: "Folder deleted"; iOS look: Deleted “Signs”, naming what went.
 */
export function undoMessages(
  look: 'ios' | 'material',
  subject: string,
  name: string,
): { label: string; announcement: string } {
  const label = look === 'material' ? `${subject} deleted` : `Deleted “${name}”`;
  return { label, announcement: `${label}. Undo available.` };
}
