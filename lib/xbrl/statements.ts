import { CompanyFacts, getConceptPoints } from "@/lib/edgar/companyFacts";
import { FilingEntry } from "@/lib/edgar/submissions";
import {
  CellValue,
  KeyFinancials,
  LineItem,
  resolveAnnualSeries,
  resolveDurationSeries,
  resolveInstantSeries,
  wholeRowFallback,
  cell,
} from "@/lib/xbrl/keyFinancials";
import { buildFilingPeriods, DURATION_WINDOWS, FilingPeriod, FiscalPeriodLabel, ResolutionMethod } from "@/lib/xbrl/periods";
import { DURATION_CONCEPTS, INSTANT_CONCEPTS } from "@/lib/xbrl/concepts";
import { ExtractedFact, FilingStatementExtract } from "@/lib/xbrl/statementExtract";

/**
 * The three statements behind the Income statement, Balance sheet and Cash
 * flow tabs: five quarters and three fiscal years, every cell carrying its
 * own provenance, nothing plugged.
 *
 * The income statement's lines between revenue and operating income are
 * the company's own, read from each filing (see statementExtract.ts): its
 * captions, its order, its signs, and lines on its own tags that company
 * facts never carries. Everything else -- the standard rows around those
 * lines, the balance sheet, the cash flow -- comes from company facts with
 * the app's own resolution rules, the same rules Key financials uses.
 */

export const TOLERANCE_USD = 1_000_000;

export type StatementMethod = ResolutionMethod;

export interface StatementValue {
  value: number;
  /** The tag or element (QName for a filing line), or a composite label ("A+B", "A-B"). */
  concept: string;
  method: StatementMethod;
  derived: boolean;
  /** "filing": read from the filing's own instance; "company-facts": from EDGAR's company facts. */
  source: "filing" | "company-facts";
  /** Filed under the company's own tag, read from the filing. */
  companyTag?: boolean;
  /** Nil rule: prior periods not in the filed statement, read as nil. */
  nilPeriods?: string[];
  /** "spliced-ytd": the second tag. */
  splicedWith?: string;
  /** A filing line whose element changed: the older element this value was read under. */
  joinedFrom?: string;
  /** Computed rows: what went into the figure. */
  components?: string[];
  /**
   * An income statement standard row read from the column's presentation
   * (the latest-filed statement that presents the period) where that
   * differs from Key financials: the filing that recast it, the figure Key
   * financials shows, and the filing that figure comes from (the period's
   * own filing).
   */
  recast?: {
    form: string;
    filingDate: string;
    accessionNumber: string;
    original: number;
    originalForm: string;
    originalFilingDate: string;
  };
}

export interface MissingValue {
  missing: string;
}

export type StatementCell = StatementValue | MissingValue;

export const MISSING_NOT_FILED_FOR_PERIOD = "not filed for this period";
export const MISSING_COMPANY_TAG = "filed under the company's own tag";
export const MISSING_DEPENDS = "depends on a missing figure";

export function isValue(c: StatementCell | undefined): c is StatementValue {
  return c !== undefined && "value" in c;
}

export type RowKind = "total" | "line" | "of" | "section";

export interface StatementRow {
  key: string;
  label: string;
  kind: RowKind;
  /** The row's primary tag or element. */
  concept?: string;
  companyTag?: boolean;
  /** Income statement company lines: +1 adds to operating income, -1 subtracts. */
  sign?: 1 | -1;
  signSource?: "calc" | "default";
  quarterly: StatementCell[];
  annual: StatementCell[];
  /** No candidate tag was ever filed: the row reads "Not filed". */
  notFiled?: boolean;
  /** Derived row that is zero in every column (after-tax items): hidden. */
  hidden?: boolean;
  /** Financing debt lines. */
  debtKind?: "proceeds" | "repayment" | "net";
  /** A debt tag equal to the sum of the filer's other debt tags: a total, left out of net new debt. */
  debtTotal?: boolean;
  /** Buybacks and dividends: whether any candidate tag was ever filed, in any period. */
  filedEver?: boolean;
}

export interface StatementColumn {
  label: string;
  periodEnd: string;
  accessionNumber: string;
  form: string;
}

export interface ElementJoin {
  from: string;
  to: string;
  joined: boolean;
  /** The most recent period both elements report, and their values there. */
  period?: string;
  fromValue?: number;
  toValue?: number;
  reason: string;
}

export interface Statements {
  quarters: StatementColumn[];
  years: StatementColumn[];
  income: StatementRow[];
  balance: StatementRow[];
  cashFlow: StatementRow[];
  /** Element switches in the income statement's company lines, joined or not. */
  joins: ElementJoin[];
  /** The acquisitions line's caption, from the latest filing that has one. */
  acquisitionsCaption?: string;
}

// --- candidate tags for the new rows ---------------------------------------
// From the fixture coverage work; the ones added since are marked.

export const STATEMENT_CONCEPTS = {
  nonoperatingTotal: ["NonoperatingIncomeExpense"],
  interestExpense: ["InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt", "InterestAndDebtExpense"],
  otherNonoperating: ["OtherNonoperatingIncomeExpense", "OtherNonoperatingIncome"],
  inventory: ["InventoryNet", "InventoryFinishedGoodsNetOfReserves"],
  ppe: [
    "PropertyPlantAndEquipmentNet",
    "PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization",
  ],
  goodwill: ["Goodwill"],
  intangiblesTotal: ["IntangibleAssetsNetExcludingGoodwill"],
  intangiblesFinite: ["FiniteLivedIntangibleAssetsNet"],
  intangiblesIndefinite: ["IndefiniteLivedIntangibleAssetsExcludingGoodwill"],
  shortTermBorrowings: ["ShortTermBorrowings", "CommercialPaper", "OtherShortTermBorrowings"],
  operatingLeaseTotal: ["OperatingLeaseLiability"],
  operatingLeaseNoncurrent: ["OperatingLeaseLiabilityNoncurrent"],
  operatingLeaseCurrent: ["OperatingLeaseLiabilityCurrent"],
  shareBasedCompensation: ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"],
  acquisitions: [
    "PaymentsToAcquireBusinessesNetOfCashAcquired",
    "PaymentsToAcquireBusinessesGross",
    "PaymentsToAcquireBusinessesAndInterestInAffiliates",
  ],
  investmentPurchases: [
    "PaymentsToAcquireInvestments",
    "PaymentsToAcquireMarketableSecurities",
    "PaymentsToAcquireAvailableForSaleSecuritiesDebt",
    "PaymentsToAcquireShortTermInvestments",
    "PaymentsToAcquireAvailableForSaleSecurities",
  ],
  investmentSales: [
    "ProceedsFromSaleMaturityAndCollectionsOfInvestments",
    "ProceedsFromSaleAndMaturityOfMarketableSecurities",
    "ProceedsFromMaturitiesPrepaymentsAndCallsOfAvailableForSaleSecurities",
    "ProceedsFromSaleAndMaturityOfAvailableForSaleSecurities",
    "ProceedsFromSaleOfAvailableForSaleSecuritiesDebt",
    "ProceedsFromMaturitiesPrepaymentsAndCallsOfShorttermInvestments",
    "ProceedsFromSaleOfShortTermInvestments",
  ],
  buybacks: ["PaymentsForRepurchaseOfCommonStock", "PaymentsForRepurchaseOfEquity"],
  dividends: ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock", "PaymentsOfOrdinaryDividends"],
} as const;

