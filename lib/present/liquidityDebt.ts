import { FilingStatementExtract } from "@/lib/xbrl/statementExtract";

/**
 * Liquidity vs debt: the strip under the Financial health tiles.
 *
 * Two periods, the latest quarter end and the same quarter end last year,
 * each read from a filing's own balance sheet: the latest-filed filing
 * whose balance sheet presents that date, the same latest-presentation
 * rule the income statement uses. Nothing here comes from the Key
 * financials rows, and nothing here is a rule input: it moves no rung, no
 * quadrant, no Summary and no finding. The runway keeps reading Key
 * financials.
 *
 * - Liquidity is the balance sheet's cash line, whatever element carries
 *   it, plus current-asset lines that are marketable debt securities or
 *   short-term investments. Equity securities and restricted cash are
 *   excluded. A line that combines debt and equity securities and can't be
 *   split leaves the period's net figure MISSING. A cash line whose own
 *   element or caption already includes short-term investments is
 *   complete liquidity on its own.
 * - Debt is short-term borrowings (commercial paper included), the current
 *   portion of long-term debt and long-term debt, non-current, at the
 *   carrying amounts the filing's instance reports for that date, on the
 *   face of the balance sheet or only in the notes. A combined element is
 *   read only when its components aren't filed; a face-value or principal
 *   figure never stands in for a filed carrying amount. Leases are
 *   excluded, except where an element includes finance leases and can't
 *   be split: then it is used as filed, and the components line says so.
 * - Net = debt − liquidity, only when both sides are complete.
 * - Units are per period: $M when the larger of the period's two amounts
 *   is under $1B (whole numbers, or one decimal when quarterly revenue is
 *   under $100M), otherwise $B with one decimal.
 */

/** How a period's amounts are written: "$1.2B", "$845M" or "$35.5M". */
export interface StripUnit {
  scale: "B" | "M";
  decimals: 0 | 1;
}

export interface StripSource {
  accessionNumber: string;
  form: string;
  filingDate: string;
}

/** One figure the strip read: the filing's element, its caption, and where it is filed. */
export interface StripLine {
  element: string;
  caption: string;
  value: number;
  /** "statement": a line on the face of the balance sheet; "notes": only elsewhere in the instance. */
  where: "statement" | "notes";
  companyTag: boolean;
}

/**
 * short-term: short-term borrowings and commercial paper; current: the
 * current portion of long-term debt; current-all: one line holding both;
 * noncurrent: long-term debt, non-current; long-term-total: long-term debt
 * including its current portion; total: all debt in one element.
 */
export type DebtPart = "short-term" | "current" | "current-all" | "noncurrent" | "long-term-total" | "total";

export interface DebtLine extends StripLine {
  part: DebtPart;
  /** The element includes finance leases and the filing doesn't split them out. */
  includesLeases: boolean;
  /** Read from the notes in place of balance-sheet lines that include finance leases. */
  replacesLeaseLines?: boolean;
}

export interface LiquidityPeriod {
  label: string;
  periodEnd: string;
  /** The filing the period is read from; undefined when none could be read. */
  source?: StripSource;
  /** Why there is no filing figure at all for the period. */
  unavailable?: string;
  cashLines: StripLine[];
  /** The cash line's own element or caption already includes short-term investments. */
  cashIncludesShortTermInvestments: boolean;
  investmentLines: StripLine[];
  /** Equity securities and restricted cash: on the balance sheet, not in liquidity. */
  excluded: StripLine[];
  /** A line combining debt and equity securities that can't be split. */
  combined?: StripLine;
  /** Cash plus short-term investments as read; undefined when no cash line is found. */
  liquidity: number | undefined;
  liquidityComplete: boolean;
  debtLines: DebtLine[];
  /** "none": no debt element of any kind at that date. */
  debtState: "complete" | "none" | "missing";
  debtMissingReason?: string;
  debt: number | undefined;
  /** Debt − liquidity: positive is Net Debt, otherwise Net Cash. Only when both sides are complete. */
  net: number | undefined;
  unit: StripUnit;
}

export interface LiquidityDebt {
  latest: LiquidityPeriod;
  yearAgo: LiquidityPeriod;
}

const SMALL_REVENUE_USD = 100_000_000;
const BILLION = 1_000_000_000;

/**
 * $M when the larger of the period's two amounts is under $1B (one decimal
 * when quarterly revenue is under $100M, else whole numbers); $B otherwise.
 */
