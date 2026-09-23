import { CompanyFacts, FactPoint, getConceptPoints } from "@/lib/edgar/companyFacts";
import { FilingEntry } from "@/lib/edgar/submissions";
import { ANCHOR_CONCEPTS, DURATION_CONCEPTS, INSTANT_CONCEPTS } from "@/lib/xbrl/concepts";
import {
  buildFilingPeriods,
  buildFiscalCalendar,
  FiscalCalendar,
  FilingPeriod,
  hasCumulativeAt,
  isDerivedMethod,
  resolveCumulativeToDate,
  resolveDuration,
  resolveInstant,
  ResolutionMethod,
} from "@/lib/xbrl/periods";

export interface QuarterColumn {
  label: string;
  periodEnd: string;
  form: string;
  accessionNumber: string;
  filingDate: string;
}

/**
 * Every cell describes its own provenance (concept/method/derived), but
 * that's a reporting concern, not a tag-selection one: a row picks ONE
 * winning tag (best coverage across the 5 displayed quarters, ties broken
 * by priority order) and uses it for every cell it covers. A different tag
 * is only ever used to fill a gap the winning tag left, and only after
 * confirming the two tags actually agree (within $1M) on the most recent
 * period they both tag -- never on faith that same-sounding tags mean the
 * same thing. Those filled cells report method "spliced" (or
 * "spliced-ytd", when the quarter is one tag's year-to-date figure minus
 * the other's prior one). A tag priority list's formula fallback (gross profit,
 * SG&A, total liabilities, long-term debt) is a whole-row alternative: the
 * row uses whichever of the two -- primary tag or formula -- covers more of
 * the five quarters, and never mixes them cell by cell. Switching to the
 * formula needs the same corroboration as splicing: in every quarter where
 * both the primary tag and the formula produce a value, they must agree
 * within $1M. See wholeRowFallback.
 */
export interface CellValue {
  value: number;
  /** us-gaap tag (or a "A+B" / "A-B" composite label naming the tags combined) this cell actually came from. */
  concept: string;
  method: ResolutionMethod;
  /** Convenience flag = isDerivedMethod(method); false only for "direct"/"instant". */
  derived: boolean;
  /**
   * The nil rule: labels of prior periods whose year-to-date figure is not
   * in the filed statement and was read as nil to derive this cell.
   * Provenance reads "not in the filed statement, read as nil". Absent on
   * every other cell.
   */
  nilPeriods?: string[];
  /** "spliced-ytd" only: the second tag whose prior year-to-date figure was subtracted. */
  splicedWith?: string;
}

export interface LineItem {
  values: (CellValue | undefined)[]; // aligned to quarters, undefined = missing (never zero/guessed)
}

