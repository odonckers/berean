import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { titleSections } from './title-matches.ts';

describe('Library title search sections', () => {
  const matches = [
    { publication: 'll', installed: true },
    { publication: 'w26', installed: true },
    { publication: 'lff', installed: false },
    { publication: 'lffi', installed: false },
  ];

  test('installed first, then the catalog, in the core order', () => {
    assert.deepEqual(titleSections(matches, 'English'), [
      { key: 'installed', title: 'On This Device', data: ['ll', 'w26'] },
      { key: 'catalog', title: 'Catalog · English', data: ['lff', 'lffi'] },
    ]);
  });

  test('an empty section is left out', () => {
    assert.deepEqual(titleSections(matches.slice(2), undefined), [
      { key: 'catalog', title: 'Catalog', data: ['lff', 'lffi'] },
    ]);
    assert.deepEqual(titleSections([], 'English'), []);
  });
});
