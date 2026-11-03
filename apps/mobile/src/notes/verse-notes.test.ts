import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { LARGE_TEXT_SCALE } from '../reader/pane-snap.ts';
import {
  addNoteLabel,
  markerCount,
  markerLabel,
  mergeMarkers,
  myNotesHeader,
  noteMarkerMode,
  notesByVerse,
  notesColumns,
  showNotesLabel,
  verseNotesSubject,
} from './verse-notes.ts';

const note = (id: string, book?: number, chapter?: number, verse?: number) => ({
  id,
  location: { book, chapter, verse },
});

describe('notes by verse', () => {
  test("groups the chapter's notes by verse, in the core's order", () => {
    const notes = [
      note('a', 1, 1, 4),
      note('b', 1, 1, 1),
      note('c', 1, 1, 4),
      note('d', 1, 1, 3),
      note('chapter', 1, 1),
      note('other chapter', 1, 2, 4),
      { id: 'free', location: undefined },
    ];
    const byVerse = notesByVerse(notes, { book: 1, chapter: 1 });
    assert.deepEqual([...byVerse.keys()], [4, 1, 3]);
    assert.deepEqual(
      byVerse.get(4)!.map((n) => n.id),
      ['a', 'c'],
    );
    assert.equal(byVerse.get(2), undefined);
  });
});

describe('marker or badge', () => {
  test('a margin from 400 wide, below accessibility text sizes (font scale 1.5)', () => {
    assert.equal(LARGE_TEXT_SCALE, 1.5);
    assert.equal(noteMarkerMode(412, 1, LARGE_TEXT_SCALE), 'margin');
    assert.equal(noteMarkerMode(400, 1.3, LARGE_TEXT_SCALE), 'margin');
    assert.equal(noteMarkerMode(399, 1, LARGE_TEXT_SCALE), 'badge');
    assert.equal(noteMarkerMode(393, 1, LARGE_TEXT_SCALE), 'badge');
    assert.equal(noteMarkerMode(1024, 1.5, LARGE_TEXT_SCALE), 'badge');
    assert.equal(noteMarkerMode(1024, 2, LARGE_TEXT_SCALE), 'badge');
  });
});

describe('markers', () => {
  test('verses starting on one line merge', () => {
    assert.deepEqual(
      mergeMarkers([
        { verse: 1, line: '0:0', count: 1 },
        { verse: 4, line: '0:3', count: 2 },
        { verse: 6, line: '0:3', count: 1 },
        { verse: 9, line: '1:0', count: 1 },
      ]),
      [
        { verses: [1], count: 1, line: '0:0' },
        { verses: [4, 6], count: 3, line: '0:3' },
        { verses: [9], count: 1, line: '1:0' },
      ],
    );
  });

  test('labels and counts', () => {
    assert.equal(markerLabel('Genesis 1', [4], 2), 'Genesis 1:4, 2 notes');
    assert.equal(markerLabel('Genesis 1', [1], 1), 'Genesis 1:1, 1 note');
    assert.equal(markerLabel('John 1', [4, 6], 3), 'John 1:4 to 6, 3 notes');
    assert.equal(markerCount(1), undefined);
    assert.equal(markerCount(2), '2');
  });
});

describe('verse labels', () => {
  test('the verse names its notes, then its highlight', () => {
    assert.equal(verseNotesSubject(4, 2, undefined), 'Verse 4, 2 notes');
    assert.equal(verseNotesSubject(1, 1, undefined), 'Verse 1, 1 note');
    assert.equal(verseNotesSubject(3, 0, undefined), 'Verse 3');
    assert.equal(verseNotesSubject(4, 2, 'Yellow highlight'), 'Verse 4, 2 notes, Yellow highlight');
    assert.equal(showNotesLabel(4), 'Verse 4, show notes');
    assert.equal(addNoteLabel(4), 'Verse 4, add note');
    assert.equal(myNotesHeader(2), 'My notes · 2');
    assert.equal(myNotesHeader(0), 'My notes');
  });
});

describe('columns', () => {
  test('three from 1000, two from 640, else one', () => {
    assert.equal(notesColumns(1366), 3);
    assert.equal(notesColumns(1000), 3);
    assert.equal(notesColumns(999), 2);
    assert.equal(notesColumns(840), 2);
    assert.equal(notesColumns(640), 2);
    assert.equal(notesColumns(639), 1);
    assert.equal(notesColumns(393), 1);
  });
});
