/**
 * R5 stale quarters (rules 11 R5). When EDGAR lists a newer 10-Q/10-K than
 * company facts has aggregated, the newer quarter is rebuilt from that
 * filing's own XBRL instance (its statement extract: every
 * non-dimensional US-dollar duration and balance-sheet instant), with the
 * quarterly operating cash flow derived from year-to-date values by the
 * app's own resolver. EDGAR frames are not used.
 *
 * The rebuild is accepted only when it passes two checks on operating cash
 * flow:
 * - fiscal period: the filing's year-to-date figure spans the fiscal
 *   period the calendar places it in, and starts where the prior
 *   quarter's year-to-date figure starts (the same fiscal year);
 * - reconciliation: the filing's own prior-year comparative equals the
 *   figure company facts already holds for that period, and the rebuilt
 *   quarter equals year-to-date minus the prior year-to-date.
 * Otherwise the newer filing stays unincorporated and the read is stale.
 */
import type { CompanyFacts, FactPoint } from "@/lib/edgar/companyFacts";
import { getConceptPoints } from "@/lib/edgar/companyFacts";
import type { KeyFinancials } from "@/lib/xbrl/keyFinancials";
import { DURATION_WINDOWS, FilingPeriod } from "@/lib/xbrl/periods";
import { DURATION_CONCEPTS } from "@/lib/xbrl/concepts";
import type { FilingStatementExtract } from "@/lib/xbrl/statementExtract";
import { RULES } from "@/lib/verdict/rulesConfig";

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/** The newest periodic filing when company facts has not aggregated it yet (the app's lookback leads its published periods). */
export function newerFilingNotIncorporated(kf: KeyFinancials): FilingPeriod | null {
  const filed = kf.lookbackPeriods[0];
  const published = kf.publishedPeriods[0];
  if (!filed || !published) return null;
  return filed.filing.reportDate > published.filing.reportDate ? filed : null;
}

/** Company facts with the filing's own facts added as points of that filing (pure; the input is not changed). */
export function withFilingFacts(facts: CompanyFacts, x: FilingStatementExtract, period: FilingPeriod): CompanyFacts {
  const raw = structuredClone(facts.raw);
  const add = (element: string, point: Omit<FactPoint, "accn" | "fy" | "fp" | "form" | "filed">) => {
    const [tax, name] = element.split(":");
    if (!tax || !name) return;
    const concept = ((raw.facts[tax] ??= {})[name] ??= { units: {} });
    const pts = (concept.units.USD ??= []);
    if (pts.some((p) => p.accn === x.accessionNumber && p.end === point.end && p.start === point.start)) return;
    pts.push({ ...point, accn: x.accessionNumber, fy: period.fy, fp: period.fp, form: x.form, filed: x.filingDate });
  };
  for (const [element, fs] of Object.entries(x.facts)) for (const f of fs) add(element, { start: f.start, end: f.end, val: f.value });
  for (const [element, fs] of Object.entries(x.instants)) for (const f of fs) add(element, { end: f.end, val: f.value });
  return { ...facts, raw };
}

export interface RebuildCheck {
  ok: boolean;
  concept: string | null;
  ytd: { start: string; end: string; value: number } | null;
  priorYtd: { start: string; end: string; value: number; accn: string } | null;
  comparative: { start: string; end: string; filing: number; companyFacts: number | null } | null;
  quarter: number | null;
  reasons: string[];
}

const within = (start: string, end: string, [min, max]: [number, number]) => {
  const d = days(start, end);
  return d >= min && d <= max;
};

/**
 * The fiscal-period and reconciliation checks on operating cash flow, pure
 * over the original company facts, the filing's extract, the placed period
 * and its sibling periods.
 */
export function checkOcfRebuild(facts: CompanyFacts, x: FilingStatementExtract, period: FilingPeriod, all: FilingPeriod[]): RebuildCheck {
  const C = RULES.calendar;
  const reasons: string[] = [];
  const end = period.filing.reportDate;
  const window = DURATION_WINDOWS[period.fp];
  let concept: string | null = null;
  let ytd: RebuildCheck["ytd"] = null;
  for (const c of DURATION_CONCEPTS.operatingCashFlow) {
    const f = (x.facts[`us-gaap:${c}`] ?? []).find((v) => v.end === end && within(v.start, v.end, window));
    if (f) {
      concept = c;
      ytd = { start: f.start, end: f.end, value: f.value };
      break;
    }
  }
  const fail = (why: string): RebuildCheck => ({ ok: false, concept, ytd, priorYtd: null, comparative: null, quarter: null, reasons: [...reasons, why] });
  if (!concept || !ytd) return fail(`no operating cash flow for the ${period.fp} year to date ending ${end} in the filing`);

  // Fiscal period: the prior quarter's year-to-date figure in company facts starts on the same day.
  let priorYtd: RebuildCheck["priorYtd"] = null;
  let quarter: number | null = null;
  if (period.fp === "Q1") quarter = ytd.value;
  else {
    const priorFp = period.fp === "Q2" ? "Q1" : period.fp === "Q3" ? "Q2" : "Q3";
    const prior = all.find((p) => p.fy === period.fy && p.fp === priorFp && p.filing.reportDate < end);
    if (!prior) return fail(`no ${priorFp} period for FY${period.fy} to subtract`);
    const pts = (getConceptPoints(facts, concept) ?? []).filter((p) => p.start && p.end === prior.filing.reportDate && within(p.start, p.end, DURATION_WINDOWS[priorFp]));
    const best = pts.find((p) => p.accn === prior.filing.accessionNumber) ?? pts.sort((a, b) => (a.filed < b.filed ? 1 : -1))[0];
    if (!best) return fail(`no ${priorFp} year-to-date operating cash flow in company facts for ${prior.filing.reportDate}`);
    priorYtd = { start: best.start as string, end: best.end, value: best.val, accn: best.accn };
    if (priorYtd.start !== ytd.start) return fail(`year-to-date starts differ: filing ${ytd.start}, prior quarter ${priorYtd.start}`);
    quarter = ytd.value - priorYtd.value;
  }

  // Reconciliation: the filing's prior-year comparative against company facts.
  const comp = (x.facts[`us-gaap:${concept}`] ?? []).find((v) => v.end < ytd!.start && Math.abs(days(v.end, end) - C.yearDays) <= C.fiscalYearEndToleranceDays && Math.abs(days(v.start, v.end) - days(ytd!.start, ytd!.end)) <= C.fiscalYearEndToleranceDays);
  let comparative: RebuildCheck["comparative"] = null;
  if (!comp) return fail("no prior-year comparative operating cash flow in the filing");
  const held = (getConceptPoints(facts, concept) ?? []).filter((p) => p.start === comp.start && p.end === comp.end).sort((a, b) => (a.filed < b.filed ? 1 : -1))[0];
  comparative = { start: comp.start, end: comp.end, filing: comp.value, companyFacts: held?.val ?? null };
  if (!held) return { ...fail(`company facts has no operating cash flow for ${comp.start}–${comp.end} to reconcile with`), comparative, priorYtd };
  if (held.val !== comp.value) return { ...fail(`prior-year comparative ${comp.value} differs from company facts ${held.val}`), comparative, priorYtd };

  return { ok: true, concept, ytd, priorYtd, comparative, quarter, reasons };
}
