import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  chapterCountLabel,
  chapterHeading,
  keyForChapter,
  nextChapter,
  previousChapter,
  shouldResetScroll,
  verseReference,
} from './bible-nav.ts';

// Made-up books, numbered out of order: the order is the list's, never the
// book numbers'.
const books = [
  { book: 10, chapterCount: 3 },
  { book: 11, chapterCount: 1 },
  { book: 7, chapterCount: 2 },
];

describe('headings', () => {
  test('the chapter name when there is one, else the book name', () => {
    assert.equal(chapterHeading({ name: 'Genesis' }, 1), 'Genesis 1');
    assert.equal(chapterHeading({ name: 'Psalms', chapterName: 'Psalm' }, 23), 'Psalm 23');
  });

  test('falls back without the book', () => {
    assert.equal(chapterHeading(undefined, 4), 'Chapter 4');
  });

  test('verse references and chapter counts', () => {
    assert.equal(verseReference('Genesis 1', 3), 'Genesis 1:3');
    assert.equal(chapterCountLabel(1), '1 chapter');
    assert.equal(chapterCountLabel(50), '50 chapters');
  });
});

describe('previous chapter', () => {
  test('within a book', () => {
    assert.deepEqual(previousChapter(books, { book: 10, chapter: 3 }), { book: 10, chapter: 2 });
  });

  test('into the last chapter of the book before', () => {
    assert.deepEqual(previousChapter(books, { book: 11, chapter: 1 }), { book: 10, chapter: 3 });
    assert.deepEqual(previousChapter(books, { book: 7, chapter: 1 }), { book: 11, chapter: 1 });
  });

  test('none at the first chapter of the first book', () => {
    assert.equal(previousChapter(books, { book: 10, chapter: 1 }), undefined);
  });

  test('stays in the book without the books', () => {
    assert.deepEqual(previousChapter(undefined, { book: 3, chapter: 2 }), { book: 3, chapter: 1 });
    assert.equal(previousChapter(undefined, { book: 3, chapter: 1 }), undefined);
    assert.equal(previousChapter(books, { book: 99, chapter: 1 }), undefined);
  });
});

describe('next chapter', () => {
  test('within a book', () => {
    assert.deepEqual(nextChapter(books, { book: 10, chapter: 1 }), { book: 10, chapter: 2 });
  });

  test('into the first chapter of the book after', () => {
    assert.deepEqual(nextChapter(books, { book: 10, chapter: 3 }), { book: 11, chapter: 1 });
    assert.deepEqual(nextChapter(books, { book: 11, chapter: 1 }), { book: 7, chapter: 1 });
  });

  test('none at the last chapter of the last book', () => {
    assert.equal(nextChapter(books, { book: 7, chapter: 2 }), undefined);
  });

  test('stays in the book without the books', () => {
    assert.deepEqual(nextChapter(undefined, { book: 3, chapter: 2 }), { book: 3, chapter: 3 });
    assert.deepEqual(nextChapter(books, { book: 99, chapter: 4 }), { book: 99, chapter: 5 });
  });
});

describe('chapter changes', () => {
  test('a key per publication, book and chapter', () => {
    assert.equal(keyForChapter('bible', { book: 10, chapter: 3 }), 'bible/10/3');
    assert.notEqual(
      keyForChapter('bible', { book: 10, chapter: 1 }),
      keyForChapter('bible', { book: 11, chapter: 1 }),
    );
    assert.notEqual(
      keyForChapter('a', { book: 10, chapter: 1 }),
      keyForChapter('b', { book: 10, chapter: 1 }),
    );
  });

  test('scrolls to the top on a chapter change, not on a mount or a re-render', () => {
    const last = keyForChapter('bible', { book: 10, chapter: 3 });
    const next = keyForChapter('bible', { book: 11, chapter: 1 });
    assert.equal(shouldResetScroll(last, next), true);
    assert.equal(shouldResetScroll(next, last), true);
    // A mount: the first chapter shown, or a remount restoring the session.
    assert.equal(shouldResetScroll(undefined, next), false);
    // The same chapter re-rendering (a pane opening or closing).
    assert.equal(shouldResetScroll(next, next), false);
  });
});
