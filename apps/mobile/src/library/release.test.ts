import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { releaseLabel, releaseSpoken } from './release.ts';

describe("What's New release days", () => {
  const today = new Date(2026, 10, 9);

  test('this year drops the year', () => {
    assert.equal(releaseLabel('2026-10-08', today), 'Oct 8');
  });

  test('another year keeps it', () => {
    assert.equal(releaseLabel('2025-12-31', today), 'Dec 31, 2025');
    assert.equal(releaseLabel('2027-01-01', today), 'Jan 1, 2027');
  });

  test('a screen reader hears the whole date', () => {
    assert.equal(releaseSpoken('2026-10-08'), 'October 8, 2026');
  });

  test('anything else comes back as given', () => {
    assert.equal(releaseLabel('2026-13-01', today), '2026-13-01');
    assert.equal(releaseLabel('', today), '');
    assert.equal(releaseSpoken('soon'), 'soon');
  });
});