/**
 * Every debt proceeds and repayment tag a filer might use, each its own
 * row when used. Long-term, short-term, commercial paper, revolver or line
 * of credit, net short-term and convertible. The short-term and
 * commercial-paper gross tags, the line-of-credit net tag, the bank,
 * notes-payable and unsecured tags and the three-months-or-less gross tags
 * are new since the coverage work.
 */
export const DEBT_FLOW_TAGS: { tag: string; kind: "proceeds" | "repayment" | "net"; label: string }[] = [
  { tag: "ProceedsFromIssuanceOfLongTermDebt", kind: "proceeds", label: "Long-term debt raised" },
  { tag: "ProceedsFromIssuanceOfSeniorLongTermDebt", kind: "proceeds", label: "Senior notes raised" },
  { tag: "ProceedsFromIssuanceOfDebt", kind: "proceeds", label: "Debt raised" },
  { tag: "ProceedsFromDebtNetOfIssuanceCosts", kind: "proceeds", label: "Debt raised, net of issuance costs" },
  { tag: "ProceedsFromDebtMaturingInMoreThanThreeMonths", kind: "proceeds", label: "Debt raised, maturing after three months" },
  { tag: "ProceedsFromShortTermDebt", kind: "proceeds", label: "Short-term debt raised" },
  { tag: "ProceedsFromCommercialPaper", kind: "proceeds", label: "Commercial paper raised" },
  { tag: "ProceedsFromLinesOfCredit", kind: "proceeds", label: "Line of credit drawn" },
  { tag: "ProceedsFromConvertibleDebt", kind: "proceeds", label: "Convertible debt raised" },
  { tag: "ProceedsFromBankDebt", kind: "proceeds", label: "Bank debt raised" },
  { tag: "ProceedsFromNotesPayable", kind: "proceeds", label: "Notes payable raised" },
  { tag: "ProceedsFromIssuanceOfUnsecuredDebt", kind: "proceeds", label: "Unsecured debt raised" },
  { tag: "ProceedsFromShortTermDebtMaturingInThreeMonthsOrLess", kind: "proceeds", label: "Short-term debt maturing within three months raised" },
  { tag: "RepaymentsOfLongTermDebt", kind: "repayment", label: "Long-term debt repaid" },
  { tag: "RepaymentsOfSeniorDebt", kind: "repayment", label: "Senior notes repaid" },
  { tag: "RepaymentsOfDebt", kind: "repayment", label: "Debt repaid" },
  { tag: "RepaymentsOfDebtMaturingInMoreThanThreeMonths", kind: "repayment", label: "Debt repaid, maturing after three months" },
  { tag: "RepaymentsOfLongTermDebtAndCapitalSecurities", kind: "repayment", label: "Long-term debt and capital securities repaid" },
  { tag: "RepaymentsOfShortTermDebt", kind: "repayment", label: "Short-term debt repaid" },
  { tag: "RepaymentsOfCommercialPaper", kind: "repayment", label: "Commercial paper repaid" },
  { tag: "RepaymentsOfLinesOfCredit", kind: "repayment", label: "Line of credit repaid" },
  { tag: "RepaymentsOfConvertibleDebt", kind: "repayment", label: "Convertible debt repaid" },
  { tag: "RepaymentsOfBankDebt", kind: "repayment", label: "Bank debt repaid" },
  { tag: "RepaymentsOfNotesPayable", kind: "repayment", label: "Notes payable repaid" },
  { tag: "RepaymentsOfDebtAndCapitalLeaseObligations", kind: "repayment", label: "Debt and finance leases repaid" },
  { tag: "RepaymentsOfShortTermDebtMaturingInThreeMonthsOrLess", kind: "repayment", label: "Short-term debt maturing within three months repaid" },
  { tag: "ProceedsFromRepaymentsOfShortTermDebt", kind: "net", label: "Short-term debt, net" },
  { tag: "ProceedsFromRepaymentsOfShortTermDebtMaturingInThreeMonthsOrLess", kind: "net", label: "Short-term debt maturing within three months, net" },
  { tag: "ProceedsFromRepaymentsOfCommercialPaper", kind: "net", label: "Commercial paper, net" },
  { tag: "ProceedsFromRepaymentsOfLinesOfCredit", kind: "net", label: "Line of credit, net" },
];

// --- small helpers ------------------------------------------------------------

function fromCompanyFacts(v: CellValue | undefined, reason?: string): StatementCell {
  if (!v) return { missing: reason ?? MISSING_NOT_FILED_FOR_PERIOD };
  const out: StatementValue = {
    value: v.value,
    concept: v.concept,
    method: v.method,
    derived: v.derived,
    source: "company-facts",
  };
  if (v.nilPeriods) out.nilPeriods = v.nilPeriods;
  if (v.splicedWith) out.splicedWith = v.splicedWith;
  return out;
}

function everFiled(facts: CompanyFacts, names: readonly string[]): boolean {
  return names.some((n) => getConceptPoints(facts, n) !== undefined);
}

function firstConcept(item: LineItem): string | undefined {
  return item.values.find((v) => v)?.concept;
}

function row(
  key: string,
  label: string,
  kind: RowKind,
  quarterly: LineItem,
  annual: LineItem,
  extra: Partial<StatementRow> = {}
): StatementRow {
  return {
    key,
    label,
    kind,
    concept: firstConcept(quarterly) ?? firstConcept(annual),
    quarterly: quarterly.values.map((v, i) => fromCompanyFacts(v, quarterly.missingReasons?.[i])),
    annual: annual.values.map((v, i) => fromCompanyFacts(v, annual.missingReasons?.[i])),
    ...extra,
  };
}

// --- the income statement's company lines ------------------------------------