export interface KeyFinancials {
  quarters: QuarterColumn[];
  /**
   * Every periodic filing in the lookback, newest first -- including one
   * company facts has not aggregated yet. The filing deadline and the
   * missed-deadline red flag read this list, because what decides whether
   * a deadline was met is whether the company FILED, not whether EDGAR has
   * finished folding the filing into its aggregate.
   */
  lookbackPeriods: FilingPeriod[];
  /**
   * The subset of `lookbackPeriods` that company facts actually carries
   * figures for, newest first. The displayed quarters are the first five
   * of these, and day counts are measured along them.
   *
   * The two lists differ for a few days after a company reports: EDGAR
   * lists the filing immediately but publishes its facts later. A column
   * of blanks is not a quarter, so the board shows the last published one
   * -- and says so, rather than letting the newer filing vanish.
   */
  publishedPeriods: FilingPeriod[];
  /** The fiscal calendar every period was placed against; reused by the annual view so the two cannot disagree. */
  fiscalCalendar: FiscalCalendar;
  revenue: LineItem;
  costOfRevenue: LineItem;
  grossProfit: LineItem;
  researchAndDevelopment: LineItem;
  sga: LineItem;
  operatingIncome: LineItem;
  netIncome: LineItem;
  /**
   * Read for the explanation triggers only -- not a displayed row, not a
   * lens input. The non-operating-swing and unusual-tax tests need the two
   * lines between operating income and net income; everything else in the
   * app deliberately stops at operating income.
   */
  pretaxIncome: LineItem;
  incomeTaxExpense: LineItem;
  operatingCashFlow: LineItem;
  capitalExpenditures: LineItem;
  freeCashFlow: LineItem;
  cash: LineItem;
  /**
   * Short-term investments, read for the runway only (cash plus short-term
   * investments). `shortTermInvestmentsFiledEver` separates a filer that
   * never reports the line -- runway uses cash alone and says nothing --
   * from one that reports it but not for this quarter, which the runway
   * text has to say.
   */
  shortTermInvestments: LineItem;
  shortTermInvestmentsFiledEver: boolean;
  accountsReceivable: LineItem;
  accountsPayable: LineItem;
  currentAssets: LineItem;
  currentLiabilities: LineItem;
  totalAssets: LineItem;
  totalLiabilities: LineItem;
  equity: LineItem;
  retainedEarnings: LineItem;
  longTermDebt: LineItem;
  /**
   * Has this filer put any of the debt row's own tags on a balance sheet
   * inside the lookback window?
   *
   * False separates "they have no debt" from "we can't see their debt",
   * which the debt/equity row cannot: both come out of the row as an
   * absent value. A company that has never tagged debt in the lookback
   * shows "—" with "no debt reported in filings"; MISSING is reserved for
   * a tag that exists but isn't filed for this quarter.
   *
   * Only the three tags the row itself reads count. A tag the row never
   * looks at could not have produced a figure for the row, so its presence
   * says nothing about why the row is empty.
   */
  debtTagFiledInLookback: boolean;
}

/**
 * "Free cash flow = operating cash flow − capital expenditures, as filed in
 * XBRL (tag shown per company). May differ from a company's own non-GAAP
 * figure." -- generic footer copy for any ticker; e.g. NVIDIA's own FCF
 * also nets out finance-lease principal payments, which aren't filed as a
 * distinct XBRL tag and so can't be reproduced from structured filing data.
 */
export const FCF_FOOTER_TEXT =
  "Free cash flow = operating cash flow − capital expenditures, as filed in XBRL (tag shown per company). May differ from a company's own non-GAAP figure.";

const LOOKBACK_COUNT = 9; // enough trailing periodic filings to resolve any Q4 in the 5-quarter window

export function cell(value: number, concept: string, method: ResolutionMethod, nilPeriods?: string[]): CellValue {
  const out: CellValue = { value, concept, method, derived: isDerivedMethod(method) };
  if (nilPeriods?.length) out.nilPeriods = nilPeriods;
  return out;
}

const SPLICE_TOLERANCE_USD = 1_000_000;

/**
 * The single definition of "these two sources report the same figure":
 * equal within $1M of rounding. Both corroboration checks are built on it
 * -- tagsAgree (cell-level splicing) and wholeRowFallback's switch gate --
 * so the tolerance is declared once.
 */
function agreeWithinTolerance(a: number, b: number): boolean {
  return Math.abs(a - b) <= SPLICE_TOLERANCE_USD;
}

/**
 * True if two tags' raw fact points agree (within $1M) on the MOST RECENT
 * exact period both tag -- same (start,end) for a duration concept, same
 * `end` for an instant one -- anywhere in the company's filings, not just
 * the display window. This is the corroboration required before a
 * gap-filling ("spliced") tag is trusted to mean the same thing as the
 * row's primary tag.
 *
 * The most recent shared period, not any shared period: two tags that
 * agreed years ago and disagree now have drifted apart -- a definition
 * changed, or one tag started carrying something the other doesn't --
 * and an old agreement proves nothing about the quarter being filled. Each
 * tag's value there is its latest-filed one, so a restatement counts.
 */
