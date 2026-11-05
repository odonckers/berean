import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { copiedVerse, copyConfirmation, verseText } from './copy-verse.ts';

// The chapter's VerseAnchors as the core gives them: verse 4 runs on over
// two paragraphs, its runs joined by the core.
const verses = [
  { verse: 3, text: 'All things were made through him.' },
  { verse: 4, text: ' In him was life; and the life was the light of men. ' },
  { verse: 5, text: 'And the light shineth in the darkness.' },
];

describe('verse text', () => {
  test("the core's text of a verse that runs across blocks, without its ends' whitespace", () => {
    assert.equal(verseText(verses, 4), 'In him was life; and the life was the light of men.');
  });

  test('one run', () => {
    assert.equal(verseText(verses, 3), 'All things were made through him.');
  });

  test('notes and missing verses give none', () => {
    assert.equal(verseText(verses, 0), '');
    assert.equal(verseText(verses, 9), '');
  });
});

describe('copied verse', () => {
  test('the reference, then the text', () => {
    assert.equal(
      copiedVerse('John 1:4', verseText(verses, 4)),
      'John 1:4 In him was life; and the life was the light of men.',
    );
  });

  test('a verse with no text copies its reference', () => {
    assert.equal(copiedVerse('John 1:9', ''), 'John 1:9');
  });
});

describe('copy confirmation', () => {
  test('Android 12 and 12L: a toast in the material look, announced in the iOS look', () => {
    for (const api of [31, 32]) {
      assert.equal(copyConfirmation('android', api, true), 'toast');
      assert.equal(copyConfirmation('android', api, false), 'announce');
    }
  });

  test('Android 13 and later confirm the copy themselves, in either look', () => {
    for (const api of [33, 34]) {
      assert.equal(copyConfirmation('android', api, true), 'none');
      assert.equal(copyConfirmation('android', api, false), 'none');
    }
  });

  test('iOS announces, in either look', () => {
    assert.equal(copyConfirmation('ios', '18.0', false), 'announce');
    assert.equal(copyConfirmation('ios', '18.0', true), 'announce');
  });
});