interface PooledFact extends ExtractedFact {
  element: string;
  accessionNumber: string;
  filingDate: string;
  /** The element is a line on this filing's own income statement (not only in a note). */
  onStatement: boolean;
}

function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000);
}

function inWindow(f: ExtractedFact, fp: FiscalPeriodLabel): boolean {
  const [min, max] = DURATION_WINDOWS[fp];
  const d = daysBetween(f.start, f.end);
  return d >= min && d <= max;
}

class FactPool {
  private byElement = new Map<string, PooledFact[]>();

  constructor(extracts: FilingStatementExtract[]) {
    for (const x of extracts) {
      const lines = new Set(x.incomeStatement?.lines.map((l) => l.element));
      for (const [element, facts] of Object.entries(x.facts)) {
        const list = this.byElement.get(element) ?? [];
        const onStatement = lines.has(element);
        for (const f of facts) {
          list.push({ ...f, element, accessionNumber: x.accessionNumber, filingDate: x.filingDate, onStatement });
        }
        this.byElement.set(element, list);
      }
    }
  }

  facts(element: string): PooledFact[] {
    return this.byElement.get(element) ?? [];
  }

  /**
   * The figure a line shows for a period: from a filing whose income
   * statement presents the line, and of those, the latest-filed one.
   *
   * On the statement, because a figure a filing reports only in a note is
   * not a line of that filing's statement -- a 10-Q that folds legal fees
   * into SG&A still tags them in a note, and showing both would count them
   * twice. The latest-filed, because a column has to come from one
   * presentation: when a company moves a cost from one line to another
   * and restates its comparatives, taking one line as originally filed and
   * the next as restated counts the moved cost twice (FedEx's separation
   * costs, moved out of "Other" in its FY26 10-K). The latest presentation
   * of every period in the window is the one the statement's own lines and
   * captions come from. Across a joined row's elements, the latest-filed
   * figure wins; on a tie, the row's own element.
   */
  /** The latest-filed fact on any filing's income statement that matches: the presentation of a period. */
  latestOnStatement(match: (f: PooledFact) => boolean): PooledFact | undefined {
    let best: PooledFact | undefined;
    for (const list of this.byElement.values()) {
      for (const f of list) {
        if (!f.onStatement || !match(f)) continue;
        if (!best || f.filingDate > best.filingDate) best = f;
      }
    }
    return best;
  }

  pick(elements: string[], match: (f: PooledFact) => boolean): PooledFact | undefined {
    let best: PooledFact | undefined;
    for (const element of elements) {
      for (const f of this.facts(element)) {
        if (!f.onStatement || !match(f)) continue;
        if (!best || f.filingDate > best.filingDate) best = f;
      }
    }
    return best;
  }
}

interface CompanyLine {
  elements: string[];
  caption: string;
  sign: 1 | -1;
  signSource: "calc" | "default";
  costOfRevenue: boolean;
}

function valueFrom(
  fact: PooledFact,
  line: CompanyLine,
  method: ResolutionMethod,
  value = fact.value,
  derived = false
): StatementValue {
  const out: StatementValue = {
    value,
    concept: line.elements[0],
    method,
    derived,
    source: "filing",
  };
  if (!line.elements[0].startsWith("us-gaap:")) out.companyTag = true;
  if (fact.element !== line.elements[0]) out.joinedFrom = fact.element;
  return out;
}

function quarterCell(pool: FactPool, line: CompanyLine, period: FilingPeriod, all: FilingPeriod[]): StatementCell {
  const end = period.filing.reportDate;
  if (period.fp === "FY") {
    // Q4 = the 10-K's annual figure − Q1 to Q3 (the nine-month figure with
    // the same fiscal-year start), same element.
    const annual = pool.pick(line.elements, (f) => f.end === end && inWindow(f, "FY"));
    if (!annual) return { missing: MISSING_NOT_FILED_FOR_PERIOD };
    const nine = pool.pick([annual.element, ...line.elements], (f) => f.start === annual.start && inWindow(f, "Q3"));
    if (!nine) return { missing: MISSING_NOT_FILED_FOR_PERIOD };
    return valueFrom(annual, line, "annual-minus-9mo", annual.value - nine.value, true);
  }
  const direct = pool.pick(line.elements, (f) => f.end === end && inWindow(f, "Q1"));
  if (direct) return valueFrom(direct, line, "direct");
  if (period.fp === "Q1") return { missing: MISSING_NOT_FILED_FOR_PERIOD };
  const priorFp: FiscalPeriodLabel = period.fp === "Q2" ? "Q1" : "Q2";
  const ytd = pool.pick(line.elements, (f) => f.end === end && inWindow(f, period.fp));
  const prior = all.find((p) => p.fy === period.fy && p.fp === priorFp);
  if (!ytd || !prior) return { missing: MISSING_NOT_FILED_FOR_PERIOD };
  const priorYtd = pool.pick(
    [ytd.element, ...line.elements],
    (f) => f.start === ytd.start && f.end === prior.filing.reportDate && inWindow(f, priorFp)
  );
  if (!priorYtd) return { missing: MISSING_NOT_FILED_FOR_PERIOD };
  return valueFrom(ytd, line, "ytd-subtraction", ytd.value - priorYtd.value, true);
}

function annualCell(pool: FactPool, line: CompanyLine, period: FilingPeriod): StatementCell {
  const fact = pool.pick(
    line.elements,
    (f) => f.end === period.filing.reportDate && inWindow(f, "FY"),
  );
  return fact ? valueFrom(fact, line, "direct") : { missing: MISSING_NOT_FILED_FOR_PERIOD };
}

/** The most recent period (start|end) both elements report, with each one's latest-filed value there. */
function mostRecentShared(pool: FactPool, a: string, b: string): { period: string; a: number; b: number } | undefined {
  const latest = (element: string) => {
    const out = new Map<string, PooledFact>();
    for (const f of pool.facts(element)) {
      const k = `${f.start}|${f.end}`;
      const prev = out.get(k);
      if (!prev || f.filingDate > prev.filingDate) out.set(k, f);
    }
    return out;
  };
  const fa = latest(a);
  const fb = latest(b);
  let best: { period: string; a: PooledFact; b: PooledFact } | undefined;
  for (const [k, x] of fa) {
    const y = fb.get(k);
    if (!y) continue;
    if (!best || x.end > best.a.end || (x.end === best.a.end && x.start > best.a.start)) best = { period: k, a: x, b: y };
  }
  return best ? { period: best.period, a: best.a.value, b: best.b.value } : undefined;
}