export function tagsAgree(pointsA: FactPoint[], pointsB: FactPoint[], keyOf: (p: FactPoint) => string): boolean {
  const latestByKey = (points: FactPoint[]) => {
    const out = new Map<string, FactPoint>();
    for (const p of points) {
      const k = keyOf(p);
      const prev = out.get(k);
      if (!prev || p.filed > prev.filed) out.set(k, p);
    }
    return out;
  };
  const a = latestByKey(pointsA);
  const b = latestByKey(pointsB);
  let recent: { a: FactPoint; b: FactPoint } | undefined;
  for (const [k, pa] of a) {
    const pb = b.get(k);
    if (!pb) continue;
    // Most recent = latest period end; for the same end, the shorter
    // duration (the quarter before the year-to-date figure).
    if (
      !recent ||
      pa.end > recent.a.end ||
      (pa.end === recent.a.end && (pa.start ?? "") > (recent.a.start ?? ""))
    ) {
      recent = { a: pa, b: pb };
    }
  }
  return recent !== undefined && agreeWithinTolerance(recent.a.val, recent.b.val);
}

const durationKey = (p: FactPoint) => `${p.start}|${p.end}`;
const instantKey = (p: FactPoint) => p.end;

/**
 * One tag per row: picks whichever candidate tag covers the most of the 5
 * displayed quarters (ties broken by priority order), then fills any
 * remaining gaps from another candidate ONLY if that candidate is
 * corroborated (see tagsAgree) against the winning tag. A cell that no
 * validated tag covers stays MISSING.
 *
 * A proven splice also carries year-to-date subtraction across the two
 * tags: when neither tag alone can derive the quarter, one tag's
 * year-to-date figure minus the other's prior one can ("spliced-ytd").
 * That is the shape of a filer switching tags inside a fiscal year.
 */
function resolveSeries<T extends { value: number; method: ResolutionMethod; nilPeriods?: string[] }>(
  facts: CompanyFacts,
  conceptNames: readonly string[],
  displayPeriods: FilingPeriod[],
  resolveOne: (points: FactPoint[], period: FilingPeriod, concept: string) => T | undefined,
  keyOf: (p: FactPoint) => string
): LineItem {
  const pointsByConcept = new Map<string, FactPoint[]>();
  for (const name of conceptNames) {
    const points = getConceptPoints(facts, name);
    if (points) pointsByConcept.set(name, points);
  }
  if (pointsByConcept.size === 0) {
    return { values: displayPeriods.map(() => undefined) };
  }

  let primary = "";
  let primaryValues: (CellValue | undefined)[] = [];
  let bestCoverage = -1;
  for (const name of conceptNames) {
    const points = pointsByConcept.get(name);
    if (!points) continue;
    const values = displayPeriods.map((period) => {
      const resolved = resolveOne(points, period, name);
      return resolved ? cell(resolved.value, name, resolved.method, resolved.nilPeriods) : undefined;
    });
    const coverage = values.filter((v) => v !== undefined).length;
    if (coverage > bestCoverage) {
      bestCoverage = coverage;
      primary = name;
      primaryValues = values;
    }
  }

  const primaryPoints = pointsByConcept.get(primary)!;
  const values = primaryValues.map((v, i) => {
    if (v) return v;
    const period = displayPeriods[i];
    const proven = conceptNames.filter((name) => {
      if (name === primary) return false;
      const altPoints = pointsByConcept.get(name);
      return altPoints !== undefined && tagsAgree(primaryPoints, altPoints, keyOf);
    });
    for (const name of proven) {
      const resolved = resolveOne(pointsByConcept.get(name)!, period, name);
      if (resolved) return cell(resolved.value, name, "spliced", resolved.nilPeriods);
    }
    // Neither tag alone: year-to-date subtraction across the pair. The
    // cell names the tag whose figure ends at this period (the current
    // year-to-date) and the other as the one its prior figure came from.
    for (const name of proven) {
      const altPoints = pointsByConcept.get(name)!;
      const merged = [...primaryPoints, ...altPoints];
      const resolved = resolveOne(merged, period, primary);
      if (resolved && resolved.method !== "direct" && resolved.method !== "instant") {
        const end = period.filing.reportDate;
        const current = primaryPoints.some((p) => p.end === end) ? primary : name;
        const other = current === primary ? name : primary;
        return { ...cell(resolved.value, current, "spliced-ytd", resolved.nilPeriods), splicedWith: other };
      }
    }
    return undefined;
  });
  return { values };
}

