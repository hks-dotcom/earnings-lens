/**
 * Quarterly series over the extended 12-quarter window, read with the
 * app's own resolvers (lib/xbrl), and R6 R&D tag precedence (rules 11 R6).
 *
 * The app's displayed five quarters stay what the app itself reads: the
 * extended window can settle on a different tag for a row over twelve
 * quarters, so its first five cells are taken from buildKeyFinancials and
 * the extended read is used only beyond them. Every series is cut at the
 * last consecutive quarter (period ends 80–100 days apart).
 */
import type { CompanyFacts } from "@/lib/edgar/companyFacts";
import { getConceptPoints } from "@/lib/edgar/companyFacts";
import type { CompanySubmissions } from "@/lib/edgar/submissions";
import { periodicFilings } from "@/lib/edgar/submissions";
import { buildKeyFinancials, KeyFinancials, LineItem, resolveDurationSeries, resolveInstantSeries } from "@/lib/xbrl/keyFinancials";
import { buildFilingPeriods, buildFiscalCalendar, FilingPeriod } from "@/lib/xbrl/periods";
import { ANCHOR_CONCEPTS, DURATION_CONCEPTS, INSTANT_CONCEPTS } from "@/lib/xbrl/concepts";
import { marginPtsChange } from "@/lib/metrics/health";
import { RULES } from "@/lib/verdict/rulesConfig";
import type { RdStatus } from "@/lib/verdict/types";

export type Series = (number | null)[];

const DAY = 86_400_000;
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DAY;

function published(facts: CompanyFacts, p: FilingPeriod): boolean {
  return ANCHOR_CONCEPTS.some((c) => getConceptPoints(facts, c)?.some((pt) => pt.end === p.filing.reportDate));
}

export interface ExtendedWindow {
  /** The published periods shown, newest first (at most 12). */
  display: FilingPeriod[];
  /** Every published period in the lookback (sibling lookups for YTD subtraction). */
  all: FilingPeriod[];
}

export function extendedWindow(facts: CompanyFacts, subs: CompanySubmissions): ExtendedWindow {
  const periodic = periodicFilings(subs);
  const calendar = buildFiscalCalendar(facts, periodic, subs.fiscalYearEnd);
  const all = buildFilingPeriods(calendar, periodic.slice(0, RULES.window.lookbackFilings)).filter((p) => published(facts, p));
  return { display: all.slice(0, RULES.window.quarters), all };
}

/** Consecutive quarters from the latest: period ends 80–100 days apart. */
export function consecutiveQuarters(ends: string[]): number {
  if (!ends.length) return 0;
  let n = 1;
  for (let i = 1; i < ends.length; i++) {
    const gap = days(ends[i], ends[i - 1]);
    if (gap < RULES.calendar.quarterGapMinDays || gap > RULES.calendar.quarterGapMaxDays) break;
    n++;
  }
  return n;
}

const values = (li: LineItem): Series => li.values.map((v) => (v ? v.value : null));
export const truncate = (a: Series, n: number): Series => a.map((v, i) => (i < n ? v : null));

/** The app's five-quarter values first, the extended read beyond them. */
function merged(app: LineItem, ext: Series): Series {
  return ext.map((v, i) => (i < app.values.length ? (app.values[i]?.value ?? null) : v));
}

/** Year-on-year change in % between index i and i + 4; missing when either is missing or the base is zero. */
export function yoyPct(a: Series, i: number): number | null {
  const c = a[i];
  const b = a[i + RULES.windows.quartersPerYear];
  if (c === null || c === undefined || b === null || b === undefined || b === 0) return null;
  return ((c - b) / Math.abs(b)) * 100;
}

/** Sum of the four quarters from index i; missing when any of them is missing. */
export function twelveMonth(a: Series, i: number): number | null {
  const w = a.slice(i, i + RULES.windows.quartersPerYear);
  if (w.length < RULES.windows.quartersPerYear || w.some((v) => v === null || v === undefined)) return null;
  return (w as number[]).reduce((s, v) => s + v, 0);
}

// ------------------------------------------------------------------ R6

/** Precedence: the first tag with at least one quarterly value in the 12-quarter window is used for every quarter, never summed. */
export const RD_TAGS = [
  "ResearchAndDevelopmentExpense",
  "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost",
  "ResearchAndDevelopmentExpenseSoftwareExcludingAcquiredInProcessCost",
];

export interface RdResult {
  tag: string | null;
  status: RdStatus;
  values: Series;
  quarterCounts: Record<string, number>;
  lastFactEnd: string | null;
}

/**
 * Pure over the per-tag quarterly reads: picks the tag, and when none has
 * a quarterly value says whether R&D is annual only (an annual fact ending
 * inside the window), not filed in the window, or not filed at all.
 */
