import { CompanyFacts, FactPoint, pickConcept } from "@/lib/edgar/companyFacts";
import { FilingEntry } from "@/lib/edgar/submissions";
import { ANCHOR_CONCEPTS } from "@/lib/xbrl/concepts";

export type FiscalPeriodLabel = "Q1" | "Q2" | "Q3" | "FY";

export interface FilingPeriod {
  filing: FilingEntry;
  fy: number;
  fp: FiscalPeriodLabel;
  /** e.g. "Q2 FY27" (10-Q) or "Q4 FY26" (10-K, standing in for the derived Q4). */
  label: string;
  /**
   * True when the filing was placed in a real fiscal calendar.
   *
   * False means the label is a fallback: the company has no 10-K in the
   * lookback and EDGAR reports no fiscal year end, so there is nothing to
   * measure the period against. Anything that projects forward from a
   * period -- the filing deadline, and the missed-deadline red flag that
   * follows from it -- must refuse to run on an unplaced period rather
   * than project from a guess.
   */
  placed: boolean;
}

/** How a resolved cell's value was actually obtained. Drives the `derived` flag: only "direct" and "instant" are as-filed. */
export type ResolutionMethod =
  | "direct"
  | "instant"
  | "ytd-subtraction"
  | "annual-minus-9mo"
  | "computed-sum"
  | "computed-difference"
  // A gap left by the row's chosen (highest-coverage) tag, filled from a
  // different candidate tag -- only after confirming the two tags agree
  // (within $1M) on the most recent period they both tag. See
  // resolveDurationSeries/resolveInstantSeries in xbrl/keyFinancials.ts.
  | "spliced"
  // The same proof, with year-to-date subtraction carried across the two
  // tags: one tag's year-to-date figure minus the other tag's prior
  // year-to-date figure, because the filer switched tags inside the year.
  | "spliced-ytd";

export function isDerivedMethod(method: ResolutionMethod): boolean {
  return method !== "direct" && method !== "instant";
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / DAY_MS);
}

// Generous windows: real fiscal calendars (4-4-5, 52/53-week years, months
// of different lengths) push actual day counts around by a few days.
// Q3's floor is 245 rather than 255 because a 4-4-5 retail calendar puts
// three fiscal quarters at 12+12+12 weeks = 252 days, which the tighter
// window rejected -- Costco's year-to-date cash flow fell straight through
// it and took free cash flow with it. The bands stay far apart (Q2 ends at
// 200, FY starts at 345), so nothing else can reach into Q3's.
export const DURATION_WINDOWS: Record<Exclude<FiscalPeriodLabel, never>, [number, number]> = {
  Q1: [75, 105],
  Q2: [165, 200],
  Q3: [245, 290],
  FY: [345, 385],
};

function fyShort(fy: number): string {
  return String(fy).slice(-2);
}

function isAnnualForm(form: string): boolean {
  return form.startsWith("10-K");
}

function year(iso: string): number {
  return Number(iso.slice(0, 4));
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso + "T00:00:00Z") + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * A fiscal year end can drift by a few days from year to year -- a
 * 52/53-week filer's year ends on a weekday, and EDGAR reports only the
 * most recent year's month and day. Two candidate year ends closer
 * together than this are the same year end seen twice; a real quarter end
 * is about ninety days away, so nothing legitimate is swallowed.
 */
const YEAR_END_DRIFT_DAYS = 31;

const DAYS_PER_QUARTER = 91.31;

