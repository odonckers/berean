import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { addDays, dayDate, dayTitle, localDay, relativeDay, relativeWeek, weekStart, weekTitle } from './days.ts';

describe('days', () => {
  test('local days round-trip', () => {
    assert.equal(localDay(new Date(2026, 10, 9, 23, 59)), 20261109);
    assert.equal(localDay(new Date(2027, 0, 1, 0, 0)), 20270101);
    for (const day of [20261109, 20240229, 20261231, 20270101]) assert.equal(localDay(dayDate(day)), day);
  });

  test('adding days crosses months, years and leap days', () => {
    assert.equal(addDays(20261109, 1), 20261110);
    assert.equal(addDays(20261130, 1), 20261201);
    assert.equal(addDays(20261231, 1), 20270101);
    assert.equal(addDays(20270101, -1), 20261231);
    assert.equal(addDays(20240228, 1), 20240229);
    assert.equal(addDays(20240301, -1), 20240229);
    assert.equal(addDays(20261109, 7), 20261116);
    assert.equal(addDays(20261109, -7), 20261102);
    // Across the daylight saving changes in many zones.
    assert.equal(addDays(20261031, 2), 20261102);
    assert.equal(addDays(20270313, 2), 20270315);
  });

  test('titles', () => {
    assert.equal(dayTitle(20261109, 'en-US'), 'Monday, November 9');
    assert.equal(dayTitle(20260101, 'en-US'), 'Thursday, January 1');
    assert.equal(weekTitle(20261109, 20261115, 'en-US'), 'November 9–15');
    assert.equal(weekTitle(20261026, 20261101, 'en-US'), 'October 26 – November 1');
    assert.equal(weekTitle(20261228, 20270103, 'en-US'), 'December 28, 2026 – January 3, 2027');
  });

  test('relative days', () => {
    assert.equal(relativeDay(20261109, 20261109), 'Today');
    assert.equal(relativeDay(20261108, 20261109), 'Yesterday');
    assert.equal(relativeDay(20261110, 20261109), 'Tomorrow');
    assert.equal(relativeDay(20270101, 20261231), 'Tomorrow');
    assert.equal(relativeDay(20261112, 20261109), undefined);
  });

  test('weeks start on Monday', () => {
    assert.equal(weekStart(20261109), 20261109);
    assert.equal(weekStart(20261112), 20261109);
    assert.equal(weekStart(20261115), 20261109);
    assert.equal(weekStart(20261101), 20261026);
    assert.equal(weekStart(20270101), 20261228);
    assert.equal(relativeWeek(20261109, 20261115), 'This week');
    assert.equal(relativeWeek(20261102, 20261109), 'Last week');
    assert.equal(relativeWeek(20261116, 20261111), 'Next week');
    assert.equal(relativeWeek(20261123, 20261109), undefined);
  });
});
