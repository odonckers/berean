import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  formatCount,
  groupHits,
  isTruncated,
  resultsLabel,
  visibleGroups,
} from './results.ts';

const verse = (n: number) => ({ id: `v${n}`, location: { verse: n } });
const paragraph = (n: number) => ({ id: `p${n}`, location: {} });

describe('groups', () => {
  test('verses first, then publications, each in the core order', () => {
    const groups = groupHits([paragraph(1), verse(4), paragraph(2), verse(1)]);
    assert.deepEqual(
      groups.map((g) => [g.key, g.hits.map((h) => h.id)]),
      [
        ['verses', ['v4', 'v1']],
        ['publications', ['p1', 'p2']],
      ],
    );
  });

  test('verse 0 (a superscription) is a verse', () => {
    assert.equal(groupHits([verse(0)])[0].hits.length, 1);
  });

  test('a scope shows its group; empty groups are hidden', () => {
    const groups = groupHits([verse(1), verse(2)]);
    assert.deepEqual(
      visibleGroups(groups, 'all').map((g) => g.key),
      ['verses'],
    );
    assert.deepEqual(visibleGroups(groups, 'publications'), []);
  });
});

describe('counts', () => {
  test('a full page is a lower bound', () => {
    assert.equal(isTruncated(99), false);
    assert.equal(isTruncated(100), true);
    assert.equal(formatCount(100, true), '100+');
    assert.equal(formatCount(42, false), '42');
  });

  test('labels', () => {
    assert.equal(resultsLabel(1, false), '1 result');
    assert.equal(resultsLabel(0, false), '0 results');
    assert.equal(resultsLabel(42, false), '42 results');
    assert.equal(resultsLabel(100, true), '100+ results');
  });
});
