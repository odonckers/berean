// A verse as Copy verse puts it on the clipboard, kept free of React Native
// so Node can test it. The text is the chapter's runs as the core gave them;
// nothing here reads or rewrites the Bible.

import type { Block } from './chapter-blocks.ts';

/**
 * A verse's text: each of its runs, in the chapter's order across blocks
 * (a verse can run on over lines of poetry), joined with a space as the
 * reader draws them. Notes (verse 0) are never a verse's text. Empty if the
 * chapter doesn't have the verse.
 */
export function verseText(blocks: readonly Block[], verse: number): string {
  if (verse === 0) return '';
  return blocks
    .flatMap((block) => (block.kind === 'paragraph' ? block.runs : []))
    .filter((run) => run.verse === verse)
    .map((run) => run.text.trim())
    .filter((text) => text !== '')
    .join(' ');
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