export function stripUnit(amounts: (number | undefined)[], revenue: number | undefined): StripUnit {
  const present = amounts.filter((v): v is number => v !== undefined).map(Math.abs);
  if (present.length === 0 || Math.max(...present) >= BILLION) return { scale: "B", decimals: 1 };
  const smallRevenue = revenue !== undefined && Math.abs(revenue) < SMALL_REVENUE_USD;
  return { scale: "M", decimals: smallRevenue ? 1 : 0 };
}

// --- classification ---------------------------------------------------------

const local = (element: string) => element.split(":")[1] ?? element;
const isStandard = (element: string) => element.startsWith("us-gaap:");

const CASH = new Set(["CashAndCashEquivalentsAtCarryingValue", "Cash", "CashAndDueFromBanks", "CashEquivalentsAtCarryingValue"]);
const CASH_WITH_INVESTMENTS = new Set(["CashCashEquivalentsAndShortTermInvestments"]);
const SHORT_TERM_INVESTMENTS = new Set([
  "ShortTermInvestments",
  "MarketableSecuritiesCurrent",
  "AvailableForSaleSecuritiesDebtSecuritiesCurrent",
  "DebtSecuritiesCurrent",
  "HeldToMaturitySecuritiesCurrent",
  "OtherShortTermInvestments",
  "AvailableForSaleSecuritiesCurrent",
]);

// Debt elements by part. Each list is in the order a notes figure is
// looked for; only the first filed one is read, so two names for the same
// balance are never added together.
const SHORT_TERM = ["ShortTermBorrowings", "CommercialPaper", "OtherShortTermBorrowings", "ShortTermBankLoansAndNotesPayable", "LinesOfCreditCurrent"];
const CURRENT = [
  "LongTermDebtCurrent",
  "LongTermDebtAndCapitalLeaseObligationsCurrent",
  "ConvertibleNotesPayableCurrent",
  "ConvertibleDebtCurrent",
  "NotesPayableCurrent",
  "SeniorNotesCurrent",
  "SecuredDebtCurrent",
  "UnsecuredDebtCurrent",
];
const CURRENT_ALL = ["DebtCurrent"];
const NONCURRENT = [
  "LongTermDebtNoncurrent",
  "LongTermDebtAndCapitalLeaseObligations",
  "LongTermNotesPayable",
  "ConvertibleDebtNoncurrent",
  "ConvertibleLongTermNotesPayable",
  "SeniorLongTermNotes",
  "UnsecuredLongTermDebt",
  "SecuredLongTermDebt",
  "LongTermLineOfCredit",
  "OtherLongTermDebtNoncurrent",
  "LongTermLoansPayable",
];
const LONG_TERM_TOTAL = ["LongTermDebt", "ConvertibleNotesPayable", "LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities"];
const TOTAL = ["DebtLongtermAndShorttermCombinedAmount", "DebtAndCapitalLeaseObligations"];

const PART_OF = new Map<string, DebtPart>([
  ...SHORT_TERM.map((e) => [e, "short-term"] as const),
  ...CURRENT.map((e) => [e, "current"] as const),
  ...CURRENT_ALL.map((e) => [e, "current-all"] as const),
  ...NONCURRENT.map((e) => [e, "noncurrent"] as const),
  ...LONG_TERM_TOTAL.map((e) => [e, "long-term-total"] as const),
  ...TOTAL.map((e) => [e, "total"] as const),
]);

/** Elements that include finance leases (the taxonomy's old "capital lease" names). */
const includesLeasesElement = (element: string) => /CapitalLease/.test(local(element));

/** A caption that states a face value or principal rather than a carrying amount. */
const FACE_VALUE_CAPTION = /\b(gross|principal|face (value|amount))\b/i;
const DEBT_CAPTION = /\b(borrowings?|debt|notes|commercial paper)\b/i;
const NOT_DEBT_CAPTION = /\b(interest|receivable|deferred|tax|taxes|accrued)\b/i;
const FINANCE_LEASE_CAPTION = /\b(finance|capital) lease/i;

/** A company-specific liability line whose caption plainly names borrowings, debt, notes or commercial paper. */
function companyDebtPart(caption: string, current: boolean): { part: DebtPart; includesLeases: boolean } | undefined {
  if (!DEBT_CAPTION.test(caption) || NOT_DEBT_CAPTION.test(caption)) return undefined;
  const includesLeases = FINANCE_LEASE_CAPTION.test(caption);
  if (!current) return { part: "noncurrent", includesLeases };
  if (/current (portion|maturities)/i.test(caption)) return { part: "current", includesLeases };
  if (/commercial paper/i.test(caption)) return { part: "short-term", includesLeases };
  // "Short-term debt" can hold the current portion too: one line for both,
  // so nothing from the notes is added on top of it.
  return { part: "current-all", includesLeases };
}