/**
 * The company's lines, in the latest filing's order and captions, with
 * history matched by element across filings. An element that appears only
 * in older filings joins a current line only when the two report the same
 * value (within $1M) in the most recent period they share, and only when
 * the current element is absent from that older filing -- that is the
 * shape of a renamed tag. Two elements that were both zero there are not
 * joined: a shared zero says nothing about being the same line. Otherwise it is a line of its own, placed after
 * the line it followed in its own filing.
 */
function companyLines(extracts: FilingStatementExtract[], pool: FactPool, joins: ElementJoin[]): CompanyLine[] {
  const withStatement = extracts.filter((x) => x.incomeStatement);
  if (!withStatement.length) return [];
  const latest = withStatement[0];
  const lines: CompanyLine[] = latest.incomeStatement!.lines.map((l) => ({
    elements: [l.element],
    caption: l.caption,
    sign: l.sign,
    signSource: l.signSource,
    costOfRevenue: l.costOfRevenue,
  }));
  const latestElements = new Set(latest.incomeStatement!.lines.map((l) => l.element));

  for (const x of withStatement.slice(1)) {
    const own = x.incomeStatement!.lines;
    const ownElements = new Set(own.map((l) => l.element));
    own.forEach((l, i) => {
      if (lines.some((line) => line.elements.includes(l.element))) return;
      let joined = false;
      if (!latestElements.has(l.element)) {
        for (const line of lines) {
          const current = line.elements[0];
          if (ownElements.has(current)) continue; // both on one statement: two lines, not a rename
          const shared = mostRecentShared(pool, l.element, current);
          const record: ElementJoin = { from: l.element, to: current, joined: false, reason: "" };
          if (!shared) continue;
          record.period = shared.period;
          record.fromValue = shared.a;
          record.toValue = shared.b;
          // Two lines that were both zero prove nothing about being one
          // line: the most recent shared period has to carry a figure.
          if (shared.a === 0 && shared.b === 0) {
            record.reason = "both zero in the most recent period both report, which proves nothing";
            if (!joins.some((j) => j.from === record.from && j.to === record.to)) joins.push(record);
            continue;
          }
          if (Math.abs(shared.a - shared.b) <= TOLERANCE_USD) {
            line.elements.push(l.element);
            record.joined = true;
            record.reason = "same value within $1M in the most recent period both report";
            joins.push(record);
            joined = true;
            break;
          }
          record.reason = "different values in the most recent period both report";
          if (!joins.some((j) => j.from === record.from && j.to === record.to)) joins.push(record);
        }
      }
      if (joined) return;
      if (!joins.some((j) => j.from === l.element)) {
        joins.push({ from: l.element, to: "", joined: false, reason: "no current line reports a shared period with it" });
      }
      // Its own line, after the line it followed in its own filing.
      let at = 0;
      for (let k = i - 1; k >= 0; k--) {
        const idx = lines.findIndex((line) => line.elements.includes(own[k].element));
        if (idx >= 0) {
          at = idx + 1;
          break;
        }
      }
      lines.splice(at, 0, {
        elements: [l.element],
        caption: l.caption,
        sign: l.sign,
        signSource: l.signSource,
        costOfRevenue: l.costOfRevenue,
      });
    });
  }
  return lines;
}

// --- one presentation per income statement column ---------------------------------

interface Source {
  accessionNumber: string;
  form: string;
  filingDate: string;
}

type ColumnSource =
  | { kind: "single"; window: FiscalPeriodLabel; end: string; source: Source }
  | { kind: "q4"; end: string; annual: Source; annualStart: string; nine: Source; ownAnnual: string }
  | undefined;

/**
 * For each column, the latest-filed statement that presents its period --
 * the presentation the company lines already come from. A derived Q4 has
 * two: the latest 10-K presenting the year and the latest filing
 * presenting the nine months before it.
 */
function presentationSources(
  pool: FactPool,
  quarters: FilingPeriod[],
  years: FilingPeriod[],
  extracts: FilingStatementExtract[]
): { quarterly: ColumnSource[]; annual: ColumnSource[] } {
  const meta = new Map(extracts.map((x) => [x.accessionNumber, x]));
  const source = (f: PooledFact | undefined): Source | undefined => {
    if (!f) return undefined;
    const x = meta.get(f.accessionNumber);
    return x ? { accessionNumber: x.accessionNumber, form: x.form, filingDate: x.filingDate } : undefined;
  };
  const latest = (match: (f: PooledFact) => boolean) => pool.latestOnStatement(match);
  const single = (end: string, window: FiscalPeriodLabel): ColumnSource => {
    const s = source(latest((f) => f.end === end && inWindow(f, window)));
    return s ? { kind: "single", window, end, source: s } : undefined;
  };
  return {
    quarterly: quarters.map((p) => {
      const end = p.filing.reportDate;
      if (p.fp !== "FY") return single(end, "Q1");
      const annualFact = latest((f) => f.end === end && inWindow(f, "FY"));
      const annual = source(annualFact);
      if (!annualFact || !annual) return undefined;
      const nine = source(latest((f) => f.start === annualFact.start && inWindow(f, "Q3")));
      return nine
        ? { kind: "q4", end, annual, annualStart: annualFact.start, nine, ownAnnual: p.filing.accessionNumber }
        : undefined;
    }),
    annual: years.map((p) => single(p.filing.reportDate, "FY")),
  };
}

function daysOf(p: { start?: string; end: string }): number {
  return p.start ? daysBetween(p.start, p.end) : 0;
}

/**
 * A company-facts figure for a concept (or an "A-B"/"A+B" composite)
 * exactly as one filing reports it -- or, with accession "original", as
 * first filed.
 */
function valueIn(
  facts: CompanyFacts,
  concept: string,
  accession: string | "original",
  match: (p: { start?: string; end: string }) => boolean
): number | undefined {
  const plus = concept.split("+");
  if (plus.length === 2) {
    const [a, b] = plus.map((c) => valueIn(facts, c, accession, match));
    return a !== undefined && b !== undefined ? a + b : undefined;
  }
  const minus = concept.split(/-(?=[A-Za-z])/);
  if (minus.length === 2) {
    const [a, b] = minus.map((c) => valueIn(facts, c, accession, match));
    return a !== undefined && b !== undefined ? a - b : undefined;
  }
  const points = (getConceptPoints(facts, concept) ?? []).filter((p) => match(p));
  if (accession === "original") {
    return points.length ? points.reduce((a, b) => (b.filed < a.filed ? b : a)).val : undefined;
  }
  return points.find((p) => p.accn === accession)?.val;
}