export interface FiscalCalendar {
  /**
   * Every fiscal year end this company is known to have, ascending: the
   * period end of each 10-K it filed, plus synthetic ones derived from the
   * EDGAR-reported month and day to cover years with no 10-K in the list
   * (the current year, and anything older than the lookback reaches).
   */
  yearEnds: string[];
  /**
   * fy number minus the calendar year its fiscal year ends in, keyed by
   * the month that year ends in.
   *
   * The one thing dates cannot tell you. Two conventions are in use and
   * both are correct: NVIDIA's year ending January 2026 is FY26, while a
   * company whose year ends on the Saturday nearest 31 December calls its
   * year ending January 2026 FY25. So the *boundaries* of the
   * fiscal year are measured from filed period ends, and only this ±1
   * constant is read off the filer's own tags -- by majority vote, so one
   * mislabelled filing (Salesforce files a 10-K tagged fy=2025 for the
   * year it calls fiscal 2026) cannot move it.
   *
   * Keyed by month because one company can need both values. A company
   * whose year ends on the Saturday nearest 31 December lands in
   * December some years and January others, and it may number each
   * year for the calendar year it mostly covers: the year ending 28 Dec
   * 2024 is FY24, the year ending 3 Jan 2026 is FY25. A single offset
   * gets one of those two right.
   */
  yearOffsetByMonth: Record<number, number>;
  /** The offset to use for a year end in a month the filer has not tagged: its majority everywhere else. */
  yearOffset: number;
  /** True when there was enough information to place filings at all. */
  usable: boolean;
}

/** "0630" -> {month: 6, day: 30}. */
function parseMonthDay(fiscalYearEnd: string | null | undefined): { month: number; day: number } | undefined {
  if (!fiscalYearEnd) return undefined;
  const digits = fiscalYearEnd.replace(/\D/g, "");
  if (digits.length !== 4) return undefined;
  const month = Number(digits.slice(0, 2));
  const day = Number(digits.slice(2));
  if (!month || month > 12 || !day || day > 31) return undefined;
  return { month, day };
}

