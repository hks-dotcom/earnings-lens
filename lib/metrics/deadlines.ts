import { FilingPeriod } from "@/lib/xbrl/periods";

const DAY_MS = 24 * 60 * 60 * 1000;

function parseUTC(iso: string): Date {
  return new Date(iso + "T00:00:00Z");
}

export function addDays(iso: string, days: number): string {
  const d = parseUTC(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/** Adds 3 calendar months, preserving "end of month" if the source date was one. */
function addFixedQuarter(iso: string): string {
  const d = parseUTC(iso);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const wasEndOfMonth = day === daysInMonth(y, m);
  const totalMonths = y * 12 + m + 3;
  const newY = Math.floor(totalMonths / 12);
  const newM = totalMonths % 12;
  const newDay = wasEndOfMonth ? daysInMonth(newY, newM) : Math.min(day, daysInMonth(newY, newM));
  return new Date(Date.UTC(newY, newM, newDay)).toISOString().slice(0, 10);
}

/**
 * Detects a 52/53-week ("floating") fiscal calendar. A 52-week year is
 * exactly 364 days (52 x 7) and a 53-week year exactly 371 days (53 x 7) --
 * both multiples of 7 -- whereas a fixed calendar fiscal year is 365 or 366
 * days, neither a multiple of 7. This is a cleaner signal than day-of-month
 * drift, which can be as little as a single day for a 52-to-52-week
 * transition and easy to confuse with filing-date noise.
 */
export function isFloatingFiscalCalendar(annualPeriodEnds: string[]): boolean {
  if (annualPeriodEnds.length < 2) return false;
  const sorted = [...annualPeriodEnds].sort();
  for (let i = 1; i < sorted.length; i++) {
    const gap = Math.round((parseUTC(sorted[i]).getTime() - parseUTC(sorted[i - 1]).getTime()) / DAY_MS);
    if (gap % 7 === 0) return true;
  }
  return false;
}

/** Estimates the next fiscal quarter's end date, ~91 days out, snapped to the historical weekday when floating. */
export function estimateNextQuarterEnd(latestPeriodEnd: string, floating: boolean): string {
  if (!floating) return addFixedQuarter(latestPeriodEnd);

  const targetWeekday = parseUTC(latestPeriodEnd).getUTCDay();
  const rough = addDays(latestPeriodEnd, 91);
  let best = rough;
  let bestDiff = Infinity;
  for (let delta = -4; delta <= 4; delta++) {
    const candidate = addDays(rough, delta);
    const diff = Math.abs(parseUTC(candidate).getUTCDay() - targetWeekday);
    const wrapped = Math.min(diff, 7 - diff);
    if (wrapped < bestDiff) {
      bestDiff = wrapped;
      best = candidate;
    }
  }
  return best;
}

export type FilerCategory =
  | "Large accelerated filer"
  | "Accelerated filer"
  | "Non-accelerated filer"
  | "Smaller reporting company"
  | string; // EDGAR's category string isn't a closed enum in practice

// EDGAR's raw category string can carry more than one classification
// joined by "<br>" (e.g. "Non-accelerated filer<br>Smaller reporting
// company"), and critically "non-accelerated" contains "accelerated" as a
// substring -- a naive .includes("accelerated") misclassifies every
// non-accelerated filer as accelerated. Check "non-accelerated" first.
function isLargeOrAcceleratedFiler(category: string | null): boolean | undefined {
  if (!category) return undefined;
  const c = category.toLowerCase();
  if (c.includes("non-accelerated") || c.includes("nonaccelerated")) return false;
  if (c.includes("large accelerated")) return true;
  if (c.includes("accelerated")) return true; // "Accelerated filer" (non-large)
  return false;
}

/** 10-Q: 40 days for large accelerated/accelerated filers, 45 otherwise. */
export function tenQDeadlineDays(category: string | null): number | undefined {
  const accelerated = isLargeOrAcceleratedFiler(category);
  if (accelerated === undefined) return undefined;
  return accelerated ? 40 : 45;
}

/** 10-K: 60 / 75 / 90 days by large-accelerated / accelerated / other. */
export function tenKDeadlineDays(category: string | null): number | undefined {
  if (!category) return undefined;
  const c = category.toLowerCase();
  if (c.includes("non-accelerated") || c.includes("nonaccelerated")) return 90;
  if (c.includes("large accelerated")) return 60;
  if (c.includes("accelerated")) return 75;
  return 90;
}

export interface NextFilingDue {
  form: "10-Q" | "10-K";
  estimatedPeriodEnd: string;
  dueDate: string;
  /** True when the period end is an estimate (52/53-week fiscal year) -- display with a leading "~". */
  isEstimated: boolean;
}

/**
 * Given the latest periodic filing and enough history to detect a floating
 * fiscal calendar, projects the next 10-Q/10-K and its SEC deadline.
 */
export function nextFilingDue(
  latest: FilingPeriod,
  filerCategory: string | null,
  annualPeriodEndsForFloatDetection: string[]
): NextFilingDue | undefined {
  const floating = isFloatingFiscalCalendar(annualPeriodEndsForFloatDetection);
  const estimatedPeriodEnd = estimateNextQuarterEnd(latest.filing.reportDate, floating);
  const nextForm: "10-Q" | "10-K" = latest.fp === "Q3" ? "10-K" : "10-Q";
  const deadlineDays =
    nextForm === "10-K" ? tenKDeadlineDays(filerCategory) : tenQDeadlineDays(filerCategory);
  if (deadlineDays === undefined) return undefined;
  return {
    form: nextForm,
    estimatedPeriodEnd,
    dueDate: addDays(estimatedPeriodEnd, deadlineDays),
    isEstimated: floating,
  };
}