function withinWindow(p: { start?: string; end: string }, fp: FiscalPeriodLabel): boolean {
  const [min, max] = DURATION_WINDOWS[fp];
  const d = daysOf(p);
  return d >= min && d <= max;
}

function sourcedValue(facts: CompanyFacts, concept: string, col: ColumnSource): { value: number; source: Source } | undefined {
  if (!col) return undefined;
  if (col.kind === "single") {
    const v = valueIn(facts, concept, col.source.accessionNumber, (p) => p.end === col.end && withinWindow(p, col.window));
    return v === undefined ? undefined : { value: v, source: col.source };
  }
  const annualMatch = (p: { start?: string; end: string }) => p.end === col.end && withinWindow(p, "FY");
  const nineMatch = (p: { start?: string; end: string }) => p.start === col.annualStart && withinWindow(p, "Q3");
  const annual = valueIn(facts, concept, col.annual.accessionNumber, annualMatch);
  const nine = valueIn(facts, concept, col.nine.accessionNumber, nineMatch);
  if (annual === undefined || nine === undefined) return undefined;
  // A derived Q4 differs from Key financials' by a unit of rounding when
  // Key financials subtracts three filed quarters and this subtracts the
  // filed nine months. That is a different route, not a restatement: only
  // a year or nine months refiled with a different figure is one.
  const originalAnnual = valueIn(facts, concept, col.ownAnnual, annualMatch);
  const originalNine = valueIn(facts, concept, "original", nineMatch);
  if (annual === originalAnnual && nine === originalNine) return undefined;
  return { value: annual - nine, source: col.annual };
}

/**
 * Re-reads a standard row from each column's presentation. A cell whose
 * figure there differs from the Key financials figure takes the
 * presentation's figure and says so; a cell the presentation can't supply
 * keeps the Key financials figure; a MISSING cell stays MISSING.
 */
function resource(
  r: StatementRow,
  facts: CompanyFacts,
  sources: { quarterly: ColumnSource[]; annual: ColumnSource[] },
  quarters: FilingPeriod[],
  years: FilingPeriod[]
) {
  const apply = (cells: StatementCell[], cols: ColumnSource[], periods: FilingPeriod[]) =>
    cells.map((c, i) => {
      if (!isValue(c)) return c;
      const got = sourcedValue(facts, c.concept, cols[i]);
      if (!got || got.value === c.value) return c;
      return {
        ...c,
        value: got.value,
        recast: {
          form: got.source.form,
          filingDate: got.source.filingDate,
          accessionNumber: got.source.accessionNumber,
          original: c.value,
          originalForm: periods[i].filing.form,
          originalFilingDate: periods[i].filing.filingDate,
        },
      };
    });
  r.quarterly = apply(r.quarterly, sources.quarterly.slice(0, quarters.length), quarters);
  r.annual = apply(r.annual, sources.annual.slice(0, years.length), years);
}

// --- building everything --------------------------------------------------------

export const ANNUAL_LOOKBACK_FILINGS = 16;

export function annualPeriods(kf: KeyFinancials, periodic: FilingEntry[]): FilingPeriod[] {
  return buildFilingPeriods(kf.fiscalCalendar, periodic.slice(0, ANNUAL_LOOKBACK_FILINGS))
    .filter((p) => p.fp === "FY")
    .slice(0, 3);
}

/** The filings the statement tabs read: the five quarters' own filings and the three years' 10-Ks, newest first, no repeats. */
export function statementFilings(kf: KeyFinancials, periodic: FilingEntry[]): FilingEntry[] {
  const quarters = kf.publishedPeriods.slice(0, 5).map((p) => p.filing);
  const years = annualPeriods(kf, periodic).map((p) => p.filing);
  const out: FilingEntry[] = [];
  for (const f of [...quarters, ...years]) if (!out.some((o) => o.accessionNumber === f.accessionNumber)) out.push(f);
  return out;
}

function sumCells(cells: StatementCell[], signs: number[], label: string): StatementCell {
  if (cells.some((c) => !isValue(c))) return { missing: MISSING_DEPENDS };
  const values = cells as StatementValue[];
  return {
    value: values.reduce((s, c, i) => s + signs[i] * c.value, 0),
    concept: label,
    method: "computed-sum",
    derived: true,
    source: "company-facts",
    components: values.map((c) => c.concept),
  };
}