const FINANCE_LEASE_ELEMENTS = ["FinanceLeaseLiabilityCurrent", "FinanceLeaseLiabilityNoncurrent", "FinanceLeaseLiability"];
/** Elements that measure debt before its discount: a face value by definition, whatever the caption says. */
const FACE_VALUE_ELEMENTS = ["DebtInstrumentCarryingAmount", "DebtInstrumentFaceAmount"];

const DEBT_PART_ORDER: DebtPart[] = ["short-term", "current-all", "current", "noncurrent", "long-term-total", "total"];

type LiquidityKind = "cash" | "cash-with-investments" | "investments" | "equity" | "restricted" | "combined";

function liquidityKind(element: string, caption: string): LiquidityKind | undefined {
  const name = local(element);
  if (/Restricted/.test(name) || /\brestricted\b/i.test(caption)) return "restricted";
  const namesEquity = /Equity/.test(name) || /\bequity\b/i.test(caption);
  const namesDebt = /Debt/.test(name) || /MarketableSecuritiesAnd|AndMarketableSecurities/.test(name) || /\bdebt\b/i.test(caption);
  if (namesEquity) return namesDebt ? "combined" : "equity";
  const withInvestments = /short-term investments|marketable/i.test(caption);
  if (isStandard(element)) {
    if (CASH.has(name)) return withInvestments ? "cash-with-investments" : "cash";
    if (CASH_WITH_INVESTMENTS.has(name)) return "cash-with-investments";
    if (SHORT_TERM_INVESTMENTS.has(name)) return "investments";
    return undefined;
  }
  // Company-specific current-asset lines, by what the caption says.
  if (/^cash\b/i.test(caption)) return withInvestments ? "cash-with-investments" : "cash";
  if (/short-term investments|marketable securities|investments|time deposits|certificates of deposit/i.test(caption)) return "investments";
  return undefined;
}

