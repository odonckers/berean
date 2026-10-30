// The Undo snackbar's (Material) and toast's (iOS look) timing and words,
// kept free of React Native so Node can test them.

/** How long Undo stays (guide: 8 s). */
export const UNDO_MS = 8_000;
/** How long it stays while VoiceOver or TalkBack is on, to reach it by swiping. */
export const UNDO_SCREEN_READER_MS = 16_000;

export function undoDuration(screenReaderOn: boolean): number {
  return screenReaderOn ? UNDO_SCREEN_READER_MS : UNDO_MS;
}

/** What the bar shows and what is announced as it appears. */
export function undoMessages(subject: string): { label: string; announcement: string } {
  return { label: `${subject} deleted`, announcement: `${subject} deleted. Undo available.` };
}