export function buildStatements(
  facts: CompanyFacts,
  kf: KeyFinancials,
  periodic: FilingEntry[],
  extracts: Map<string, FilingStatementExtract>
): Statements {
  const quarterPeriods = kf.publishedPeriods.slice(0, 5);
  const all = kf.publishedPeriods;
  const years = annualPeriods(kf, periodic);
  const D = DURATION_CONCEPTS;
  const I = INSTANT_CONCEPTS;
  const S = STATEMENT_CONCEPTS;

  const dur = (names: readonly string[], cashFlow = false, grossFlow = false) =>
    resolveDurationSeries(facts, names, quarterPeriods, all, { cashFlow, grossFlow });
  const inst = (names: readonly string[]) => resolveInstantSeries(facts, names, quarterPeriods);
  const annDur = (names: readonly string[], preferred?: string) => resolveAnnualSeries(facts, names, years, "duration", preferred);
  const annInst = (names: readonly string[], preferred?: string) => resolveAnnualSeries(facts, names, years, "instant", preferred);

  // Key financials rows keep their own resolution; the annual columns read
  // the tag the quarterly row settled on, when it covers as much.
  const kfDur = (key: string, label: string, kind: RowKind, item: LineItem, names: readonly string[]) =>
    row(key, label, kind, item, annDur(names, firstConcept(item)));
  const kfInst = (key: string, label: string, kind: RowKind, item: LineItem, names: readonly string[]) =>
    row(key, label, kind, item, annInst(names, firstConcept(item)));

  const ordered = [...quarterPeriods.map((p) => p.filing.accessionNumber), ...years.map((p) => p.filing.accessionNumber)];
  const extractList = [...new Set(ordered)].map((a) => extracts.get(a)).filter((x): x is FilingStatementExtract => !!x);
  const pool = new FactPool(extractList);
  const joins: ElementJoin[] = [];
  const lines = companyLines(extractList, pool, joins);

  // --- income statement ---
  const revenue = kfDur("revenue", "Revenue", "total", kf.revenue, D.revenue);
  const operatingIncome = kfDur("operatingIncome", "Operating income", "total", kf.operatingIncome, D.operatingIncome);
  const grossProfitAnnual = wholeRowFallback(
    annDur(D.grossProfit),
    (i) => {
      const r = annDur(D.revenue, firstConcept(kf.revenue)).values[i];
      const c = annDur(D.costOfRevenue, firstConcept(kf.costOfRevenue)).values[i];
      return r && c ? cell(r.value - c.value, `${r.concept}-${c.concept}`, "computed-difference") : undefined;
    },
    years.length
  );
  const grossProfit = row("grossProfit", "Gross profit", "total", kf.grossProfit, grossProfitAnnual);

  const companyRows: StatementRow[] = lines.map((line) => ({
    key: `line:${line.elements[0]}`,
    label: line.caption,
    kind: "line" as const,
    concept: line.elements[0],
    companyTag: !line.elements[0].startsWith("us-gaap:") || undefined,
    sign: line.sign,
    signSource: line.signSource,
    quarterly: quarterPeriods.map((p) => quarterCell(pool, line, p, all)),
    annual: years.map((p) => annualCell(pool, line, p)),
  }));
  const lastCost = lines.map((l) => l.costOfRevenue).lastIndexOf(true);
  const showGrossProfit = lastCost >= 0 && kf.grossProfit.values.some((v) => v);

  const pretax = kfDur("pretaxIncome", "Pre-tax income", "total", kf.pretaxIncome, D.pretaxIncome);
  const incomeTax = kfDur("incomeTax", "Income tax", "line", kf.incomeTaxExpense, D.incomeTaxExpense);
  const netIncome = kfDur("netIncome", "Net income", "total", kf.netIncome, D.netIncome);

  const nonopTagged = dur(S.nonoperatingTotal);
  const nonopQuarterly = wholeRowFallback(
    nonopTagged,
    (i) => {
      const p = kf.pretaxIncome.values[i];
      const o = kf.operatingIncome.values[i];
      return p && o ? cell(p.value - o.value, `${p.concept}-${o.concept}`, "computed-difference") : undefined;
    },
    quarterPeriods.length
  );
  const nonopAnnual = wholeRowFallback(
    annDur(S.nonoperatingTotal),
    (i) => {
      const p = pretax.annual[i];
      const o = operatingIncome.annual[i];
      return isValue(p) && isValue(o) ? cell(p.value - o.value, `${p.concept}-${o.concept}`, "computed-difference") : undefined;
    },
    years.length
  );
  const nonop = row("nonoperating", "Non-operating income, total", "line", nonopQuarterly, nonopAnnual);
  const interest = row("interestExpense", "of which interest expense", "of", dur(S.interestExpense), annDur(S.interestExpense));
  const otherNonop = row("otherNonoperating", "of which other non-operating line", "of", dur(S.otherNonoperating), annDur(S.otherNonoperating));

  // One presentation per column: the standard rows are re-read from the
  // same statement the company lines come from. Where Key financials shows
  // something else for the period, the cell is marked recast.
  const sources = presentationSources(pool, quarterPeriods, years, extractList);
  for (const r of [revenue, grossProfit, operatingIncome, nonop, interest, otherNonop, pretax, incomeTax, netIncome]) {
    resource(r, facts, sources, quarterPeriods, years);
  }

  const afterTax = (n: StatementCell, p: StatementCell, t: StatementCell): StatementCell => {
    if (!isValue(n) || !isValue(p) || !isValue(t)) return { missing: MISSING_DEPENDS };
    return {
      value: n.value - (p.value - t.value),
      concept: `${n.concept}-(${p.concept}-${t.concept})`,
      method: "computed-difference",
      derived: true,
      source: "company-facts",
      components: [n.concept, p.concept, t.concept],
    };
  };
  const afterTaxRow: StatementRow = {
    key: "afterTaxItems",
    label: "After-tax items",
    kind: "line",
    quarterly: netIncome.quarterly.map((n, i) => afterTax(n, pretax.quarterly[i], incomeTax.quarterly[i])),
    annual: netIncome.annual.map((n, i) => afterTax(n, pretax.annual[i], incomeTax.annual[i])),
  };
  const afterTaxValues = [...afterTaxRow.quarterly, ...afterTaxRow.annual].filter(isValue);
  if (afterTaxValues.length > 0 && afterTaxValues.every((c) => c.value === 0)) afterTaxRow.hidden = true;

  const income: StatementRow[] = [revenue];
  companyRows.forEach((r, i) => {
    income.push(r);
    if (showGrossProfit && i === lastCost) income.push(grossProfit);
  });
  income.push(operatingIncome, nonop, interest, otherNonop, pretax, incomeTax, afterTaxRow, netIncome);

  // --- balance sheet ---
  const intangiblesQ = wholeRowFallback(
    inst(S.intangiblesTotal),
    (i) => {
      const f = inst(S.intangiblesFinite).values[i];
      const n = inst(S.intangiblesIndefinite).values[i];
      if (f && n) return cell(f.value + n.value, `${f.concept}+${n.concept}`, "computed-sum");
      return f;
    },
    quarterPeriods.length
  );
  const intangiblesA = wholeRowFallback(
    annInst(S.intangiblesTotal),
    (i) => {
      const f = annInst(S.intangiblesFinite).values[i];
      const n = annInst(S.intangiblesIndefinite).values[i];
      if (f && n) return cell(f.value + n.value, `${f.concept}+${n.concept}`, "computed-sum");
      return f;
    },
    years.length
  );
  const leaseQ = wholeRowFallback(
    inst(S.operatingLeaseTotal),
    (i) => {
      const n = inst(S.operatingLeaseNoncurrent).values[i];
      const c = inst(S.operatingLeaseCurrent).values[i];
      return n && c ? cell(n.value + c.value, `${n.concept}+${c.concept}`, "computed-sum") : undefined;
    },
    quarterPeriods.length
  );
  const leaseA = wholeRowFallback(
    annInst(S.operatingLeaseTotal),
    (i) => {
      const n = annInst(S.operatingLeaseNoncurrent).values[i];
      const c = annInst(S.operatingLeaseCurrent).values[i];
      return n && c ? cell(n.value + c.value, `${n.concept}+${c.concept}`, "computed-sum") : undefined;
    },
    years.length
  );
  const ltdAnnual = wholeRowFallback(
    annInst(I.longTermDebtTotal),
    (i) => {
      const nc = annInst(I.longTermDebtNoncurrent).values[i];
      const c = annInst(I.longTermDebtCurrent).values[i];
      if (nc && c) return cell(nc.value + c.value, `${nc.concept}+${c.concept}`, "computed-sum");
      if (nc) return nc;
      return undefined;
    },
    years.length
  );
  const totalLiabilitiesAnnual = wholeRowFallback(
    annInst(I.totalLiabilities),
    (i) => {
      const a = annInst(I.totalAssets).values[i];
      const e = annInst(I.equity, firstConcept(kf.equity)).values[i];
      return a && e ? cell(a.value - e.value, `${a.concept}-${e.concept}`, "computed-difference") : undefined;
    },
    years.length
  );

  const balance: StatementRow[] = [
    kfInst("cash", "Cash", "line", kf.cash, I.cash),
    kfInst("shortTermInvestments", "Short-term investments", "line", kf.shortTermInvestments, I.shortTermInvestments),
    kfInst("receivables", "Receivables", "line", kf.accountsReceivable, I.accountsReceivable),
    row("inventory", "Inventory", "line", inst(S.inventory), annInst(S.inventory)),
    kfInst("currentAssets", "Total current assets", "total", kf.currentAssets, I.currentAssets),
    row("ppe", "Property and equipment", "line", inst(S.ppe), annInst(S.ppe)),
    row("goodwill", "Goodwill", "line", inst(S.goodwill), annInst(S.goodwill)),
    row("intangibles", "Intangibles", "line", intangiblesQ, intangiblesA),
    kfInst("totalAssets", "Total assets", "total", kf.totalAssets, I.totalAssets),
    kfInst("payables", "Payables", "line", kf.accountsPayable, I.accountsPayable),
    row("shortTermBorrowings", "Short-term borrowings", "line", inst(S.shortTermBorrowings), annInst(S.shortTermBorrowings)),
    row("currentPortionLongTermDebt", "Current portion of long-term debt", "line", inst(I.longTermDebtCurrent), annInst(I.longTermDebtCurrent)),
    kfInst("currentLiabilities", "Total current liabilities", "total", kf.currentLiabilities, I.currentLiabilities),
    row("longTermDebt", "Long-term debt, incl. the part due within a year", "line", kf.longTermDebt, ltdAnnual),
    row("operatingLeaseLiabilities", "Operating lease liabilities", "line", leaseQ, leaseA),
    row("totalLiabilities", "Total liabilities", "total", kf.totalLiabilities, totalLiabilitiesAnnual),
    kfInst("totalEquity", "Total equity", "total", kf.equity, I.equity),
  ];
  const bsNames: Record<string, readonly string[]> = {
    inventory: S.inventory,
    ppe: S.ppe,
    goodwill: S.goodwill,
    intangibles: [...S.intangiblesTotal, ...S.intangiblesFinite, ...S.intangiblesIndefinite],
    shortTermBorrowings: S.shortTermBorrowings,
    currentPortionLongTermDebt: I.longTermDebtCurrent,
    shortTermInvestments: I.shortTermInvestments,
    operatingLeaseLiabilities: [...S.operatingLeaseTotal, ...S.operatingLeaseNoncurrent, ...S.operatingLeaseCurrent],
  };
  for (const r of balance) {
    const names = bsNames[r.key];
    if (names && !everFiled(facts, names)) r.notFiled = true;
  }

  // --- cash flow ---
  const acquisitionsCaption = extractList.find((x) => x.acquisitions)?.acquisitions?.caption;
  const acquisitions = row(
    "acquisitions",
    acquisitionsCaption ?? "Acquisitions",
    "line",
    dur(S.acquisitions, true, true),
    annDur(S.acquisitions)
  );
  // A column whose filing puts the line under the company's own tag: its
  // figure is not in company facts, and says why.
  const companyTagged = (accession: string) => extracts.get(accession)?.acquisitions?.companyTag === true;
  acquisitions.quarterly = acquisitions.quarterly.map((c, i) =>
    !isValue(c) && companyTagged(quarterPeriods[i].filing.accessionNumber) ? { missing: MISSING_COMPANY_TAG } : c
  );
  acquisitions.annual = acquisitions.annual.map((c, i) =>
    !isValue(c) && companyTagged(years[i].filing.accessionNumber) ? { missing: MISSING_COMPANY_TAG } : c
  );
  if (!everFiled(facts, S.acquisitions) && !extractList.some((x) => x.acquisitions)) acquisitions.notFiled = true;

  const debtRows: StatementRow[] = [];
  for (const d of DEBT_FLOW_TAGS) {
    if (!everFiled(facts, [d.tag])) continue;
    // Net lines keep their sign; gross proceeds and repayments can't be negative.
    const r = row(`debt:${d.tag}`, d.label, "line", dur([d.tag], true, d.kind !== "net"), annDur([d.tag]), { debtKind: d.kind });
    if ([...r.quarterly, ...r.annual].some(isValue)) debtRows.push(r);
  }
  // A debt tag equal to the sum of the filer's other tags of the same kind,
  // in every column where both can be measured, is a total: shown, but left
  // out of net new debt so nothing is counted twice.
  //
  // Checked from the most general tag to the most specific, each against
  // the tags not already left out: a filer that tags one bond issue twice
  // (as "debt raised" and as "senior notes raised") has two tags that each
  // equal the other, and only the general one is the total. Columns where
  // every figure is zero prove nothing and are not counted as agreement.
  const generality = (r: StatementRow) => {
    const tag = r.key.slice("debt:".length);
    if (/^(ProceedsFromIssuanceOfDebt|ProceedsFromDebtNetOfIssuanceCosts|ProceedsFromDebtMaturingInMoreThanThreeMonths|RepaymentsOfDebt|RepaymentsOfDebtMaturingInMoreThanThreeMonths|RepaymentsOfLongTermDebtAndCapitalSecurities|RepaymentsOfDebtAndCapitalLeaseObligations)$/.test(tag)) return 0;
    if (/LongTermDebt$/.test(tag)) return 1;
    return 2;
  };
  // Judged per view: a tag can be a total of other tags in the quarters
  // and the only figure in the years, when the other tags never appear in
  // a 10-K. Lines count toward a view's sum when the filer uses them
  // somewhere in that view: a tag that only ever appears in 10-Qs is not a
  // gap in the annual columns, but a line used in some quarters and not
  // others is.
  const totalsIn = (cellsOf: (x: StatementRow) => StatementCell[]): Set<StatementRow> => {
    const totals = new Set<StatementRow>();
    for (const r of [...debtRows].sort((x, y) => generality(x) - generality(y))) {
      const others = debtRows.filter((o) => o !== r && o.debtKind === r.debtKind && !totals.has(o));
      if (!others.length) continue;
      let compared = 0;
      let equal = true;
      cellsOf(r).forEach((c, i) => {
        if (!isValue(c)) return;
        const parts = others.map((o) => cellsOf(o)[i]).filter(isValue);
        if (!parts.length) return;
        const sum = parts.reduce((s, p) => s + p.value, 0);
        if (Math.abs(sum - c.value) > TOLERANCE_USD) equal = false;
        else if (c.value !== 0) compared++;
      });
      if (compared > 0 && equal) totals.add(r);
    }
    return totals;
  };
  const totalsQ = totalsIn((x) => x.quarterly);
  const totalsA = totalsIn((x) => x.annual);
  for (const r of debtRows) if (totalsQ.has(r) || totalsA.has(r)) r.debtTotal = true;
  const debtSign = (r: StatementRow) => (r.debtKind === "repayment" ? -1 : 1);
  const countedQ = debtRows.filter((r) => !totalsQ.has(r) && r.quarterly.some(isValue));
  const countedA = debtRows.filter((r) => !totalsA.has(r) && r.annual.some(isValue));
  const netNewDebt: StatementRow = {
    key: "netNewDebt",
    label: "Net new debt",
    kind: "line",
    quarterly: quarterPeriods.map((_, i) =>
      countedQ.length ? sumCells(countedQ.map((r) => r.quarterly[i]), countedQ.map(debtSign), "net new debt") : { missing: MISSING_NOT_FILED_FOR_PERIOD }
    ),
    annual: years.map((_, i) =>
      countedA.length ? sumCells(countedA.map((r) => r.annual[i]), countedA.map(debtSign), "net new debt") : { missing: MISSING_NOT_FILED_FOR_PERIOD }
    ),
  };
  if (!countedQ.length && !countedA.length) netNewDebt.notFiled = true;

  const buybacks = row("buybacks", "Buybacks", "line", dur(S.buybacks, true, true), annDur(S.buybacks), {
    filedEver: everFiled(facts, S.buybacks),
  });
  const dividends = row("dividends", "Dividends", "line", dur(S.dividends, true, true), annDur(S.dividends), {
    filedEver: everFiled(facts, S.dividends),
  });
  if (!buybacks.filedEver) buybacks.notFiled = true;
  if (!dividends.filedEver) dividends.notFiled = true;

  const sbc = row("shareBasedCompensation", "of which stock-based compensation (non-cash)", "of", dur(S.shareBasedCompensation, true, true), annDur(S.shareBasedCompensation));
  const ocf = kfDur("operatingCashFlow", "Operating cash flow", "total", kf.operatingCashFlow, D.operatingCashFlow);
  const capex = kfDur("capitalExpenditures", "Capital expenditures", "line", kf.capitalExpenditures, D.capitalExpenditures);
  const fcfAnnual = ocf.annual.map((o, i) => {
    const c = capex.annual[i];
    return isValue(o) && isValue(c) ? cell(o.value - c.value, `${o.concept}-${c.concept}`, "computed-difference") : undefined;
  });
  const fcf = row("freeCashFlow", "Free cash flow", "total", kf.freeCashFlow, { values: fcfAnnual });
  // Free cash flow is missing whenever either input is; say which kind of missing.
  fcf.quarterly = fcf.quarterly.map((c, i) =>
    !isValue(c) && (!isValue(ocf.quarterly[i]) || !isValue(capex.quarterly[i])) ? { missing: MISSING_DEPENDS } : c
  );
  fcf.annual = fcf.annual.map((c, i) =>
    !isValue(c) && (!isValue(ocf.annual[i]) || !isValue(capex.annual[i])) ? { missing: MISSING_DEPENDS } : c
  );

  const cashFlow: StatementRow[] = [
    ocf,
    sbc,
    capex,
    fcf,
    { key: "section:investing", label: "Investing", kind: "section", quarterly: [], annual: [] },
    acquisitions,
    row("investmentPurchases", "Investment purchases", "line", dur(S.investmentPurchases, true, true), annDur(S.investmentPurchases)),
    row("investmentSales", "Investment sales and maturities", "line", dur(S.investmentSales, true, true), annDur(S.investmentSales)),
    { key: "section:financing", label: "Financing", kind: "section", quarterly: [], annual: [] },
    ...debtRows,
    netNewDebt,
    buybacks,
    dividends,
  ];
  for (const r of cashFlow) {
    if (r.kind === "section" || r.notFiled !== undefined || r.key.startsWith("debt:") || r.key === "netNewDebt") continue;
    if (r.key === "investmentPurchases" && !everFiled(facts, S.investmentPurchases)) r.notFiled = true;
    if (r.key === "investmentSales" && !everFiled(facts, S.investmentSales)) r.notFiled = true;
    if (r.key === "shareBasedCompensation" && !everFiled(facts, S.shareBasedCompensation)) r.notFiled = true;
  }

  const column = (p: FilingPeriod, label: string): StatementColumn => ({
    label,
    periodEnd: p.filing.reportDate,
    accessionNumber: p.filing.accessionNumber,
    form: p.filing.form,
  });

  return {
    quarters: quarterPeriods.map((p) => column(p, p.label)),
    years: years.map((p) => column(p, p.label.replace(/^Q4 /, ""))),
    income,
    balance,
    cashFlow,
    joins,
    acquisitionsCaption,
  };
}