/**
 * The nil rule, for cash-flow year-to-date gaps only. A missing prior
 * year-to-date figure counts as nil when all three hold:
 *   (a) that quarter's filing is published in company facts (it is one of
 *       `allPeriods`, which are the published periods);
 *   (b) no candidate tag for the row has a value for that period;
 *   (c) the filer has used the same tag in a 10-Q before that quarter.
 * A company that raised no debt in Q1 usually leaves the line off its Q1
 * statement; its six-month figure is then the Q2 figure. Without (c), a
 * tag the company has only ever used in 10-Ks would turn every quarter's
 * gap into zero.
 */
export function nilRule(
  facts: CompanyFacts,
  conceptNames: readonly string[],
  allPeriods: FilingPeriod[]
): (tag: string) => (prior: FilingPeriod) => boolean {
  return (tag) => (prior) => {
    if (!allPeriods.includes(prior)) return false;
    for (const name of conceptNames) {
      const points = getConceptPoints(facts, name);
      if (points && hasCumulativeAt(points, prior)) return false;
    }
    const points = getConceptPoints(facts, tag) ?? [];
    return points.some((p) => p.form.startsWith("10-Q") && p.filed < prior.filing.filingDate);
  };
}

export interface DurationSeriesOptions {
  /** Apply the nil rule (cash-flow rows only). */
  cashFlow?: boolean;
}

export function resolveDurationSeries(
  facts: CompanyFacts,
  conceptNames: readonly string[],
  displayPeriods: FilingPeriod[],
  allPeriods: FilingPeriod[],
  options: DurationSeriesOptions = {}
): LineItem {
  const nil = options.cashFlow ? nilRule(facts, conceptNames, allPeriods) : undefined;
  return resolveSeries(
    facts,
    conceptNames,
    displayPeriods,
    (points, period, concept) =>
      resolveDuration(points, period, allPeriods, nil ? { nilPrior: nil(concept) } : {}),
    durationKey
  );
}

/**
 * The same one-tag-per-row resolution over fiscal years instead of
 * quarters: each 10-K's full-year figure (duration) or year-end balance
 * (instant), as filed. `preferred` puts a tag first so an annual row reads
 * the tag its quarterly row settled on, whenever that tag covers as much.
 */
export function resolveAnnualSeries(
  facts: CompanyFacts,
  conceptNames: readonly string[],
  fyPeriods: FilingPeriod[],
  kind: "duration" | "instant",
  preferred?: string
): LineItem {
  const names = preferred && conceptNames.includes(preferred)
    ? [preferred, ...conceptNames.filter((n) => n !== preferred)]
    : conceptNames;
  return resolveSeries(
    facts,
    names,
    fyPeriods,
    (points, period) => {
      if (kind === "instant") return resolveInstant(points, period);
      const r = resolveCumulativeToDate(points, period);
      return r ? { value: r.value, method: "direct" as const } : undefined;
    },
    kind === "instant" ? instantKey : durationKey
  );
}

export function resolveInstantSeries(
  facts: CompanyFacts,
  conceptNames: readonly string[],
  displayPeriods: FilingPeriod[]
): LineItem {
  return resolveSeries(facts, conceptNames, displayPeriods, resolveInstant, instantKey);
}