/** Reads one period from one filing's balance sheet. Pure: everything it needs is in the extract. */
export function readBalanceSheetPeriod(
  extract: FilingStatementExtract,
  date: string,
  label: string,
  revenue: number | undefined
): LiquidityPeriod {
  const bs = extract.balanceSheet;
  const source: StripSource = { accessionNumber: extract.accessionNumber, form: extract.form, filingDate: extract.filingDate };
  const valueAt = (element: string) => extract.instants[element]?.find((f) => f.end === date)?.value;
  const lines = bs?.lines ?? [];
  const index = (element: string) => lines.findIndex((l) => l.element === element);
  const iAssetsCurrent = index("us-gaap:AssetsCurrent");
  const iAssets = index("us-gaap:Assets");
  const iLiabilitiesCurrent = index("us-gaap:LiabilitiesCurrent");

  // --- liquidity: current assets (all assets on an unclassified balance sheet)
  const assetEnd = iAssetsCurrent >= 0 ? iAssetsCurrent : iAssets;
  const cashLines: StripLine[] = [];
  const investmentLines: StripLine[] = [];
  const excluded: StripLine[] = [];
  let combined: StripLine | undefined;
  let cashIncludesShortTermInvestments = false;
  lines.slice(0, Math.max(0, assetEnd)).forEach((l) => {
    if (l.total) return;
    const value = valueAt(l.element);
    if (value === undefined) return;
    const kind = liquidityKind(l.element, l.caption);
    if (!kind) return;
    const line: StripLine = { element: l.element, caption: l.caption, value, where: "statement", companyTag: !isStandard(l.element) };
    if (kind === "cash" || kind === "cash-with-investments") {
      cashLines.push(line);
      if (kind === "cash-with-investments") cashIncludesShortTermInvestments = true;
    } else if (kind === "investments") investmentLines.push(line);
    else if (kind === "combined") combined ??= line;
    else excluded.push(line);
  });
  const liquidity = cashLines.length
    ? [...cashLines, ...investmentLines].reduce((sum, l) => sum + l.value, 0)
    : undefined;
  const liquidityComplete = liquidity !== undefined && !combined;

  // --- debt: the balance sheet's own lines first, then the notes for any part they don't show
  const debtLines: DebtLine[] = [];
  let faceValueOnly: StripLine | undefined;
  const liabilityStart = iAssets >= 0 ? iAssets + 1 : lines.length;
  lines.slice(liabilityStart).forEach((l, k) => {
    if (l.total) return;
    const value = valueAt(l.element);
    if (value === undefined) return;
    const current = iLiabilitiesCurrent >= 0 && liabilityStart + k < iLiabilitiesCurrent;
    let part: DebtPart | undefined;
    let includesLeases = false;
    if (isStandard(l.element)) {
      part = PART_OF.get(local(l.element));
      includesLeases = includesLeasesElement(l.element);
    } else {
      const c = companyDebtPart(l.caption, current);
      part = c?.part;
      includesLeases = c?.includesLeases ?? false;
    }
    if (!part) return;
    const line = { element: l.element, caption: l.caption, value, where: "statement" as const, companyTag: !isStandard(l.element) };
    if (FACE_VALUE_CAPTION.test(l.caption)) {
      faceValueOnly ??= line;
      return;
    }
    debtLines.push({ ...line, part, includesLeases });
  });

  const has = (...parts: DebtPart[]) => debtLines.some((d) => parts.includes(d.part));
  const onStatement = new Set(lines.map((l) => l.element));
  const noteCaption = (element: string) => extract.instantCaptions[element] ?? local(element);
  // A combined figure equal to the filing's own face-value figure for the
  // date is that face value, whatever its caption says.
  const faceValues = FACE_VALUE_ELEMENTS.map((n) => valueAt(`us-gaap:${n}`)).filter((v): v is number => v !== undefined && v !== 0);
  const fromNotes = (names: string[], part: DebtPart): DebtLine | undefined => {
    for (const name of names) {
      const element = `us-gaap:${name}`;
      if (onStatement.has(element)) continue;
      const value = valueAt(element);
      if (value === undefined) continue;
      const caption = noteCaption(element);
      const combinedPart = part === "long-term-total" || part === "total";
      if (FACE_VALUE_CAPTION.test(caption) || (combinedPart && faceValues.includes(value))) {
        faceValueOnly ??= { element, caption, value, where: "notes", companyTag: false };
        continue;
      }
      return { element, caption, value, where: "notes", companyTag: false, part, includesLeases: includesLeasesElement(element) };
    }
    return undefined;
  };
  const add = (d: DebtLine | undefined) => {
    if (!d) return;
    // A notes figure equal to a line already read is that line under another name.
    if (debtLines.some((x) => x.value === d.value && x.value !== 0)) return;
    debtLines.push(d);
  };
  // Finance leases the filing places inside a debt line: its finance-lease
  // figure is captioned as that line.
  const leaseCaptions = new Set(
    FINANCE_LEASE_ELEMENTS.map((n) => `us-gaap:${n}`)
      .filter((e) => (valueAt(e) ?? 0) !== 0)
      .map((e) => noteCaption(e).trim().toLowerCase())
  );
  for (const d of debtLines) if (leaseCaptions.has(d.caption.trim().toLowerCase())) d.includesLeases = true;

  // Lines that include finance leases give way to the notes' figures
  // without them, when the filing has them: long-term debt in one element
  // in place of every such line, or a lease-free current portion in place
  // of a lease-inclusive one.
  const longTermParts: DebtPart[] = ["current", "current-all", "noncurrent", "long-term-total"];
  const leased = debtLines.filter((d) => d.includesLeases && longTermParts.includes(d.part));
  if (leased.length) {
    const leaseFree = debtLines.filter((d) => !d.includesLeases && longTermParts.includes(d.part));
    const whole = leaseFree.length === 0 && leased.every((d) => d.part !== "current-all") ? fromNotes(["LongTermDebt"], "long-term-total") : undefined;
    if (whole) {
      for (const d of leased) debtLines.splice(debtLines.indexOf(d), 1);
      debtLines.push({ ...whole, replacesLeaseLines: true });
    } else {
      for (const d of leased) {
        const name = d.part === "current" ? "LongTermDebtCurrent" : d.part === "noncurrent" ? "LongTermDebtNoncurrent" : undefined;
        const lf = name ? fromNotes([name], d.part) : undefined;
        if (lf) debtLines.splice(debtLines.indexOf(d), 1, { ...lf, replacesLeaseLines: true });
      }
    }
  }

  if (!has("short-term", "current-all", "total")) add(fromNotes(SHORT_TERM, "short-term"));
  if (!has("current", "current-all", "long-term-total", "total")) add(fromNotes(CURRENT, "current"));
  if (!has("short-term", "current", "current-all", "total")) add(fromNotes(CURRENT_ALL, "current-all"));
  if (!has("noncurrent", "long-term-total", "total")) add(fromNotes(NONCURRENT, "noncurrent"));
  // The combined elements, only when none of their components is filed.
  if (!has("current", "current-all", "noncurrent", "long-term-total", "total")) add(fromNotes(LONG_TERM_TOTAL, "long-term-total"));
  if (!debtLines.length) add(fromNotes(TOTAL, "total"));

  let debtState: LiquidityPeriod["debtState"] = "complete";
  let debtMissingReason: string | undefined;
  if (!debtLines.length) {
    if (faceValueOnly) {
      debtState = "missing";
      debtMissingReason = `only a face value is filed (${faceValueOnly.caption})`;
    } else debtState = "none";
  }
  debtLines.sort((a, b) => DEBT_PART_ORDER.indexOf(a.part) - DEBT_PART_ORDER.indexOf(b.part));
  const debt = debtState === "complete" ? debtLines.reduce((sum, d) => sum + d.value, 0) : undefined;
  const net = liquidityComplete && debt !== undefined ? debt - liquidity! : undefined;

  return {
    label,
    periodEnd: date,
    source,
    cashLines,
    cashIncludesShortTermInvestments,
    investmentLines,
    excluded,
    combined,
    liquidity,
    liquidityComplete,
    debtLines,
    debtState,
    debtMissingReason,
    debt,
    net,
    unit: stripUnit([liquidity, debt], revenue),
  };
}

