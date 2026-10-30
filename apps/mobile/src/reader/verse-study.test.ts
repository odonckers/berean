import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  type CoreVerseStudy,
  NO_STUDY,
  markersByVerse,
  paneStudy,
  studyActionLabel,
} from './verse-study.ts';

const span = (verse: number) => ({
  start: { book: 10, chapter: 2, verse },
  end: { book: 10, chapter: 2, verse },
});
// Names a span by its first verse, so the mapping's use of it shows.
const reference = (s: { start: { verse?: number } }) =>
  s.start.verse === 99 ? undefined : `ref ${s.start.verse}`;

const study = (over: Partial<CoreVerseStudy> = {}): CoreVerseStudy => ({
  studyNotes: [{ label: 'beginning:', text: 'A note.' }],
  crossRefs: [
    { label: 'a', target: span(4), snippet: 'A snippet' },
    { label: 'b', target: span(99) },
  ],
  footnotes: [{ marker: '*', text: 'Or "a word."' }],
  availability: { tag: 'Installed' },
  ...over,
});

describe('pane study', () => {
  test('every tab with items, in the pane order', () => {
    assert.deepEqual(paneStudy(study(), reference), {
      tabs: ['studyNotes', 'crossRefs', 'footnotes'],
      studyNotes: [{ label: 'beginning:', text: 'A note.' }],
      crossRefs: [{ label: 'a', reference: 'ref 4', snippet: 'A snippet' }, { label: 'b' }],
      footnotes: [{ marker: '*', text: 'Or "a word."' }],
    });
  });

  test('a tab only shows with items', () => {
    assert.deepEqual(paneStudy(study({ studyNotes: [], footnotes: [] }), reference).tabs, ['crossRefs']);
    assert.deepEqual(
      paneStudy(study({ studyNotes: [], crossRefs: [], footnotes: [] }), reference).tabs,
      [],
    );
  });

  test('no study edition installed: notes hidden, footnotes and cross refs kept', () => {
    const shown = paneStudy(
      study({ availability: { tag: 'NotInstalled', inner: { pubKey: 'nwtsty:0:0' } } }),
      reference,
    );
    assert.deepEqual(shown.tabs, ['crossRefs', 'footnotes']);
    assert.deepEqual(shown.studyNotes, []);
  });

  test('no study (not found, or an error) is the Empty state', () => {
    assert.deepEqual(paneStudy(undefined, reference), NO_STUDY);
    assert.deepEqual(NO_STUDY.tabs, []);
  });

  test('the core strings as given', () => {
    const text = ' spaced  text ';
    const shown = paneStudy(
      study({
        studyNotes: [{ label: ' l ', text }],
        crossRefs: [{ label: ' c ', target: span(1), snippet: text }],
        footnotes: [{ marker: ' m ', text }],
      }),
      reference,
    );
    assert.deepEqual(shown.studyNotes, [{ label: ' l ', text }]);
    assert.deepEqual(shown.crossRefs, [{ label: ' c ', reference: 'ref 1', snippet: text }]);
    assert.deepEqual(shown.footnotes, [{ marker: ' m ', text }]);
  });
});

describe('study action labels', () => {
  const counts = (studyNotes: number, crossRefs: number, footnotes: number) => ({
    verse: 3,
    studyNotes,
    crossRefs,
    footnotes,
  });

  test('without markers, just the verse', () => {
    assert.equal(studyActionLabel(3, undefined, false), 'Verse 3, opens study');
    assert.equal(studyActionLabel(3, counts(0, 0, 0), false), 'Verse 3, opens study');
  });

  test('what the markers count, singular and plural', () => {
    assert.equal(
      studyActionLabel(3, counts(0, 2, 1), false),
      'Verse 3, opens study, 2 cross references, 1 footnote',
    );
    assert.equal(
      studyActionLabel(3, counts(1, 1, 3), false),
      'Verse 3, opens study, 1 study note, 1 cross reference, 3 footnotes',
    );
  });

  test('while its study is open, closes it', () => {
    assert.equal(studyActionLabel(3, counts(0, 2, 1), true), 'Verse 3, closes study');
  });

  test('markers by verse', () => {
    const byVerse = markersByVerse([counts(1, 0, 0), { ...counts(0, 2, 0), verse: 7 }]);
    assert.equal(byVerse.get(7)?.crossRefs, 2);
    assert.equal(byVerse.get(3)?.studyNotes, 1);
    assert.equal(markersByVerse(undefined).size, 0);
  });
});
