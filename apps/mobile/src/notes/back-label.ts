// The iOS look's back button words, kept free of React Native so Node can
// test them.

/** The back button's title: the previous screen's, or "Back" when it has none. */
export function backTitle(previous: string | undefined): string {
  const title = previous?.trim() ?? '';
  return title === '' ? 'Back' : title;
}

/** What VoiceOver and TalkBack read for the back button. */
export function backAccessibilityLabel(previous: string | undefined): string {
  return `Back to ${backTitle(previous)}`;
}