function nominalYearEnd(y: number, md: { month: number; day: number }): string {
  // Day 31 in a 30-day month (or Feb 29/30) rolls back to the month's last
  // day rather than spilling into the next month.
  const lastDay = new Date(Date.UTC(y, md.month, 0)).getUTCDate();
  const day = Math.min(md.day, lastDay);
  return `${y}-${String(md.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The company's fiscal calendar, from its own filings.
 *
 * Built once per company and shared by the quarterly window and the annual
 * view, so the two can never place the same filing in different years.
 */
export function buildFiscalCalendar(
  facts: CompanyFacts,
  filings: FilingEntry[],
  fiscalYearEnd: string | null | undefined
): FiscalCalendar {
  const md = parseMonthDay(fiscalYearEnd);
  const filed = filings.filter((f) => isAnnualForm(f.form)).map((f) => f.reportDate);

  // Cover every year the filings touch, plus one either side: the current
  // fiscal year has no 10-K yet, and the oldest filing in a long lookback
  // can sit before the oldest 10-K.
  const candidates = new Set(filed);
  if (md && filings.length) {
    const years = filings.map((f) => year(f.reportDate));
    for (let y = Math.min(...years) - 1; y <= Math.max(...years) + 1; y++) {
      candidates.add(nominalYearEnd(y, md));
    }
  }

  // Collapse duplicates: a filed year end and the nominal one for the same
  // fiscal year are the same boundary, and the filed date is the real one.
  const sorted = [...candidates].sort();
  const yearEnds: string[] = [];
  for (const candidate of sorted) {
    const previous = yearEnds[yearEnds.length - 1];
    if (previous && daysBetween(previous, candidate) <= YEAR_END_DRIFT_DAYS) {
      if (filed.includes(candidate) && !filed.includes(previous)) yearEnds[yearEnds.length - 1] = candidate;
      continue;
    }
    yearEnds.push(candidate);
  }

  const calendar: FiscalCalendar = {
    yearEnds,
    yearOffsetByMonth: {},
    yearOffset: 0,
    usable: yearEnds.length > 0,
  };
  learnYearOffsets(facts, filings, calendar);
  return calendar;
}

/** EDGAR's own fiscal-year number for a filing, read off any anchor fact carrying its accession. Undefined for a filing company facts has not aggregated yet. */
function taggedFiscalYear(facts: CompanyFacts, filing: FilingEntry): number | undefined {
  for (const conceptName of ANCHOR_CONCEPTS) {
    const found = pickConcept(facts, [conceptName]);
    if (!found) continue;
    const match = found.points.find((p) => p.accn === filing.accessionNumber);
    if (match) return match.fy;
  }
  return undefined;
}

const OFFSET_VOTE_LIMIT = 24;

function majority(votes: Map<number, number>): number {
  let best = 0;
  let bestCount = 0;
  for (const [offset, count] of votes) {
    if (count > bestCount) {
      best = offset;
      bestCount = count;
    }
  }
  return best;
}

/** Fills in the calendar's offsets, per year-end month and overall, from the filer's own fy tags. */
function learnYearOffsets(facts: CompanyFacts, filings: FilingEntry[], calendar: FiscalCalendar): void {
  const overall = new Map<number, number>();
  const byMonth = new Map<number, Map<number, number>>();
  for (const filing of filings.slice(0, OFFSET_VOTE_LIMIT)) {
    const tagged = taggedFiscalYear(facts, filing);
    if (tagged === undefined) continue;
    const end = fiscalYearEndFor(filing.reportDate, calendar);
    if (!end) continue;
    const offset = tagged - year(end);
    if (offset < -1 || offset > 1) continue; // not a naming convention, just noise
    overall.set(offset, (overall.get(offset) ?? 0) + 1);
    const month = Number(end.slice(5, 7));
    const forMonth = byMonth.get(month) ?? new Map<number, number>();
    forMonth.set(offset, (forMonth.get(offset) ?? 0) + 1);
    byMonth.set(month, forMonth);
  }
  calendar.yearOffset = majority(overall);
  for (const [month, votes] of byMonth) calendar.yearOffsetByMonth[month] = majority(votes);
}

/** The naming offset for a year ending on this date: its own month's, or the filer's usual one. */
function offsetForYearEnd(yearEnd: string, calendar: FiscalCalendar): number {
  const month = Number(yearEnd.slice(5, 7));
  return calendar.yearOffsetByMonth[month] ?? calendar.yearOffset;
}

/** The end of the fiscal year that `end` falls in: the first year end at or after it, allowing for year-end drift. */
function fiscalYearEndFor(end: string, calendar: FiscalCalendar): string | undefined {
  const floor = addDays(end, -YEAR_END_DRIFT_DAYS);
  return calendar.yearEnds.find((candidate) => candidate >= floor);
}

/** The year end before `yearEnd`: the previous entry, or one year back when the list does not reach that far. */
function previousFiscalYearEnd(yearEnd: string, calendar: FiscalCalendar): string {
  const index = calendar.yearEnds.indexOf(yearEnd);
  if (index > 0) return calendar.yearEnds[index - 1];
  return addDays(yearEnd, -364);
}

/**
 * Places one filing in the fiscal calendar from its own period end date.
 *
 * EDGAR's fy/fp tags are not used here, because they are the filer's
 * DocumentFiscalYearFocus and filers get them wrong: Oracle tags the
 * quarter ended August 2026 as fy2026/Q1, the same pair it used for the
 * quarter ended August 2025, so two different quarters arrive with one
 * label. A period end and a fiscal year end cannot collide that way.
 */
function placeFiling(filing: FilingEntry, calendar: FiscalCalendar): FilingPeriod {
  const yearEnd = calendar.usable ? fiscalYearEndFor(filing.reportDate, calendar) : undefined;
  if (!yearEnd) {
    // Nothing to measure against. Keep the filing -- dropping it is how a
    // just-filed 10-Q disappears and a deadline the company has already
    // met reads as missed -- but mark it unplaced so nothing projects
    // from it.
    const fp: FiscalPeriodLabel = isAnnualForm(filing.form) ? "FY" : "Q1";
    const fy = year(filing.reportDate);
    return { filing, fy, fp, label: `${fp === "FY" ? "Q4" : fp} FY${fyShort(fy)}`, placed: false };
  }

  const fy = year(yearEnd) + offsetForYearEnd(yearEnd, calendar);
  let fp: FiscalPeriodLabel;
  if (isAnnualForm(filing.form)) {
    fp = "FY";
  } else {
    const intoYear = daysBetween(previousFiscalYearEnd(yearEnd, calendar), filing.reportDate);
    const quarter = Math.min(3, Math.max(1, Math.round(intoYear / DAYS_PER_QUARTER)));
    fp = (`Q${quarter}` as FiscalPeriodLabel);
  }
  const label = fp === "FY" ? `Q4 FY${fyShort(fy)}` : `${fp} FY${fyShort(fy)}`;
  return { filing, fy, fp, label, placed: true };
}

/**
 * One period per filing, in the order given. Never fewer: a filing that
 * cannot be placed comes back marked `placed: false` rather than vanishing.
 */
export function buildFilingPeriods(calendar: FiscalCalendar, filings: FilingEntry[]): FilingPeriod[] {
  return filings.map((filing) => placeFiling(filing, calendar));
}

function pointsEndingAt(points: FactPoint[], endDate: string): FactPoint[] {
  return points.filter((p) => p.end === endDate);
}

function withinDuration(p: FactPoint, [min, max]: [number, number]): boolean {
  if (!p.start) return false;
  const days = daysBetween(p.start, p.end);
  return days >= min && days <= max;
}

/**
 * Among candidate facts for the same period, prefer the value as reported
 * in the filing we're actually displaying (exact accession match) so the
 * number matches what that filing's source line points to. Only fall back
 * to the most recently filed comparative (e.g. a later restatement) when
 * the target filing itself didn't carry the fact.
 */
function pickBest(points: FactPoint[], preferredAccn?: string): FactPoint {
  if (preferredAccn) {
    const exact = points.find((p) => p.accn === preferredAccn);
    if (exact) return exact;
  }
  return points.reduce((best, p) => (p.filed > best.filed ? p : best));
}

/**
 * The cumulative-since-fiscal-year-start value as of this filing period's
 * end date -- for Q1 that's the same as the discrete quarter; for Q2/Q3
 * it's the 6-/9-month YTD figure; for FY it's the full year. Exported
 * (as resolveCumulativeToDate) for the Annual toggle, which wants the
 * as-filed full-year figure directly rather than the derived discrete Q4.
 */
function cumulativeAt(points: FactPoint[], period: FilingPeriod): FactPoint | undefined {
  const window = DURATION_WINDOWS[period.fp];
  const candidates = pointsEndingAt(points, period.filing.reportDate).filter((p) =>
    withinDuration(p, window)
  );
  return candidates.length ? pickBest(candidates, period.filing.accessionNumber) : undefined;
}

/** Public wrapper for the Annual toggle: the as-filed cumulative-to-date figure (the full year, for an FY period). */
export function resolveCumulativeToDate(
  points: FactPoint[],
  period: FilingPeriod
): { value: number; end: string } | undefined {
  const point = cumulativeAt(points, period);
  return point ? { value: point.val, end: point.end } : undefined;
}

/** The discrete 3-month value for this filing period, read directly if the filer tags it that way. */
function directQuarter(points: FactPoint[], period: FilingPeriod): FactPoint | undefined {
  const candidates = pointsEndingAt(points, period.filing.reportDate).filter((p) =>
    withinDuration(p, DURATION_WINDOWS.Q1)
  );
  return candidates.length ? pickBest(candidates, period.filing.accessionNumber) : undefined;
}

function findSamePeriod(
  all: FilingPeriod[],
  fy: number,
  fp: FiscalPeriodLabel
): FilingPeriod | undefined {
  return all.find((p) => p.fy === fy && p.fp === fp);
}

export interface ResolvedDuration {
  value: number;
  method: ResolutionMethod;
  /**
   * Labels of prior periods whose year-to-date figure was absent from the
   * filed statement and read as nil (see DurationOptions.nilPrior). Absent
   * when no figure was read as nil.
   */
  nilPeriods?: string[];
}

export interface DurationOptions {
  /**
   * The nil rule, for cash-flow year-to-date gaps only. Called with a prior
   * period whose year-to-date figure is missing from `points`; true means
   * the figure counts as nil. The caller decides, because the three
   * conditions (the filing is published, no candidate tag has a value, the
   * tag has been used in a 10-Q before) need more than one tag's points.
   */
  nilPrior?: (prior: FilingPeriod) => boolean;
}

/**
 * Resolves a duration (flow) line item -- revenue, opex, cash flow lines --
 * for one fiscal quarter, deriving via YTD/annual subtraction when the
 * filer doesn't tag the discrete 3-month figure directly (common for cash
 * flow statement lines, which SEC filers typically only tag cumulatively).
 * Returns undefined (never a guess) when the underlying data isn't there.
 *
 * With `options.nilPrior`, a missing PRIOR year-to-date figure can count
 * as nil: a company that raised no debt in Q1 often leaves the line off its
 * Q1 statement entirely, and its six-month figure is then the Q2 figure.
 * Only the prior figure: the period's own figure is never read as nil.
 */
export function resolveDuration(
  points: FactPoint[],
  period: FilingPeriod,
  allPeriods: FilingPeriod[],
  options: DurationOptions = {}
): ResolvedDuration | undefined {
  if (period.fp !== "FY") {
    const direct = directQuarter(points, period);
    if (direct) return { value: direct.val, method: "direct" };

    if (period.fp === "Q1") return undefined; // Q1 direct === Q1 YTD; nothing left to try

    const priorFp: FiscalPeriodLabel = period.fp === "Q2" ? "Q1" : "Q2";
    const thisYtd = cumulativeAt(points, period);
    const priorPeriod = findSamePeriod(allPeriods, period.fy, priorFp);
    const priorYtd = priorPeriod ? cumulativeAt(points, priorPeriod) : undefined;
    if (thisYtd && priorYtd) {
      return { value: thisYtd.val - priorYtd.val, method: "ytd-subtraction" };
    }
    if (thisYtd && priorPeriod && options.nilPrior?.(priorPeriod)) {
      return { value: thisYtd.val, method: "ytd-subtraction", nilPeriods: [priorPeriod.label] };
    }
    return undefined;
  }

  // FY (10-K): this stands in for Q4, which EDGAR never files standalone.
  const annual = cumulativeAt(points, period);
  if (!annual) return undefined;

  const q1 = findSamePeriod(allPeriods, period.fy, "Q1");
  const q2 = findSamePeriod(allPeriods, period.fy, "Q2");
  const q3 = findSamePeriod(allPeriods, period.fy, "Q3");
  if (!q1 || !q2 || !q3) return undefined;

  const v1 = resolveDuration(points, q1, allPeriods);
  const v2 = resolveDuration(points, q2, allPeriods);
  const v3 = resolveDuration(points, q3, allPeriods);
  if (v1 && v2 && v3) {
    return { value: annual.val - v1.value - v2.value - v3.value, method: "annual-minus-9mo" };
  }

  // The nil rule's Q4: annual minus the nine-month figure, which is the
  // prior year-to-date figure here -- read as nil when it is absent and the
  // rule's conditions hold. Only reached when the rule is in force, so rows
  // it does not apply to keep the quarter-by-quarter derivation above.
  if (options.nilPrior) {
    const nine = cumulativeAt(points, q3);
    if (nine) return { value: annual.val - nine.val, method: "annual-minus-9mo" };
    if (options.nilPrior(q3)) {
      return { value: annual.val, method: "annual-minus-9mo", nilPeriods: [q3.label] };
    }
  }
  return undefined;
}

/** The year-to-date figure as of a period's end, if filed -- exported for the nil rule's "no candidate tag has a value" test. */
export function hasCumulativeAt(points: FactPoint[], period: FilingPeriod): boolean {
  return cumulativeAt(points, period) !== undefined;
}

/**
 * Resolves an instant (point-in-time balance sheet) line item as of a
 * filing's period end. Never derived -- a 10-K's balance sheet literally is
 * the Q4/fiscal-year-end snapshot, no subtraction needed.
 */
export function resolveInstant(
  points: FactPoint[],
  period: FilingPeriod
): { value: number; method: "instant" } | undefined {
  const candidates = pointsEndingAt(points, period.filing.reportDate);
  if (!candidates.length) return undefined;
  return { value: pickBest(candidates, period.filing.accessionNumber).val, method: "instant" };
}
