import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Segment } from './chapter-blocks.ts';
import {
  type ChapterHighlight,
  HIGHLIGHT_ORDER,
  highlightActionLabel,
  highlightLabel,
  highlightsByVerse,
  segmentHighlight,
  toCoreColorName,
  toHighlightName,
  verseSubject,
  wholeVerseRange,
} from './highlights.ts';
import { studyActionLabel } from './verse-study.ts';

const at = { book: 43, chapter: 1 };
const verses = [1, 2, 3, 4, 5, 6];
const loc = (book: number, chapter: number, verse?: number) =>
  verse === undefined ? { book, chapter } : { book, chapter, verse };
const highlight = (
  id: string,
  start: { book?: number; chapter?: number; verse?: number },
  end: { book?: number; chapter?: number; verse?: number },
  color: ChapterHighlight['color'] = 'yellow',
): ChapterHighlight => ({ id, span: { start, end }, color });

describe('highlight colors', () => {
  test('the chips in the guide order', () => {
    assert.deepEqual(HIGHLIGHT_ORDER, ['yellow', 'green', 'blue', 'purple', 'pink', 'orange']);
  });

  test("each color round-trips through the core's name", () => {
    for (const name of HIGHLIGHT_ORDER) assert.equal(toHighlightName(toCoreColorName(name)), name);
    assert.equal(toCoreColorName('purple'), 'Purple');
    assert.equal(toHighlightName('Pink'), 'pink');
  });

  test('named by color only', () => {
    assert.deepEqual(HIGHLIGHT_ORDER.map(highlightLabel), [
      'Yellow',
      'Green',
      'Blue',
      'Purple',
      'Pink',
      'Orange',
    ]);
  });
});

describe('whole verse range', () => {
  test('the verse at both ends, no word tokens', () => {
    assert.deepEqual(wholeVerseRange('nwtsty', 43, 1, 4), {
      span: {
        start: { pubKey: 'nwtsty', book: 43, chapter: 1, verse: 4 },
        end: { pubKey: 'nwtsty', book: 43, chapter: 1, verse: 4 },
      },
      startToken: undefined,
      endToken: undefined,
    });
  });
});

describe('highlights by verse', () => {
  test('a one-verse highlight', () => {
    const map = highlightsByVerse([highlight('a', loc(43, 1, 3), loc(43, 1, 3), 'green')], at, verses);
    assert.deepEqual([...map], [[3, { id: 'a', color: 'green' }]]);
  });

  test('a range covers its whole verses, tokens or not', () => {
    const map = highlightsByVerse([highlight('a', loc(43, 1, 2), loc(43, 1, 4))], at, verses);
    assert.deepEqual([...map.keys()], [2, 3, 4]);
  });

  test('a span from the chapter before, or on into the next, runs to the edge', () => {
    const from = highlightsByVerse([highlight('a', loc(43, 0, 9), loc(43, 1, 2))], at, verses);
    assert.deepEqual([...from.keys()], [1, 2]);
    const into = highlightsByVerse([highlight('b', loc(43, 1, 5), loc(44, 1, 1))], at, verses);
    assert.deepEqual([...into.keys()], [5, 6]);
  });

  test('a span with no verse at an end covers the chapter from or to it', () => {
    const map = highlightsByVerse([highlight('a', loc(43, 1), loc(43, 1))], at, verses);
    assert.deepEqual([...map.keys()], verses);
  });

  test('highlights outside the chapter, or with no chapter, are left out', () => {
    const map = highlightsByVerse(
      [
        highlight('a', loc(43, 2, 1), loc(43, 2, 3)),
        highlight('b', loc(42, 1, 1), loc(42, 24, 53)),
        highlight('c', {}, {}),
      ],
      at,
      verses,
    );
    assert.equal(map.size, 0);
  });

  test("where highlights overlap, the core's later one is drawn", () => {
    const map = highlightsByVerse(
      [
        highlight('a', loc(43, 1, 1), loc(43, 1, 3), 'blue'),
        highlight('b', loc(43, 1, 3), loc(43, 1, 3), 'pink'),
      ],
      at,
      verses,
    );
    assert.deepEqual(map.get(2), { id: 'a', color: 'blue' });
    assert.deepEqual(map.get(3), { id: 'b', color: 'pink' });
  });
});

describe('segment highlight', () => {
  const byVerse = new Map([
    [1, { id: 'a', color: 'yellow' as const }],
    [3, { id: 'b', color: 'blue' as const }],
  ]);
  const segments: Segment[] = [
    { kind: 'number', verse: 1, label: '1', separated: false },
    { kind: 'text', verse: 1, text: 'In the beginning' },
    { kind: 'space' },
    { kind: 'text', verse: 1, text: 'was the Word' },
    { kind: 'number', verse: 2, label: '2', separated: true },
    { kind: 'text', verse: 2, text: 'He was' },
    { kind: 'space' },
    { kind: 'note', text: 'A note' },
    { kind: 'space' },
    { kind: 'text', verse: 3, text: 'All things' },
  ];

  test('verse text takes its verse fill; numbers and notes never do', () => {
    assert.deepEqual(
      segments.map((_, i) => segmentHighlight(segments, i, byVerse)),
      [undefined, 'yellow', 'yellow', 'yellow', undefined, undefined, undefined, undefined, undefined, 'blue'],
    );
  });

  test('out of range is none', () => {
    assert.equal(segmentHighlight(segments, 99, byVerse), undefined);
  });
});

describe('labels', () => {
  test('a highlighted verse is named with its color', () => {
    assert.equal(verseSubject(1, undefined), 'Verse 1');
    assert.equal(verseSubject(1, 'yellow'), 'Verse 1, highlighted, yellow');
  });

  test('the Highlight action', () => {
    assert.equal(highlightActionLabel(4, undefined), 'Verse 4, highlight');
    assert.equal(highlightActionLabel(4, 'green'), 'Verse 4, highlighted, green, change highlight');
  });

  test('the study action carries the highlight', () => {
    const subject = verseSubject(3, 'blue');
    assert.equal(studyActionLabel(3, undefined, false, subject), 'Verse 3, highlighted, blue, opens study');
    assert.equal(studyActionLabel(3, undefined, true, subject), 'Verse 3, highlighted, blue, closes study');
    assert.equal(studyActionLabel(3, undefined, false), 'Verse 3, opens study');
  });
});
