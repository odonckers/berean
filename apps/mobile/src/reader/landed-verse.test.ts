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

describe('arrivals with a nonce (bookmark jumps)', () => {
  test('a jump marks its verse with its arrival and source', () => {
    assert.deepEqual(
      landedVerse(undefined, { kind: 'arrive', chapterKey: 'a', verse: 16, arrival: 1, source: 'bookmark' }),
      { chapterKey: 'a', verse: 16, arrival: 1, source: 'bookmark' },
    );
  });

  test('jumping again to the same verse in the same chapter is a new arrival', () => {
    const prev = landedVerse(undefined, { kind: 'arrive', chapterKey: 'a', verse: 16, arrival: 1, source: 'bookmark' });
    const next = landedVerse(prev, { kind: 'arrive', chapterKey: 'a', verse: 16, arrival: 2, source: 'bookmark' });
    assert.notEqual(next, prev);
    assert.deepEqual(next, { chapterKey: 'a', verse: 16, arrival: 2, source: 'bookmark' });
  });

  test('the same arrival seen again (a re-render) keeps the mark', () => {
    const prev = landedVerse(undefined, { kind: 'arrive', chapterKey: 'a', verse: 16, arrival: 1, source: 'bookmark' });
    assert.equal(landedVerse(prev, { kind: 'arrive', chapterKey: 'a', verse: 16, arrival: 1, source: 'bookmark' }), prev);
  });

  test('a jump onto a verse a search hit marked takes the mark over', () => {
    const prev = landedVerse(undefined, { kind: 'arrive', chapterKey: 'a', verse: 16 });
    assert.deepEqual(landedVerse(prev, { kind: 'arrive', chapterKey: 'a', verse: 16, arrival: 1, source: 'bookmark' }), {
      chapterKey: 'a',
      verse: 16,
      arrival: 1,
      source: 'bookmark',
    });
  });

  test('a jump into another chapter survives the chapter change it causes', () => {
    const jumped = landedVerse(undefined, { kind: 'arrive', chapterKey: 'b', verse: 3, arrival: 1, source: 'bookmark' });
    assert.equal(landedVerse(jumped, { kind: 'chapter', chapterKey: 'b' }), jumped);
  });

  test('pressing a verse number clears a jump too', () => {
    const jumped = landedVerse(undefined, { kind: 'arrive', chapterKey: 'a', verse: 16, arrival: 1, source: 'bookmark' });
    assert.equal(landedVerse(jumped, { kind: 'press', verse: 16 }), undefined);
  });

  test("a bookmark's landed verse says so", () => {
    assert.equal(landedLabel('Verse 16, opens study', true, 'bookmark'), 'Verse 16, opens study, bookmark');
    assert.equal(landedLabel('Verse 16, opens study', true, 'search'), 'Verse 16, opens study, search result');
    assert.equal(landedLabel('Verse 16, opens study', false, 'bookmark'), 'Verse 16, opens study');
  });
});
