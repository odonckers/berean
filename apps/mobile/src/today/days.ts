// Days as the core takes them: YYYYMMDD integers in the device's local
// calendar (Reader.dailyText and Reader.meetingWeek). Pure, so the Node
// tests can import it without React Native.

/** The local calendar day of `date` as YYYYMMDD. */
export function localDay(date: Date): number {
  return date.getFullYear() * 10_000 + (date.getMonth() + 1) * 100 + date.getDate();
}

/** Local noon of `day`, so adding days never trips over a daylight saving change. */
export function dayDate(day: number): Date {
  return new Date(Math.floor(day / 10_000), (Math.floor(day / 100) % 100) - 1, day % 100, 12);
}

/** The day `count` days after `day` (before it when negative). */
export function addDays(day: number, count: number): number {
  const date = dayDate(day);
  date.setDate(date.getDate() + count);
  return localDay(date);
}

/** "Monday, November 9" in `locale` (the device's when undefined). */
export function dayTitle(day: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric' }).format(dayDate(day));
}

/**
 * A week's dates, short: "November 9–15", "October 26 – November 1", and
 * across a year "December 28, 2026 – January 3, 2027". En dashes, as
 * JW Library writes its week ranges.
 */
export function weekTitle(first: number, last: number, locale?: string): string {
  const month = (day: number) => Math.floor(day / 100) % 100;
  const year = (day: number) => Math.floor(day / 10_000);
  const monthDay = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' });
  if (year(first) !== year(last)) {
    const full = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric' });
    return `${full.format(dayDate(first))} – ${full.format(dayDate(last))}`;
  }
  if (month(first) !== month(last)) {
    return `${monthDay.format(dayDate(first))} – ${monthDay.format(dayDate(last))}`;
  }
  const monthName = new Intl.DateTimeFormat(locale, { month: 'long' }).format(dayDate(first));
  return `${monthName} ${first % 100}–${last % 100}`;
}

/**
 * How `day` relates to `today` in words, for the screen reader and the
 * caption over the date: "Today", "Yesterday", "Tomorrow", or undefined.
 */
export function relativeDay(day: number, today: number): string | undefined {
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  if (day === addDays(today, 1)) return 'Tomorrow';
  return undefined;
}

/** The Monday of the week (Monday to Sunday) holding `day`, as the core counts weeks. */
export function weekStart(day: number): number {
  return addDays(day, -((dayDate(day).getDay() + 6) % 7));
}

/** "This week", "Last week", "Next week", or undefined, for the week starting `monday`. */
export function relativeWeek(monday: number, today: number): string | undefined {
  const current = weekStart(today);
  if (monday === current) return 'This week';
  if (monday === addDays(current, -7)) return 'Last week';
  if (monday === addDays(current, 7)) return 'Next week';
  return undefined;
}