/**
 * A composite/computed line item is a whole-row alternative to its primary
 * tag -- the two are never mixed cell by cell within one row. The choice
 * between them is whole-row coverage, not just "primary is nonempty": a
 * filer can tag a combined concept (e.g. a total "LongTermDebt") in only
 * some filings while consistently tagging its components (Noncurrent +
 * Current) in every filing -- WMT does exactly this, tagging "LongTermDebt"
 * in its 10-K only, so the primary has 1/5 coverage while the sum of parts
 * has 5/5. Picking "primary has any data" in that case would leave 4
 * quarters MISSING despite a fully-covering, whole-row-consistent
 * alternative being available. So: use whichever of the two covers more of
 * the display window; ties keep the primary (matches prior behavior when
 * both are fully covered, or both are empty).
 *
 * Better coverage alone is not enough, though. Wider coverage says nothing
 * about the two sources MEANING the same thing, and a formula that
 * disagrees with the tag it is replacing is measuring something else --
 * One filer's "LongTermDebt" runs $8-11M above its own Noncurrent+Current sum
 * in every quarter it tags both, so the sum is not a wider-coverage
 * substitute for that tag, it is a different figure. So the switch carries
 * the same burden of proof as a spliced cell: in EVERY quarter where both
 * the primary tag and the formula produce a value, they must agree within
 * $1M (agreeWithinTolerance, the same tolerance splicing uses). One
 * disagreement anywhere and the row stays on the primary tag, with the
 * quarters the primary doesn't cover left MISSING -- missing stays missing,
 * and a wrong number is worse than a gap.
 *
 * Note the quantifier differs from tagsAgree's, deliberately. Splicing asks
 * for ANY corroborating period, because it is trying to establish that two
 * same-sounding tags are the same concept at all. This gate asks for EVERY
 * shared period, because the row is about to discard a source that is
 * already known to be the right concept: a single mismatch is proof the
 * replacement is not interchangeable with it. (tagsAgree itself is not
 * reusable here -- it compares raw FactPoints, and a formula has no fact
 * points of its own, only computed cells aligned to the display window.)
 */
export function wholeRowFallback(
  primary: LineItem,
  computeCell: (i: number) => CellValue | undefined,
  n: number
): LineItem {
  const primaryCoverage = primary.values.filter((v) => v !== undefined).length;
  const fallbackValues = Array.from({ length: n }, (_, i) => computeCell(i));
  const fallbackCoverage = fallbackValues.filter((v) => v !== undefined).length;
  if (fallbackCoverage <= primaryCoverage) return primary;

  for (let i = 0; i < n; i++) {
    const p = primary.values[i];
    const f = fallbackValues[i];
    // No shared period here: nothing to corroborate, nothing to contradict.
    if (!p || !f) continue;
    if (!agreeWithinTolerance(p.value, f.value)) return primary;
  }
  return { values: fallbackValues };
}

function combineSga(
  facts: CompanyFacts,
  displayPeriods: FilingPeriod[],
  publishedPeriods: FilingPeriod[]
): LineItem {
  const combined = resolveDurationSeries(
    facts,
    DURATION_CONCEPTS.sgaCombined,
    displayPeriods,
    publishedPeriods
  );
  const ga = resolveDurationSeries(
    facts,
    DURATION_CONCEPTS.sgaGeneralAndAdministrative,
    displayPeriods,
    publishedPeriods
  );
  const sm = resolveDurationSeries(
    facts,
    DURATION_CONCEPTS.sgaSellingAndMarketing,
    displayPeriods,
    publishedPeriods
  );
  return wholeRowFallback(
    combined,
    (i) => {
      const g = ga.values[i];
      const s = sm.values[i];
      return g && s ? cell(g.value + s.value, `${g.concept}+${s.concept}`, "computed-sum") : undefined;
    },
    displayPeriods.length
  );
}

function fallbackGrossProfit(direct: LineItem, revenue: LineItem, costOfRevenue: LineItem): LineItem {
  return wholeRowFallback(
    direct,
    (i) => {
      const r = revenue.values[i];
      const c = costOfRevenue.values[i];
      return r && c ? cell(r.value - c.value, `${r.concept}-${c.concept}`, "computed-difference") : undefined;
    },
    revenue.values.length
  );
}

/**
 * Some filers (e.g. Walmart) never tag a plain "Liabilities" total,
 * relying on the balance-sheet identity instead. Fall back to
 * Assets - Equity (total equity, including NCI) when that's the case.
 */
function fallbackTotalLiabilities(direct: LineItem, totalAssets: LineItem, equity: LineItem): LineItem {
  return wholeRowFallback(
    direct,
    (i) => {
      const a = totalAssets.values[i];
      const e = equity.values[i];
      return a && e ? cell(a.value - e.value, `${a.concept}-${e.concept}`, "computed-difference") : undefined;
    },
    totalAssets.values.length
  );
}

function freeCashFlow(ocf: LineItem, capex: LineItem): LineItem {
  const values = ocf.values.map((v, i) => {
    const c = capex.values[i];
    if (v && c) return cell(v.value - c.value, `${v.concept}-${c.concept}`, "computed-difference");
    return undefined;
  });
  return { values };
}

