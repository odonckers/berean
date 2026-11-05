// A verse as Copy verse puts it on the clipboard, kept free of React Native
// so Node can test it. The text is the verse's plain text as the core gives
// it (VerseAnchor.text); nothing here reads or rewrites the Bible.

/**
 * A verse's text: the chapter's VerseAnchor.text for it (the core joins a
 * verse's runs across blocks, lines of poetry included), without the
 * whitespace at its ends. Notes (verse 0) are never a verse's text. Empty
 * if the chapter doesn't have the verse.
 */
export function verseText(verses: readonly { verse: number; text: string }[], verse: number): string {
  if (verse === 0) return '';
  return verses.find((v) => v.verse === verse)?.text.trim() ?? '';
}

/**
 * How a copy is confirmed. Android 13 (API 33) and later confirm a copy to
 * the clipboard themselves, so there is nothing to add. Below that, the
 * material look shows a toast. Everywhere else (the iOS look, or the
 * material look on an iOS device) it is announced.
 */
export function copyConfirmation(
  os: string,
  apiLevel: number | string,
  material: boolean,
): 'toast' | 'announce' | 'none' {
  if (os === 'android' && Number(apiLevel) >= 33) return 'none';
  return os === 'android' && material ? 'toast' : 'announce';
}

/** What Copy verse copies: "John 1:4 In him was life; …", the reference then the text. */
export function copiedVerse(reference: string, text: string): string {
  return text === '' ? reference : `${reference} ${text}`;
}
