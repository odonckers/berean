import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { localDay } from './local-day.ts';

describe('local day (Reader.locate today, #84)', () => {
  test('a date is YYYYMMDD', () => {
    assert.equal(localDay(new Date(2026, 10, 5)), 20261105);
  });

  test('a single-digit month and day take their place', () => {
    assert.equal(localDay(new Date(2026, 0, 5)), 20260105);
  });

  test('the year end', () => {
    assert.equal(localDay(new Date(2026, 11, 31)), 20261231);
  });

  test('it is the local day, not UTC', () => {
    const lateEvening = new Date(2026, 10, 5, 23, 30);
    assert.equal(localDay(lateEvening), 20261105);
    assert.equal(localDay(new Date(2026, 10, 5, 0, 15)), 20261105);
  });

  test('west of UTC late in the evening, it is still the local day', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'America/Chicago';
    try {
      // 23:30 on 5 Nov in Chicago is already 6 Nov in UTC.
      const lateEvening = new Date('2026-11-06T05:30:00Z');
      assert.equal(lateEvening.getUTCDate(), 6);
      assert.equal(localDay(lateEvening), 20261105);
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });
});
