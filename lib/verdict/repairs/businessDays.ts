/**
 * Business days for filing deadlines (rules 11 R2): a deadline that falls
 * on a weekend or an SEC holiday moves to the next business day.
 *
 * SEC holidays are the federal legal public holidays (5 U.S.C. 6103), with
 * the federal observed-day rule: a holiday on a Saturday is observed the
 * Friday before, one on a Sunday the Monday after. One-off closures by
 * executive order are not in this calendar.
 */

const parse = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function addCalendarDays(date: string, days: number): string {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}

/** The n-th (1-based) given weekday of a month; n = -1 for the last one. */
function nthWeekday(year: number, month0: number, weekday: number, n: number): string {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month0, 1));
    const offset = (weekday - first.getUTCDay() + 7) % 7;
    return iso(new Date(Date.UTC(year, month0, 1 + offset + (n - 1) * 7)));
  }
  const last = new Date(Date.UTC(year, month0 + 1, 0));
  const back = (last.getUTCDay() - weekday + 7) % 7;
  return iso(new Date(Date.UTC(year, month0 + 1, -back)));
}

/** A fixed-date holiday moved to its observed day. */
function observed(year: number, month0: number, day: number): string {
  const d = new Date(Date.UTC(year, month0, day));
  const dow = d.getUTCDay();
  if (dow === 6) d.setUTCDate(d.getUTCDate() - 1);
  if (dow === 0) d.setUTCDate(d.getUTCDate() + 1);
  return iso(d);
}

const MON = 1;
const THU = 4;

/** The observed SEC (federal) holidays falling in `year`. */
export function secHolidays(year: number): string[] {
  const days = [
    observed(year, 0, 1), // New Year's Day
    nthWeekday(year, 0, MON, 3), // Birthday of Martin Luther King, Jr.
    nthWeekday(year, 1, MON, 3), // Washington's Birthday
    nthWeekday(year, 4, MON, -1), // Memorial Day
    ...(year >= 2021 ? [observed(year, 5, 19)] : []), // Juneteenth
    observed(year, 6, 4), // Independence Day
    nthWeekday(year, 8, MON, 1), // Labor Day
    nthWeekday(year, 9, MON, 2), // Columbus Day
    observed(year, 10, 11), // Veterans Day
    nthWeekday(year, 10, THU, 4), // Thanksgiving Day
    observed(year, 11, 25), // Christmas Day
  ];
  // Next year's New Year's Day observed on 31 December of this year.
  const nextNewYear = observed(year + 1, 0, 1);
  if (nextNewYear.startsWith(String(year))) days.push(nextNewYear);
  return days.filter((d) => d.startsWith(String(year)));
}

const holidayCache = new Map<number, Set<string>>();
function holidaySet(year: number): Set<string> {
  let s = holidayCache.get(year);
  if (!s) {
    s = new Set(secHolidays(year));
    holidayCache.set(year, s);
  }
  return s;
}

export function isBusinessDay(date: string): boolean {
  const dow = parse(date).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !holidaySet(Number(date.slice(0, 4))).has(date);
}

/** The date itself when it is a business day, else the next business day. */
export function rollForward(date: string): string {
  let d = date;
  while (!isBusinessDay(d)) d = addCalendarDays(d, 1);
  return d;
}
