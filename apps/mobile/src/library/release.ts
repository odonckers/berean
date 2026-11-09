// What's New release days. Plain functions with no React Native imports, so
// node --test can run them.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function parse(released: string): { year: number; month: number; day: number } | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(released);
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return { year, month, day };
}

/**
 * The core's `released` day (`YYYY-MM-DD`) as a short label: "Oct 8" in the
 * year of `today`, else "Oct 8, 2025". Unparsable input comes back as given.
 */
export function releaseLabel(released: string, today: Date = new Date()): string {
  const date = parse(released);
  if (!date) return released;
  const short = `${MONTHS[date.month - 1]} ${date.day}`;
  return date.year === today.getFullYear() ? short : `${short}, ${date.year}`;
}

/** The same day spelled out for a screen reader: "October 8, 2026". */
export function releaseSpoken(released: string): string {
  const date = parse(released);
  if (!date) return released;
  return `${MONTHS_LONG[date.month - 1]} ${date.day}, ${date.year}`;
}
