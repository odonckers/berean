import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  flattenGroups,
  moveSelection,
  NO_SELECTION,
  resultsId,
  selectedIndex,
} from './palette-selection.ts';
import { groupHits, visibleGroups } from './results.ts';

const verse = (n: number) => ({ id: `v${n}`, location: { verse: n } });
const paragraph = (n: number) => ({ id: `p${n}`, location: {} });

describe('display order', () => {
  test('verses, then publications, each in the core order', () => {
    const groups = visibleGroups(groupHits([paragraph(1), verse(4), verse(1)]), 'all');
    assert.deepEqual(
      flattenGroups(groups).map((h) => h.id),
      ['v4', 'v1', 'p1'],
    );
  });

  test('a scope keeps only its group', () => {
    const groups = visibleGroups(groupHits([paragraph(1), verse(4)]), 'publications');
    assert.deepEqual(
      flattenGroups(groups).map((h) => h.id),
      ['p1'],
    );
  });
});

describe('selection', () => {
  const a = resultsId('love', 'all', ['v1', 'v2', 'p1']);

  test('starts on the first row', () => {
    assert.equal(selectedIndex(NO_SELECTION, a, 3), 0);
  });

  test('Down and Up move one row, clamped at the ends', () => {
    let s = moveSelection(NO_SELECTION, a, 3, 1);
    assert.equal(selectedIndex(s, a, 3), 1);
    s = moveSelection(s, a, 3, 1);
    s = moveSelection(s, a, 3, 1);
    assert.equal(selectedIndex(s, a, 3), 2, 'no wrap past the last row');
    s = moveSelection(s, a, 3, -1);
    s = moveSelection(s, a, 3, -1);
    s = moveSelection(s, a, 3, -1);
    assert.equal(selectedIndex(s, a, 3), 0, 'no wrap past the first row');
  });

  test('a new query, scope or set of rows starts on the first row again', () => {
    const s = moveSelection(moveSelection(NO_SELECTION, a, 3, 1), a, 3, 1);
    assert.equal(selectedIndex(s, resultsId('loved', 'all', ['v1', 'v2', 'p1']), 3), 0);
    assert.equal(selectedIndex(s, resultsId('love', 'verses', ['v1', 'v2']), 2), 0);
    assert.equal(selectedIndex(s, resultsId('love', 'all', ['v1', 'v3', 'p1']), 3), 0);
  });

  test('moving in new results starts from the first row', () => {
    const s = moveSelection(moveSelection(NO_SELECTION, a, 3, 1), a, 3, 1);
    const b = resultsId('loved', 'all', ['v1', 'v2', 'p1']);
    assert.equal(selectedIndex(moveSelection(s, b, 3, 1), b, 3), 1);
  });

  test('no rows: index 0, and moving stays there', () => {
    const none = resultsId('zzz', 'all', []);
    assert.equal(selectedIndex(moveSelection(NO_SELECTION, none, 0, 1), none, 0), 0);
  });
});
