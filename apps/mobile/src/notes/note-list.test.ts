import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  type ListNote,
  RECENTS_LIMIT,
  byModified,
  chipTags,
  countLine,
  deleteNotePrompt,
  keepIds,
  noteAccessibilityLabel,
  noteCount,
  noteMeta,
  noteTitle,
  recentNotes,
  shortDate,
  toggleTag,
} from './note-list.ts';

const note = (id: string, modified: string, created = '2026-01-01T00:00:00Z', tagIds: bigint[] = []): ListNote => ({
  id,
  title: id,
  created,
  modified,
  tagIds,
});

describe('order', () => {
  test('most recently modified first, ties by made, then id', () => {
    const notes = [
      note('a', '2026-10-01T10:00:00Z'),
      note('b', '2026-10-28T09:00:00Z'),
      note('c', '2026-10-01T10:00:00Z', '2026-02-01T00:00:00Z'),
      note('d', '2026-10-01T10:00:00Z'),
    ];
    assert.deepEqual(
      byModified(notes).map((n) => n.id),
      ['b', 'c', 'd', 'a'],
    );
    // The input is left as the core returned it.
    assert.equal(notes[0].id, 'a');
  });

  test('Recents is the 20 most recently modified', () => {
    const notes = Array.from({ length: 25 }, (_, i) =>
      note(`n${i}`, `2026-10-${String(i + 1).padStart(2, '0')}T12:00:00Z`),
    );
    const recents = recentNotes(notes);
    assert.equal(recents.length, RECENTS_LIMIT);
    assert.equal(recents[0].id, 'n24');
    assert.equal(recents.at(-1)!.id, 'n5');
    assert.equal(recentNotes(notes.slice(0, 3)).length, 3);
  });

  test('keepIds keeps the order and drops the rest', () => {
    const notes = [note('a', ''), note('b', ''), note('c', '')];
    assert.deepEqual(
      keepIds(notes, ['c', 'a', 'z']).map((n) => n.id),
      ['a', 'c'],
    );
  });
});

describe('words', () => {
  const now = new Date(2026, 9, 30);

  test('short dates drop the year only for this year', () => {
    // Noon UTC is the same calendar day in every zone from -11 to +11.
    assert.equal(shortDate('2026-10-28T12:00:00Z', now), 'Oct 28');
    assert.equal(shortDate('2025-01-03T12:00:00Z', now), 'Jan 3, 2025');
    assert.equal(shortDate('not a date', now), '');
  });

  test('counts', () => {
    assert.equal(noteCount(1), '1 note');
    assert.equal(noteCount(0), '0 notes');
    assert.equal(countLine(2, 6), '2 of 6 notes');
    assert.equal(countLine(0, 1), '0 of 1 note');
  });

  test('titles and labels', () => {
    assert.equal(noteTitle({ title: '  ' }), 'Untitled');
    assert.equal(noteTitle({ title: ' Grace ' }), 'Grace');
    assert.equal(
      noteAccessibilityLabel('Light before law', 'Oct 28', 'The witness is not the light'),
      'Light before law, Oct 28, The witness is not the light',
    );
    assert.equal(noteAccessibilityLabel('Untitled', 'Oct 28', ''), 'Untitled, Oct 28');
    assert.deepEqual(noteMeta('John 1:9', 'Prologue'), ['John 1:9', 'Prologue']);
    assert.deepEqual(noteMeta(undefined, ''), []);
    assert.equal(deleteNotePrompt('Grace').title, 'Delete “Grace”?');
  });
});

describe('tag chips', () => {
  const tags = [
    { id: 1n, name: 'prologue' },
    { id: 2n, name: 'light' },
    { id: 3n, name: 'witness' },
    { id: 4n, name: 'questions' },
  ];
  const notes = [note('a', '', '', [2n, 1n]), note('b', '', '', [3n])];

  test("only the listed notes' tags, in the core's order", () => {
    assert.deepEqual(
      chipTags(tags, notes, []).map((t) => t.name),
      ['prologue', 'light', 'witness'],
    );
  });

  test('a selected chip stays; the locked tag is left out', () => {
    assert.deepEqual(
      chipTags(tags, [], [4n]).map((t) => t.name),
      ['questions'],
    );
    assert.deepEqual(
      chipTags(tags, notes, [], 2n).map((t) => t.name),
      ['prologue', 'witness'],
    );
  });

  test('toggling adds at the end and removes', () => {
    assert.deepEqual(toggleTag([1n], 2n), [1n, 2n]);
    assert.deepEqual(toggleTag([1n, 2n], 1n), [2n]);
  });
});