function combineLongTermDebt(facts: CompanyFacts, displayPeriods: FilingPeriod[]): LineItem {
  const total = resolveInstantSeries(facts, INSTANT_CONCEPTS.longTermDebtTotal, displayPeriods);
  const noncurrent = resolveInstantSeries(
    facts,
    INSTANT_CONCEPTS.longTermDebtNoncurrent,
    displayPeriods
  );
  const current = resolveInstantSeries(facts, INSTANT_CONCEPTS.longTermDebtCurrent, displayPeriods);
  return wholeRowFallback(
    total,
    (i) => {
      const nc = noncurrent.values[i];
      const c = current.values[i];
      if (nc && c) return cell(nc.value + c.value, `${nc.concept}+${c.concept}`, "computed-sum");
      if (nc) return nc; // some filers carry no current portion
      return undefined;
    },
    displayPeriods.length
  );
}

/**
 * Whether any of the debt row's tags carries a balance-sheet instant dated
 * inside the lookback window. Zoom is the case this exists for: it last
 * tagged LongTermDebtNoncurrent in 2016, a decade before the window, so
 * the row is empty because there is no debt, not because a filing is
 * unreadable.
 */
function debtTagFiledInLookback(facts: CompanyFacts, periods: FilingPeriod[]): boolean {
  if (periods.length === 0) return false;
  const oldestEnd = periods.reduce(
    (oldest, p) => (p.filing.reportDate < oldest ? p.filing.reportDate : oldest),
    periods[0].filing.reportDate
  );
  const concepts = [
    ...INSTANT_CONCEPTS.longTermDebtTotal,
    ...INSTANT_CONCEPTS.longTermDebtNoncurrent,
    ...INSTANT_CONCEPTS.longTermDebtCurrent,
  ];
  return concepts.some((name) =>
    (getConceptPoints(facts, name) ?? []).some((point) => point.end >= oldestEnd)
  );
}

/**
 * Has company facts published anything for this period yet?
 *
 * A filing appears in the submissions feed the day it is filed; its facts
 * reach the company-facts aggregate later. Between the two, every figure
 * for the period is absent -- not missing in the "the company didn't tag
 * it" sense, but not yet published.
 */
function periodHasPublishedFacts(facts: CompanyFacts, period: FilingPeriod): boolean {
  for (const conceptName of ANCHOR_CONCEPTS) {
    const points = getConceptPoints(facts, conceptName);
    if (points?.some((p) => p.end === period.filing.reportDate)) return true;
  }
  return false;
}

