/**
 * R1 filing calendar and R2 deadlines (rules 11 R1, R2 and 14 D2).
 *
 * R1 projects the next expected periodic filing from the periods actually
 * filed (52/53-week aware) and says when that projection is not
 * measurable. R2 finds the most recent required periodic report, its
 * business-day deadline and any 12b-25 extension, and classifies it into
 * one of the five D2 cases. Everything is as of the assessment date: no
 * filing after it is read.
 */
import type { FilingEntry } from "@/lib/edgar/submissions";
import { estimateNextQuarterEnd, isFloatingFiscalCalendar, tenKDeadlineDays, tenQDeadlineDays } from "@/lib/metrics/deadlines";
import { RULES } from "@/lib/verdict/rulesConfig";
import { addCalendarDays, rollForward } from "@/lib/verdict/repairs/businessDays";
import { classifyRequiredReport, RequiredReportFacts } from "@/lib/verdict/filingStatus";
import type { FilingObservation } from "@/lib/verdict/types";

const DAY = 86_400_000;
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const shiftYears = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + n);
  return d.toISOString().slice(0, 10);
};

const PERIODIC_FORMS = ["10-Q", "10-K", "10-QT", "10-KT"];
const isAnnual = (form: string) => form.startsWith("10-K");

// ------------------------------------------------------------------ R1: fiscal-year-change text

