import { CompanyFacts, getConceptPoints } from "@/lib/edgar/companyFacts";
import { FilingEntry } from "@/lib/edgar/submissions";
import { buildFilingPeriods, FilingPeriod, resolveCumulativeToDate } from "@/lib/xbrl/periods";
import { KeyFinancials } from "@/lib/xbrl/keyFinancials";

export interface AnnualYear {
  label: string; // e.g. "FY26"
  periodEnd: string;
}

export interface AnnualCell {
  value: number;
  concept: string;
}

export interface AnnualFigures {
  /** Newest first, up to ANNUAL_YEARS entries. */
  years: AnnualYear[];
  rows: {
    revenue: (AnnualCell | null)[];
    grossProfit: (AnnualCell | null)[];
    researchAndDevelopment: (AnnualCell | null)[];
    sga: (AnnualCell | null)[];
    operatingIncome: (AnnualCell | null)[];
    netIncome: (AnnualCell | null)[];
    freeCashFlow: (AnnualCell | null)[];
    cash: (AnnualCell | null)[];
  };
  /** Index-aligned with `years`; percentages, e.g. 75.0. */
  grossMarginPct: (number | undefined)[];
  operatingMarginPct: (number | undefined)[];
}

/** "three fiscal years with two comparisons: FY | vs prior FY | FY−1 | vs FY−2 | FY−2". */
export const ANNUAL_YEARS = 3;

/**
 * Enough trailing periodic filings to reach three 10-Ks. A filer posts one
 * 10-K and three 10-Qs a year, so three fiscal years is ~12 filings; the
 * slack absorbs a transition period or a skipped quarter.
 */
const ANNUAL_LOOKBACK_FILINGS = 16;

function annualDuration(
  facts: CompanyFacts,
  concept: string | undefined,
  fyPeriod: FilingPeriod
): AnnualCell | null {
  if (!concept) return null;
  const points = getConceptPoints(facts, concept);
  if (!points) return null;
  const resolved = resolveCumulativeToDate(points, fyPeriod);
  return resolved ? { value: resolved.value, concept } : null;
}

function annualInstant(
  facts: CompanyFacts,
  concept: string | undefined,
  fyPeriod: FilingPeriod
): AnnualCell | null {
  if (!concept) return null;
  const points = getConceptPoints(facts, concept);
  if (!points) return null;
  // A 10-K's balance sheet IS the fiscal-year-end snapshot: no derivation,
  // just the fact whose instant is that period end.
  const at = points.filter((p) => p.end === fyPeriod.filing.reportDate);
  if (!at.length) return null;
  const exact = at.find((p) => p.accn === fyPeriod.filing.accessionNumber);
  const chosen = exact ?? at.reduce((best, p) => (p.filed > best.filed ? p : best));
  return { value: chosen.val, concept };
}

/**
 * Applies a quarterly row's chosen concept to an annual period, including
 * the composite labels the quarterly resolver produces ("A+B", "A-B").
 * Missing either side leaves the cell missing -- never a partial sum.
 */
function resolveConcept(
  label: string | undefined,
  lookup: (concept: string) => AnnualCell | null
): AnnualCell | null {
  if (!label) return null;
  const plus = label.split("+");
  if (plus.length === 2) {
    const [a, b] = plus.map(lookup);
    return a && b ? { value: a.value + b.value, concept: label } : null;
  }
  // Split only on a "-" that separates two tag names, not a hyphen inside one.
  const minus = label.split(/-(?=[A-Za-z])/);
  if (minus.length === 2) {
    const [a, b] = minus.map(lookup);
    return a && b ? { value: a.value - b.value, concept: label } : null;
  }
  return lookup(label);
}

function marginPct(numerator: AnnualCell | null, revenue: AnnualCell | null): number | undefined {
  if (!numerator || !revenue || revenue.value === 0) return undefined;
  return (numerator.value / revenue.value) * 100;
}

/**
 * "Full fiscal years sit behind an Annual toggle", now over three years
 * with two comparison columns and the same rows as the quarterly view,
 * margins included.
 *
 * Each row reuses whichever tag the quarterly table settled on, so the two
 * views can't silently disagree about what "SG&A" means for this filer.
 * The fiscal years come from their own, longer filing lookback: the
 * quarterly window only needs enough history to derive a Q4, which is not
 * enough to reach three 10-Ks. That list is built here and never touches
 * kf.lookbackPeriods, which the red-flag window and Q4 derivation read.
 */
