/** Calendar dates are plain ISO strings (YYYY-MM-DD); no time zones involved. */
export type IsoDate = string;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function assertIsoDate(d: string): asserts d is IsoDate {
  if (!ISO.test(d)) throw new Error(`expected YYYY-MM-DD, got "${d}"`);
}

/** Last calendar day of the month before the month containing `d` (Rule 115 / Rule 206 anchor). */
export function lastDayOfPrecedingMonth(d: IsoDate): IsoDate {
  assertIsoDate(d);
  const [y, m] = d.split('-').map(Number);
  // Day 0 of month m (1-based) in UTC is the last day of month m-1.
  return new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "1 Jan 2025" — for user-facing messages. */
export function formatDate(d: IsoDate): string {
  const [y, m, day] = d.split('-');
  return `${Number(day)} ${MONTHS[Number(m) - 1]} ${y}`;
}