/** A period with no filing figure: every figure MISSING, and the reason. */
export function unavailablePeriod(label: string, date: string, reason: string, revenue: number | undefined): LiquidityPeriod {
  return {
    label,
    periodEnd: date,
    unavailable: reason,
    cashLines: [],
    cashIncludesShortTermInvestments: false,
    investmentLines: [],
    excluded: [],
    liquidity: undefined,
    liquidityComplete: false,
    debtLines: [],
    debtState: "missing",
    debtMissingReason: reason,
    debt: undefined,
    net: undefined,
    unit: stripUnit([], revenue),
  };
}

// --- text ------------------------------------------------------------------

/** "$123.0B", "$845M", or "$35.5M" for a small filer; "MISSING" when absent. */
export function liquidityAmount(value: number | undefined, unit: StripUnit): string {
  if (value === undefined) return "MISSING";
  const divisor = unit.scale === "B" ? BILLION : 1_000_000;
  const text = (Math.abs(value) / divisor).toLocaleString("en-US", {
    minimumFractionDigits: unit.decimals,
    maximumFractionDigits: unit.decimals,
  });
  return `${value < 0 ? "−" : ""}$${text}${unit.scale}`;
}

/** "Net Debt $10.3B" or "Net Cash $36.9B"; undefined when there is no net figure to state. */
export function netText(p: LiquidityPeriod): string | undefined {
  if (p.net === undefined) return undefined;
  return p.net > 0 ? `Net Debt ${liquidityAmount(p.net, p.unit)}` : `Net Cash ${liquidityAmount(-p.net, p.unit)}`;
}

/** A period's liquidity bar label. */
export function liquidityLabel(p: LiquidityPeriod): string {
  return p.investmentLines.length || p.cashIncludesShortTermInvestments ? "Cash and short-term investments" : "Cash";
}

export const NO_DEBT = "No debt on the balance sheet";

/**
 * The header's right side: "Net Debt $10.3B" then " · Net Cash $36.9B a
 * year ago" (muted on the page).
 */
export function netHeader(l: LiquidityDebt): { now: string; yearAgo: string } {
  const one = (p: LiquidityPeriod) => (p.debtState === "none" ? NO_DEBT : netText(p));
  const now = one(l.latest) ?? "Net MISSING";
  const then = one(l.yearAgo);
  return { now, yearAgo: ` · ${then === NO_DEBT ? "no debt" : (then ?? "MISSING")} a year ago` };
}