export function buildAnnualFigures(
  facts: CompanyFacts,
  kf: KeyFinancials,
  periodicFilingList: FilingEntry[]
): AnnualFigures | null {
  // The same fiscal calendar the quarterly window used, so a 10-K cannot
  // be "FY26" on one view and "FY25" on the other.
  const fyPeriods = buildFilingPeriods(kf.fiscalCalendar, periodicFilingList.slice(0, ANNUAL_LOOKBACK_FILINGS))
    .filter((p) => p.fp === "FY")
    .slice(0, ANNUAL_YEARS);
  if (fyPeriods.length === 0) return null;

  // p.label is "Q4 FYnn" (the derived-quarter convention) -- the annual
  // view wants "FYnn", since it's the whole year, not the Q4 stand-in.
  const years: AnnualYear[] = fyPeriods.map((p) => ({
    label: p.label.replace(/^Q4 /, ""),
    periodEnd: p.filing.reportDate,
  }));

  // Whichever concept the quarterly row settled on, including a composite
  // label like "A+B" or "A-B" -- resolveConcept below re-applies the same
  // arithmetic to the annual figures, so a filer whose SG&A is a sum of
  // two tags quarterly is a sum of the same two tags annually.
  const firstConcept = (values: KeyFinancials["revenue"]["values"]) =>
    values.find((v) => v)?.concept;

  const revenueConcept = firstConcept(kf.revenue.values);
  const costOfRevenueConcept = firstConcept(kf.costOfRevenue.values);
  // Gross profit's own tag, only if the quarterly row used it directly --
  // the composite case is rebuilt from revenue and cost below instead.
  const grossProfitConceptDirect = kf.grossProfit.values.find(
    (v) => v && !v.concept.includes("-")
  )?.concept;
  const rndConcept = firstConcept(kf.researchAndDevelopment.values);
  const sgaConcept = firstConcept(kf.sga.values);
  const opIncConcept = firstConcept(kf.operatingIncome.values);
  const netIncConcept = firstConcept(kf.netIncome.values);
  const ocfConcept = firstConcept(kf.operatingCashFlow.values);
  const capexConcept = firstConcept(kf.capitalExpenditures.values);
  const cashConcept = firstConcept(kf.cash.values);

  const duration = (concept: string | undefined, p: FilingPeriod) =>
    resolveConcept(concept, (c) => annualDuration(facts, c, p));

  const revenue = fyPeriods.map((p) => duration(revenueConcept, p));
  const costOfRevenue = fyPeriods.map((p) => duration(costOfRevenueConcept, p));
  const grossProfitDirect = fyPeriods.map((p) => duration(grossProfitConceptDirect, p));
  const grossProfit = grossProfitDirect.map((direct, i) => {
    if (direct) return direct;
    const r = revenue[i];
    const c = costOfRevenue[i];
    return r && c ? { value: r.value - c.value, concept: `${r.concept}-${c.concept}` } : null;
  });
  const researchAndDevelopment = fyPeriods.map((p) => duration(rndConcept, p));
  const sga = fyPeriods.map((p) => duration(sgaConcept, p));
  const operatingIncome = fyPeriods.map((p) => duration(opIncConcept, p));
  const netIncome = fyPeriods.map((p) => duration(netIncConcept, p));
  const ocf = fyPeriods.map((p) => duration(ocfConcept, p));
  const capex = fyPeriods.map((p) => duration(capexConcept, p));
  const freeCashFlow = ocf.map((o, i) => {
    const c = capex[i];
    return o && c ? { value: o.value - c.value, concept: `${o.concept}-${c.concept}` } : null;
  });

  // Cash is a balance, not a flow: read the fiscal-year-end instant
  // directly rather than reusing the quarterly window, which only reaches
  // back five quarters and so can't cover FY-2.
  const cash = fyPeriods.map((p) =>
    resolveConcept(cashConcept, (c) => annualInstant(facts, c, p))
  );

  return {
    years,
    rows: {
      revenue,
      grossProfit,
      researchAndDevelopment,
      sga,
      operatingIncome,
      netIncome,
      freeCashFlow,
      cash,
    },
    grossMarginPct: revenue.map((r, i) => marginPct(grossProfit[i], r)),
    operatingMarginPct: revenue.map((r, i) => marginPct(operatingIncome[i], r)),
  };
}
