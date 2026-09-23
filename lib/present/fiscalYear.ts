import { KeyFinancials } from "@/lib/xbrl/keyFinancials";

/**
 * The fiscal year in words, from the filer's own 10-K period ends (the
 * calendar Key financials already places every filing in):
 * "Fiscal year runs February to January, so FY27 = Feb 2026–Jan 2027".
 *
 * A company's FY26 or Q4 is not the calendar's, so the page says which
 * months it means next to the company name and on the board.
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export interface FiscalYearInfo {
  startMonth: string;
  endMonth: string;
  /** "FY27" -- the fiscal year of the latest quarter. */
  label: string;
  /** "Feb 2026–Jan 2027", or "Jan–Dec 2026" within one calendar year. */
  period: string;
  /** "Feb–Jan", for the board's identity line. */
  short: string;
}

function parse(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

/**
 * A year that ends in the first days of a month -- a 52/53-week year
 * ending on the Saturday nearest 31 December can end on 3 January -- is
 * the previous month's year: nobody's fiscal year "runs January to
 * January".
 */
function effectiveEnd(iso: string): { y: number; m: number } {
  const { y, m, d } = parse(iso);
  if (d <= 7) return m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  return { y, m };
}

export function fiscalYearInfo(kf: KeyFinancials): FiscalYearInfo | undefined {
  const latest = kf.quarters[0];
  const period = kf.publishedPeriods[0];
  if (!latest || !period?.placed || !kf.fiscalCalendar.usable) return undefined;
  const yearEnd = kf.fiscalCalendar.yearEnds.find((e) => e >= latest.periodEnd);
  if (!yearEnd) return undefined;

  const end = effectiveEnd(yearEnd);
  const startM = end.m === 12 ? 1 : end.m + 1;
  const startY = end.m === 12 ? end.y : end.y - 1;
  const short = (m: number) => MONTHS[m - 1].slice(0, 3);
  return {
    startMonth: MONTHS[startM - 1],
    endMonth: MONTHS[end.m - 1],
    label: latest.label.replace(/^Q\d /, ""),
    period: startY === end.y ? `${short(startM)}–${short(end.m)} ${end.y}` : `${short(startM)} ${startY}–${short(end.m)} ${end.y}`,
    short: `${short(startM)}–${short(end.m)}`,
  };
}