/** 8-K items whose text is read for a fiscal-year change. */
export const FY_CHANGE_ITEMS = ["2.02", "5.03", "7.01", "8.01"];
/** A sentence that speaks of changing the fiscal year (end) or a transition period... */
const FY_CHANGE = /(chang\w*|transition\w*)[^.;]{0,160}fiscal[- ]year|fiscal[- ]year[^.;]{0,160}(chang\w*|transition\w*)/i;
/** ...in terms that announce one. */
const FY_STRONG = /(change|changed|changing)\s+(in|of|to)?\s*(its|our|the company['’]s|the)?\s*fiscal[- ]year[- ]?(end)?|fiscal[- ]year[- ]end\s+(from|to)\b|transition period/i;
/** The Item 5.03 caption names "Change in Fiscal Year" whatever the item reports. */
const ITEM_503_CAPTION = /Amendments? to (the )?Articles of Incorporation or Bylaws;?\s*Change in Fiscal Year\.?/gi;

/** Sentences in one document's text that announce a fiscal-year change (the Item 5.03 caption excluded). */
export function fiscalYearChangeSentences(text: string): string[] {
  const body = text.replace(ITEM_503_CAPTION, " ");
  return body
    .split(/(?<=[.;])\s+/)
    .filter((s) => FY_CHANGE.test(s) && FY_STRONG.test(s))
    .map((s) => s.replace(/\s+/g, " ").trim().slice(0, 400));
}

/** The 8-Ks to read: items 2.02, 5.03, 7.01 or 8.01, filed after the latest period end, up to the assessment date. */
export function eightKsToScan(filings: FilingEntry[], latestPeriodEnd: string, assessmentDate: string): FilingEntry[] {
  return filings.filter(
    (f) =>
      (f.form === "8-K" || f.form === "8-K/A") &&
      f.filingDate > latestPeriodEnd &&
      f.filingDate <= assessmentDate &&
      f.items.split(",").some((i) => FY_CHANGE_ITEMS.includes(i.trim()))
  );
}

export interface FyChangeHit {
  accessionNumber: string;
  filingDate: string;
  items: string;
  part: string;
  sentence: string;
}

// ------------------------------------------------------------------ R1: calendar

export interface FilingCalendar {
  latest: FilingEntry | null;
  annualEnds: string[];
  floating: boolean;
  expected: { form: "10-Q" | "10-K"; periodEnd: string } | null;
  /** Non-empty means "not measurable". */
  reasons: string[];
  measurable: boolean;
}

/** Periodic filings filed on or before the date, one per period end (the first filed), newest period first. */
export function filedPeriods(filings: FilingEntry[], assessmentDate: string): FilingEntry[] {
  const all = filings
    .filter((f) => PERIODIC_FORMS.includes(f.form) && f.reportDate && f.filingDate <= assessmentDate)
    .sort((a, b) => (a.reportDate === b.reportDate ? (a.filingDate < b.filingDate ? -1 : 1) : a.reportDate < b.reportDate ? 1 : -1));
  const out: FilingEntry[] = [];
  for (const f of all) if (!out.some((x) => x.reportDate === f.reportDate)) out.push(f);
  return out;
}

export function filingCalendar(input: {
  filings: FilingEntry[];
  fiscalYearEnd: string | null;
  assessmentDate: string;
  /** The app's own projection (lib/metrics/deadlines.ts nextFilingDue), when it has one. */
  appProjection: { form: string; periodEnd: string } | null;
  fyChangeHits: FyChangeHit[];
}): FilingCalendar {
  const C = RULES.calendar;
  const filed = filedPeriods(input.filings, input.assessmentDate);
  const latest = filed[0];
  if (!latest) return { latest: null, annualEnds: [], floating: false, expected: null, reasons: ["no periodic filing"], measurable: false };
  const reasons: string[] = [];
  const annualEnds = filed.filter((f) => isAnnual(f.form)).map((f) => f.reportDate);
  const floating = isFloatingFiscalCalendar(annualEnds);
  const nextEnd = estimateNextQuarterEnd(latest.reportDate, floating);
  const latestK = annualEnds[0];
  const anniversary = (d: string) => !!latestK && [1, 2].some((n) => Math.abs(daysBetween(shiftYears(latestK, n), d)) <= C.fiscalYearEndToleranceDays);
  const expected = { form: (anniversary(nextEnd) ? "10-K" : "10-Q") as "10-Q" | "10-K", periodEnd: nextEnd };

  const since = shiftYears(input.assessmentDate, -C.transitionLookbackYears);
  const transition = input.filings.filter((f) => (f.form === "10-KT" || f.form === "10-QT") && f.filingDate >= since && f.filingDate <= input.assessmentDate);
  if (transition.length) reasons.push(`transition-period form filed: ${transition.map((f) => `${f.form} ${f.filingDate}`).join(", ")}`);
  if (annualEnds.length >= 2) {
    const gap = daysBetween(annualEnds[1], annualEnds[0]);
    if (gap < C.annualGapMinDays || gap > C.annualGapMaxDays) reasons.push(`10-K period ends ${annualEnds[1]} and ${annualEnds[0]} are ${gap} days apart`);
  }
  if (input.fiscalYearEnd && latestK) {
    const mm = input.fiscalYearEnd.slice(0, 2);
    const dd = input.fiscalYearEnd.slice(2);
    const y = Number(latestK.slice(0, 4));
    const near = [y - 1, y, y + 1].map((yy) => Math.abs(daysBetween(`${yy}-${mm}-${dd}`, latestK)));
    if (Math.min(...near) > C.fiscalYearEndToleranceDays) reasons.push(`latest 10-K period end ${latestK} is more than ${C.fiscalYearEndToleranceDays} days from the stated fiscal-year end ${input.fiscalYearEnd}`);
  }
  if (filed.length >= 2) {
    const gap = daysBetween(filed[1].reportDate, latest.reportDate);
    if (gap < C.quarterGapMinDays || gap > C.quarterGapMaxDays) reasons.push(`latest two period ends ${filed[1].reportDate} and ${latest.reportDate} are ${gap} days apart`);
  }
  const app = input.appProjection;
  if (app && (app.form !== expected.form || Math.abs(daysBetween(app.periodEnd, expected.periodEnd)) > C.projectionToleranceDays)) {
    reasons.push(`filed-history projection (${expected.form} for ${expected.periodEnd}) disagrees with the app's (${app.form} for ${app.periodEnd})`);
  }
  if (input.fyChangeHits.length) {
    const seen = [...new Set(input.fyChangeHits.map((h) => `${h.filingDate} ${h.accessionNumber} (items ${h.items})`))];
    reasons.push(`8-K text announces a fiscal-year change: ${seen.join("; ")}`);
  }
  return { latest, annualEnds: annualEnds.slice(0, 3), floating, expected, reasons, measurable: reasons.length === 0 };
}

// ------------------------------------------------------------------ R2: deadlines and the required report

export interface ReportDeadline {
  form: "10-Q" | "10-K";
  periodEnd: string;
  /** Period end + the filer category's days, before any roll-forward. */
  nominal: string;
  /** Rolled forward to a business day. */
  deadline: string;
  /** The 12b-25 that extends it, if any. */
  nt: FilingEntry | null;
  /** Rolled deadline + 5 (10-Q) or 15 (10-K) calendar days, rolled forward to a business day. */
  extendedDeadline: string | null;
}

export function deadlineDays(form: "10-Q" | "10-K", category: string | null): number | undefined {
  return form === "10-K" ? tenKDeadlineDays(category) : tenQDeadlineDays(category);
}

/** The deadline for one report, rolled forward, and the 12b-25 extension when `nt` is given. */
export function reportDeadline(form: "10-Q" | "10-K", periodEnd: string, category: string | null, nt: FilingEntry | null): ReportDeadline | undefined {
  const days = deadlineDays(form, category);
  if (days === undefined) return undefined;
  const nominal = addCalendarDays(periodEnd, days);
  const deadline = rollForward(nominal);
  const ext = form === "10-K" ? RULES.filing.extension10KDays : RULES.filing.extension10QDays;
  return { form, periodEnd, nominal, deadline, nt, extendedDeadline: nt ? rollForward(addCalendarDays(deadline, ext)) : null };
}

const ntFormFor = (form: "10-Q" | "10-K") => (form === "10-K" ? "NT 10-K" : "NT 10-Q");

/** A 12b-25 for this report: the matching NT form for the same period end (within the calendar tolerance), filed on or before the date. */
export function twelveB25For(filings: FilingEntry[], form: "10-Q" | "10-K", periodEnd: string, assessmentDate: string): FilingEntry | null {
  return (
    filings
      .filter((f) => f.form === ntFormFor(form) && f.filingDate <= assessmentDate && f.reportDate && Math.abs(daysBetween(f.reportDate, periodEnd)) <= RULES.calendar.projectionToleranceDays)
      .sort((a, b) => (a.filingDate < b.filingDate ? -1 : 1))[0] ?? null
  );
}

export interface TwelveB25Event {
  nt: FilingEntry;
  deadline: ReportDeadline;
  report: FilingEntry | null;
  observation: FilingObservation | null;
}

export interface RequiredReportResult {
  observation: FilingObservation;
  /** The report the observation is about, with its deadline. */
  report: (ReportDeadline & { filedOn: string | null }) | null;
  /** Every 12b-25 in the filing lookback window, classified (informational detail for the report). */
  twelveB25: TwelveB25Event[];
  how: string;
}

const formOf = (f: FilingEntry): "10-Q" | "10-K" => (isAnnual(f.form) ? "10-K" : "10-Q");

/**
 * The most recent required periodic report as of the assessment date and
 * its D2 case. The projected next report counts once its deadline has
 * passed; until then the latest filed report is the most recent required
 * one. A 12b-25'd report in the lookback window that is still unfiled past
 * its extended deadline is overdue whatever came after it.
 */
export function requiredReport(input: { filings: FilingEntry[]; category: string | null; assessmentDate: string; calendar: FilingCalendar }): RequiredReportResult {
  const { filings, category, assessmentDate, calendar } = input;
  const windowStart = addCalendarDays(assessmentDate, -RULES.windows.filingLookbackDays);
  const periodic = filings.filter((f) => PERIODIC_FORMS.includes(f.form) && f.filingDate <= assessmentDate);
  const reportFor = (form: "10-Q" | "10-K", periodEnd: string) =>
    periodic
      .filter((f) => formOf(f) === form && Math.abs(daysBetween(f.reportDate, periodEnd)) <= RULES.calendar.projectionToleranceDays)
      .sort((a, b) => (a.filingDate < b.filingDate ? -1 : 1))[0] ?? null;

  const twelveB25: TwelveB25Event[] = [];
  for (const nt of filings.filter((f) => (f.form === "NT 10-Q" || f.form === "NT 10-K") && f.filingDate >= windowStart && f.filingDate <= assessmentDate && f.reportDate)) {
    const form = nt.form === "NT 10-K" ? "10-K" : "10-Q";
    const d = reportDeadline(form, nt.reportDate, category, nt);
    if (!d) continue;
    const report = reportFor(form, nt.reportDate);
    const facts: RequiredReportFacts = { form, periodEnd: nt.reportDate, deadline: d.deadline, extendedDeadline: d.extendedDeadline, filedOn: report?.filingDate ?? null };
    twelveB25.push({ nt, deadline: d, report, observation: classifyRequiredReport(facts, assessmentDate) });
  }

  if (!calendar.measurable || !calendar.expected || !calendar.latest) {
    return { observation: { measurable: false, reason: calendar.reasons.join("; ") || "filing calendar not measurable" }, report: null, twelveB25, how: "R1 not measurable" };
  }
  if (deadlineDays("10-Q", category) === undefined) {
    return { observation: { measurable: false, reason: "filer category unknown" }, report: null, twelveB25, how: "no filer category" };
  }

  // A 12b-25'd report never filed past its extended deadline.
  const unfiled = twelveB25.find((e) => e.observation && e.observation.measurable && e.observation.case === "overdue");
  if (unfiled && unfiled.observation) {
    return { observation: unfiled.observation, report: { ...unfiled.deadline, filedOn: null }, twelveB25, how: `12b-25 ${unfiled.nt.accessionNumber}: report not filed` };
  }

  const e = calendar.expected;
  const eNt = twelveB25For(filings.filter((f) => f.filingDate > calendar.latest!.filingDate), e.form, e.periodEnd, assessmentDate);
  const eDeadline = reportDeadline(e.form, e.periodEnd, category, eNt)!;
  const eFiled = reportFor(e.form, e.periodEnd);
  const eObs = classifyRequiredReport({ form: e.form, periodEnd: e.periodEnd, deadline: eDeadline.deadline, extendedDeadline: eDeadline.extendedDeadline, filedOn: eFiled?.filingDate ?? null }, assessmentDate);
  if (eObs) return { observation: eObs, report: { ...eDeadline, filedOn: eFiled?.filingDate ?? null }, twelveB25, how: `next expected ${e.form} for ${e.periodEnd}` };

  // The next report is not yet due: the latest filed report is the most recent required one.
  const latest = calendar.latest;
  const form = formOf(latest);
  const lNt = twelveB25For(filings, form, latest.reportDate, assessmentDate);
  const lDeadline = reportDeadline(form, latest.reportDate, category, lNt)!;
  const lObs = classifyRequiredReport({ form, periodEnd: latest.reportDate, deadline: lDeadline.deadline, extendedDeadline: lDeadline.extendedDeadline, filedOn: latest.filingDate }, assessmentDate);
  return {
    observation: lObs ?? { measurable: false, reason: "latest filed report could not be classified" },
    report: { ...lDeadline, filedOn: latest.filingDate },
    twelveB25,
    how: `next expected ${e.form} for ${e.periodEnd} not yet due (deadline ${eDeadline.deadline}); latest filed ${latest.form} for ${latest.reportDate}`,
  };
}