// --- footing ------------------------------------------------------------------

export interface FootingResult {
  column: string;
  status: "foots" | "does-not-foot" | "skipped";
  /** revenue + Σ sign × line − operating income. */
  difference?: number;
  missingLines?: string[];
}

/** For each column: the company's lines plus revenue give operating income within $1M, unless a line is MISSING. */
export function footIncomeStatement(s: Statements): FootingResult[] {
  const revenue = s.income.find((r) => r.key === "revenue")!;
  const op = s.income.find((r) => r.key === "operatingIncome")!;
  const lines = s.income.filter((r) => r.key.startsWith("line:"));
  const columns = [
    ...s.quarters.map((c, i) => ({ label: c.label, pick: (r: StatementRow) => r.quarterly[i] })),
    ...s.years.map((c, i) => ({ label: c.label, pick: (r: StatementRow) => r.annual[i] })),
  ];
  return columns.map(({ label, pick }) => {
    const missingLines = lines.filter((l) => !isValue(pick(l))).map((l) => l.label);
    const rv = pick(revenue);
    const ov = pick(op);
    if (missingLines.length || !isValue(rv) || !isValue(ov)) {
      if (!isValue(rv)) missingLines.push("Revenue");
      if (!isValue(ov)) missingLines.push("Operating income");
      return { column: label, status: "skipped", missingLines };
    }
    const total = lines.reduce((sum, l) => sum + (l.sign ?? -1) * (pick(l) as StatementValue).value, rv.value);
    const difference = total - ov.value;
    return { column: label, status: Math.abs(difference) <= TOLERANCE_USD ? "foots" : "does-not-foot", difference };
  });
}