export function chooseRdTag(
  perTag: { tag: string; values: Series }[],
  annualPoints: { start?: string; end: string }[],
  windowStart: string | null
): RdResult {
  const chosen = perTag.find((p) => p.values.some((v) => v !== null)) ?? null;
  const lastFactEnd = annualPoints.length ? annualPoints.reduce((a, b) => (b.end > a.end ? b : a)).end : null;
  const annualInWindow = windowStart !== null && annualPoints.some((p) => p.start && p.end >= windowStart && days(p.start, p.end) > RULES.calendar.annualFactMinDays);
  const status: RdStatus = chosen ? "quarterly" : annualInWindow ? "annual only" : annualPoints.length ? "not filed in the window" : "not filed";
  return {
    tag: chosen?.tag ?? null,
    status,
    values: chosen ? chosen.values : perTag[0]?.values.map(() => null) ?? [],
    quarterCounts: Object.fromEntries(perTag.map((p) => [p.tag, p.values.filter((v) => v !== null).length])),
    lastFactEnd,
  };
}

export function rdSeries(facts: CompanyFacts, w: ExtendedWindow): RdResult {
  const perTag = RD_TAGS.map((tag) => ({ tag, values: values(resolveDurationSeries(facts, [tag], w.display, w.all)) }));
  const points = RD_TAGS.flatMap((t) => getConceptPoints(facts, t) ?? []);
  const windowStart = w.display.length ? w.display[w.display.length - 1].filing.reportDate : null;
  return chooseRdTag(perTag, points, windowStart);
}

// ------------------------------------------------------------------ the series and the quarter figures

export interface QuarterlyRead {
  kf: KeyFinancials;
  window: ExtendedWindow;
  periods: { label: string; end: string; form: string; filed: string; accessionNumber: string }[];
  consecutive: number;
  revenue: Series;
  operatingIncome: Series;
  ocf: Series;
  capex: Series;
  fcf: Series;
  currentAssets: Series;
  currentLiabilities: Series;
  rd: RdResult;
  rdSeries: Series;
}

export function quarterlyRead(facts: CompanyFacts, subs: CompanySubmissions): QuarterlyRead {
  const kf = buildKeyFinancials(facts, periodicFilings(subs), subs.fiscalYearEnd);
  const w = extendedWindow(facts, subs);
  const D = (c: readonly string[], opts?: { cashFlow?: boolean; grossFlow?: boolean }) => values(resolveDurationSeries(facts, c, w.display, w.all, opts));
  const I = (c: readonly string[]) => values(resolveInstantSeries(facts, c, w.display));
  const n = consecutiveQuarters(w.display.map((p) => p.filing.reportDate));
  const revenue = truncate(merged(kf.revenue, D(DURATION_CONCEPTS.revenue)), n);
  const operatingIncome = truncate(merged(kf.operatingIncome, D(DURATION_CONCEPTS.operatingIncome)), n);
  const ocf = truncate(merged(kf.operatingCashFlow, D(DURATION_CONCEPTS.operatingCashFlow, { cashFlow: true })), n);
  const capex = truncate(merged(kf.capitalExpenditures, D(DURATION_CONCEPTS.capitalExpenditures, { cashFlow: true, grossFlow: true })), n);
  const fcf = ocf.map((v, i) => (v !== null && capex[i] !== null ? v - (capex[i] as number) : null));
  const rd = rdSeries(facts, w);
  return {
    kf,
    window: w,
    periods: w.display.map((p) => ({ label: p.label, end: p.filing.reportDate, form: p.filing.form, filed: p.filing.filingDate, accessionNumber: p.filing.accessionNumber })),
    consecutive: n,
    revenue,
    operatingIncome,
    ocf,
    capex,
    fcf,
    currentAssets: truncate(I(INSTANT_CONCEPTS.currentAssets), n),
    currentLiabilities: truncate(I(INSTANT_CONCEPTS.currentLiabilities), n),
    rd,
    rdSeries: truncate(rd.values, n),
  };
}

/** Operating margin in % at index i; missing when revenue is missing or zero, or operating income is missing. */
function margin(q: QuarterlyRead, i: number): number | undefined {
  const r = q.revenue[i];
  const o = q.operatingIncome[i];
  return r && o !== null ? (o / r) * 100 : undefined;
}

export function quarterFigures(q: QuarterlyRead) {
  const ca = q.currentAssets[0];
  const cl = q.currentLiabilities[0];
  return {
    revenueYoYPct: [yoyPct(q.revenue, 0), yoyPct(q.revenue, 1)] as [number | null, number | null],
    operatingMarginChangePts: marginPtsChange(margin(q, 0), margin(q, RULES.windows.quartersPerYear)) ?? null,
    rdYoYPct: [yoyPct(q.rdSeries, 0), yoyPct(q.rdSeries, 1)] as [number | null, number | null],
    ocf12m: { now: twelveMonth(q.ocf, 0), yearAgo: twelveMonth(q.ocf, RULES.windows.quartersPerYear) },
    fcf12m: { now: twelveMonth(q.fcf, 0), yearAgo: twelveMonth(q.fcf, RULES.windows.quartersPerYear) },
    capex12m: { now: twelveMonth(q.capex, 0), yearAgo: twelveMonth(q.capex, RULES.windows.quartersPerYear) },
    revenue12m: twelveMonth(q.revenue, 0),
    currentRatio: ca !== null && cl ? ca / cl : null,
    currentAssets: ca,
    currentLiabilities: cl,
  };
}