/** Why a period has no net figure, in the components line's words; undefined when it has one. */
function netMissingReason(p: LiquidityPeriod): string | undefined {
  if (p.unavailable) return p.unavailable;
  if (p.combined) return `${p.combined.caption} combines debt and equity securities and can't be split, so there is no net figure`;
  if (!p.cashLines.length) return "no cash line on the balance sheet, so there is no net figure";
  if (p.debtState === "missing") return `${p.debtMissingReason ?? "debt not filed"}, so there is no net figure`;
  return undefined;
}

/**
 * A debt caption in the line's lower case: "Short-term debt" → "short-term
 * debt"; a notes label in title case or capitals ("Long-Term Debt, Current
 * Maturities") → "long-term debt, current maturities".
 */
function debtCaption(s: string): string {
  const words = s.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w));
  const titled = words.length > 1 && words.filter((w) => /^[A-Z]/.test(w)).length >= Math.ceil(words.length * 0.6);
  if (s === s.toUpperCase() || titled) return s.toLowerCase();
  return /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}

/**
 * The components line for the latest period: each included line with the
 * company's own caption and amount, then what was excluded. "Q2 FY27: Cash
 * and cash equivalents $22.4B + Marketable debt securities $34.1B ·
 * short-term debt $1.0B + long-term debt $32.4B. Marketable equity
 * securities $42.8B and leases excluded."
 */
export function componentsLine(l: LiquidityDebt): string {
  const p = l.latest;
  const $ = (v: number | undefined) => liquidityAmount(v, p.unit);
  if (p.unavailable) return `${p.label}: ${p.unavailable}.`;

  const liquidityParts = [...p.cashLines, ...p.investmentLines].filter((x) => x.value !== 0).map((x) => `${x.caption} ${$(x.value)}`);
  if (p.combined) liquidityParts.push(`${p.combined.caption} ${$(p.combined.value)} (debt and equity securities combined)`);
  const liquidity = liquidityParts.length ? liquidityParts.join(" + ") : "no cash line";

  let debt: string;
  if (p.debtState === "none") debt = NO_DEBT.toLowerCase();
  else if (p.debtState === "missing") debt = `debt MISSING (${p.debtMissingReason})`;
  else {
    const shown = p.debtLines.filter((d) => d.value !== 0);
    debt = shown.length
      ? shown
          .map((d) => {
            const note = d.includesLeases ? " (includes finance leases, as filed)" : d.replacesLeaseLines ? " (from the notes, without finance leases)" : "";
            return `${debtCaption(d.caption)} ${$(d.value)}${note}`;
          })
          .join(" + ")
      : `debt ${$(0)}`;
  }

  const leasesIncluded = p.debtLines.some((d) => d.includesLeases && d.value !== 0);
  const excludedParts = [...p.excluded.map((x) => `${x.caption} ${$(x.value)}`), leasesIncluded ? "other leases" : "leases"];
  const excludedList =
    excludedParts.length === 1 ? excludedParts[0] : `${excludedParts.slice(0, -1).join(", ")} and ${excludedParts.at(-1)}`;
  const excluded = `${excludedList[0].toUpperCase()}${excludedList.slice(1)} excluded.`;

  const reasons = [netMissingReason(p) && `${p.label}: ${netMissingReason(p)}.`, netMissingReason(l.yearAgo) && `${l.yearAgo.label || "A year ago"}: ${netMissingReason(l.yearAgo)}.`]
    .filter(Boolean)
    .join(" ");
  return `${p.label}: ${liquidity} · ${debt}. ${excluded}${reasons ? ` ${reasons}` : ""}`;
}

/** The Copy brief's line: "Liquidity vs debt: $123.0B vs $132.5B, Net Debt $9.6B (Net Cash $37.3B a year ago)." */
export function liquidityBriefLine(l: LiquidityDebt): string {
  const p = l.latest;
  const $ = (v: number | undefined) => liquidityAmount(v, p.unit);
  const head = netHeader(l);
  const then = head.yearAgo.replace(/^ · /, "");
  if (p.debtState === "none") return `Liquidity vs debt: ${$(p.liquidity)}; no debt on the balance sheet (${then}).`;
  return `Liquidity vs debt: ${$(p.liquidity)} vs ${$(p.debt)}, ${head.now} (${then}).`;
}

export const LIQUIDITY_TIP =
  "Cash and short-term investments against borrowings, each period read from the filing's own balance sheet. Liquidity is cash plus marketable debt securities and short-term investments; equity securities and restricted cash are excluded. Debt is short-term borrowings, the current portion of long-term debt and long-term debt, at carrying amounts; leases are excluded. Net Debt = debt − cash and short-term investments.";
