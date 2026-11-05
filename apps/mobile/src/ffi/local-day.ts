/**
 * Today as Reader.locate's `today` (#84): the device's local calendar day
 * as YYYYMMDD, e.g. 20261105. Local, not UTC: a Meeting Workbook opens on
 * the week holding the day the reader sees on their own calendar, so late
 * on a Sunday evening west of UTC it is still that Sunday's week.
 */
export function localDay(now: Date = new Date()): number {
  return now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
}