export function buildKeyFinancials(
  facts: CompanyFacts,
  periodicFilings: FilingEntry[],
  fiscalYearEnd?: string | null
): KeyFinancials {
  const fiscalCalendar = buildFiscalCalendar(facts, periodicFilings, fiscalYearEnd);
  const lookback = periodicFilings.slice(0, LOOKBACK_COUNT);
  const allPeriods = buildFilingPeriods(fiscalCalendar, lookback);
  const publishedPeriods = allPeriods.filter((p) => periodHasPublishedFacts(facts, p));
  const displayPeriods = publishedPeriods.slice(0, 5);

  const quarters: QuarterColumn[] = displayPeriods.map((p) => ({
    label: p.label,
    periodEnd: p.filing.reportDate,
    form: p.filing.form,
    accessionNumber: p.filing.accessionNumber,
    filingDate: p.filing.filingDate,
  }));

  // Every "find the sibling quarter" lookup (YTD subtraction, annual minus
  // Q1-Q3) searches the published periods: an unaggregated filing has no
  // figures to subtract, and matching it would turn a derivable quarter
  // into a missing one.
  const revenue = resolveDurationSeries(facts, DURATION_CONCEPTS.revenue, displayPeriods, publishedPeriods);
  const costOfRevenue = resolveDurationSeries(
    facts,
    DURATION_CONCEPTS.costOfRevenue,
    displayPeriods,
    publishedPeriods
  );
  const grossProfitDirect = resolveDurationSeries(
    facts,
    DURATION_CONCEPTS.grossProfit,
    displayPeriods,
    publishedPeriods
  );
  const grossProfit = fallbackGrossProfit(grossProfitDirect, revenue, costOfRevenue);
  const researchAndDevelopment = resolveDurationSeries(
    facts,
    DURATION_CONCEPTS.researchAndDevelopment,
    displayPeriods,
    publishedPeriods
  );
  const sga = combineSga(facts, displayPeriods, publishedPeriods);
  const operatingIncome = resolveDurationSeries(
    facts,
    DURATION_CONCEPTS.operatingIncome,
    displayPeriods,
    publishedPeriods
  );
  const netIncome = resolveDurationSeries(
    facts,
    DURATION_CONCEPTS.netIncome,
    displayPeriods,
    publishedPeriods
  );
  const pretaxIncome = resolveDurationSeries(
    facts,
    DURATION_CONCEPTS.pretaxIncome,
    displayPeriods,
    publishedPeriods
  );
  const incomeTaxExpense = resolveDurationSeries(
    facts,
    DURATION_CONCEPTS.incomeTaxExpense,
    displayPeriods,
    publishedPeriods
  );
  const operatingCashFlow = resolveDurationSeries(
    facts,
    DURATION_CONCEPTS.operatingCashFlow,
    displayPeriods,
    publishedPeriods,
    { cashFlow: true }
  );
  const capitalExpenditures = resolveDurationSeries(
    facts,
    DURATION_CONCEPTS.capitalExpenditures,
    displayPeriods,
    publishedPeriods,
    { cashFlow: true }
  );
  const capFreeCashFlow = freeCashFlow(operatingCashFlow, capitalExpenditures);

  const cash = resolveInstantSeries(facts, INSTANT_CONCEPTS.cash, displayPeriods);
  const shortTermInvestments = resolveInstantSeries(facts, INSTANT_CONCEPTS.shortTermInvestments, displayPeriods);
  const shortTermInvestmentsFiledEver = INSTANT_CONCEPTS.shortTermInvestments.some(
    (name) => getConceptPoints(facts, name) !== undefined
  );
  const accountsReceivable = resolveInstantSeries(
    facts,
    INSTANT_CONCEPTS.accountsReceivable,
    displayPeriods
  );
  const accountsPayable = resolveInstantSeries(
    facts,
    INSTANT_CONCEPTS.accountsPayable,
    displayPeriods
  );
  const currentAssets = resolveInstantSeries(facts, INSTANT_CONCEPTS.currentAssets, displayPeriods);
  const currentLiabilities = resolveInstantSeries(
    facts,
    INSTANT_CONCEPTS.currentLiabilities,
    displayPeriods
  );
  const totalAssets = resolveInstantSeries(facts, INSTANT_CONCEPTS.totalAssets, displayPeriods);
  const totalLiabilitiesDirect = resolveInstantSeries(
    facts,
    INSTANT_CONCEPTS.totalLiabilities,
    displayPeriods
  );
  const equity = resolveInstantSeries(facts, INSTANT_CONCEPTS.equity, displayPeriods);
  const totalLiabilities = fallbackTotalLiabilities(totalLiabilitiesDirect, totalAssets, equity);
  const retainedEarnings = resolveInstantSeries(
    facts,
    INSTANT_CONCEPTS.retainedEarnings,
    displayPeriods
  );
  const longTermDebt = combineLongTermDebt(facts, displayPeriods);

  return {
    quarters,
    lookbackPeriods: allPeriods,
    publishedPeriods,
    fiscalCalendar,
    revenue,
    costOfRevenue,
    grossProfit,
    researchAndDevelopment,
    sga,
    operatingIncome,
    netIncome,
    pretaxIncome,
    incomeTaxExpense,
    operatingCashFlow,
    capitalExpenditures,
    freeCashFlow: capFreeCashFlow,
    cash,
    shortTermInvestments,
    shortTermInvestmentsFiledEver,
    accountsReceivable,
    accountsPayable,
    currentAssets,
    currentLiabilities,
    totalAssets,
    totalLiabilities,
    equity,
    retainedEarnings,
    longTermDebt,
    debtTagFiledInLookback: debtTagFiledInLookback(facts, allPeriods),
  };
}
