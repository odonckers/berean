import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { ParagraphStyle } from 'berean-ffi-rn';

import type { Block } from './chapter-blocks.ts';
import { copiedVerse, verseText } from './copy-verse.ts';

// The core enum's prose value; Copy verse never reads the style.
const PROSE = 0 as ParagraphStyle;

const blocks: Block[] = [
  { kind: 'heading', text: 'The Word' },
  {
    kind: 'paragraph',
    paragraph: 1,
    style: PROSE,
    runs: [
      { verse: 3, label: '3', text: 'All things were made through him.' },
      { verse: 4, label: '4', text: 'In him was life;' },
      { verse: 0, text: 'A note.' },
    ],
  },
  {
    kind: 'paragraph',
    paragraph: 2,
    style: PROSE,
    runs: [
      { verse: 4, text: ' and the life was the light of men. ' },
      { verse: 5, label: '5', text: 'And the light shineth in the darkness.' },
    ],
  },
];

describe('verse text', () => {
  test("a verse's runs across blocks, joined with a space", () => {
    assert.equal(verseText(blocks, 4), 'In him was life; and the life was the light of men.');
  });

  test('one run', () => {
    assert.equal(verseText(blocks, 3), 'All things were made through him.');
  });

  test('notes and missing verses give none', () => {
    assert.equal(verseText(blocks, 0), '');
    assert.equal(verseText(blocks, 9), '');
  });
});

describe('copied verse', () => {
  test('the reference, then the text', () => {
    assert.equal(
      copiedVerse('John 1:4', verseText(blocks, 4)),
      'John 1:4 In him was life; and the life was the light of men.',
    );
  });

  test('a verse with no text copies its reference', () => {
    assert.equal(copiedVerse('John 1:9', ''), 'John 1:9');
  });
});
