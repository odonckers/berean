import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { landedLabel, landedVerse } from './landed-verse.ts';

describe('landedVerse', () => {
  test('an arrival marks its verse', () => {
    assert.deepEqual(landedVerse(undefined, { kind: 'arrive', chapterKey: 'a', verse: 16 }), {
      chapterKey: 'a',
      verse: 16,
    });
  });

  test('a later arrival moves the mark', () => {
    const prev = { chapterKey: 'a', verse: 16 };
    assert.deepEqual(landedVerse(prev, { kind: 'arrive', chapterKey: 'b', verse: 3 }), {
      chapterKey: 'b',
      verse: 3,
    });
  });

  test('the same verse arriving again keeps the mark', () => {
    const prev = { chapterKey: 'a', verse: 16 };
    assert.equal(landedVerse(prev, { kind: 'arrive', chapterKey: 'a', verse: 16 }), prev);
  });

  test('pressing another verse clears it', () => {
    const prev = { chapterKey: 'a', verse: 16 };
    assert.equal(landedVerse(prev, { kind: 'press', verse: 17 }), undefined);
  });

  test('pressing the landed verse (opening its pane) clears it', () => {
    const prev = { chapterKey: 'a', verse: 16 };
    assert.equal(landedVerse(prev, { kind: 'press', verse: 16 }), undefined);
  });

  test('a chapter change clears it', () => {
    const prev = { chapterKey: 'a', verse: 16 };
    assert.equal(landedVerse(prev, { kind: 'chapter', chapterKey: 'b' }), undefined);
  });

  test('the same chapter keeps it', () => {
    const prev = { chapterKey: 'a', verse: 16 };
    assert.equal(landedVerse(prev, { kind: 'chapter', chapterKey: 'a' }), prev);
  });
});

describe('landedLabel', () => {
  test('appends the search result to the landed verse only', () => {
    assert.equal(landedLabel('Verse 16, opens study', true), 'Verse 16, opens study, search result');
    assert.equal(landedLabel('Verse 16, opens study', false), 'Verse 16, opens study');
  });
});
