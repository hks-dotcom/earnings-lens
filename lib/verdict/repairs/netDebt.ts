/**
 * Net debt at a balance-sheet date (rules section 2 and 11 R3, R4, D, M),
 * read from the app's liquidity strip (lib/present/liquidityDebt.ts
 * readBalanceSheetPeriod) with the repairs applied on top. The strip's own
 * functions are used as they are; nothing here changes what the page shows.
 *
 * - Strict presentation: a filing presents a balance-sheet date only when
 *   its total liabilities and equity is reported at that date.
 * - M: liquidity is cash and cash equivalents plus short-term marketable
 *   securities (the strip's investment lines).
 * - R4: a face cash line that includes restricted cash.
 * - R3: Ford and GM, cash and debt on the operating-company scope.
 * - D: no debt line is not zero debt.
 */
import type { CompanyFacts } from "@/lib/edgar/companyFacts";
import { getConceptPoints } from "@/lib/edgar/companyFacts";
import type { FilingEntry } from "@/lib/edgar/submissions";
import type { FilingInstance } from "@/lib/edgar/xbrlInstance";
import type { KeyFinancials } from "@/lib/xbrl/keyFinancials";
import type { FilingStatementExtract } from "@/lib/xbrl/statementExtract";
import { candidateFilings } from "@/lib/present/liquiditySources";
import { LiquidityPeriod, readBalanceSheetPeriod } from "@/lib/present/liquidityDebt";

// ------------------------------------------------------------------ strict presentation

/** A filing presents a date when its non-dimensional total liabilities and equity is reported there (the Assets dates when it files no such total). */
export function presentsDate(x: FilingStatementExtract, date: string): boolean {
  const lse = x.instants["us-gaap:LiabilitiesAndStockholdersEquity"];
  if (!lse || !lse.length) return true;
  return lse.some((f) => f.end === date);
}

// ------------------------------------------------------------------ M

/** Cash plus short-term investments (marketable securities included), as the strip reads them; null without a cash line. */
export function liquidityWithSecurities(p: Pick<LiquidityPeriod, "cashLines" | "investmentLines">): number | null {
  if (!p.cashLines.length) return null;
  return [...p.cashLines, ...p.investmentLines].reduce((s, l) => s + l.value, 0);
}

// ------------------------------------------------------------------ R4

const RESTRICTED_TAGS = [
  "RestrictedCashAndCashEquivalentsCurrent",
  "RestrictedCashCurrent",
  "RestrictedCashAndCashEquivalentsAtCarryingValue",
  "RestrictedCashAndCashEquivalents",
  "RestrictedCash",
];
const RESTRICTED_FACE = /CashCashEquivalentsRestricted/;

export const RESTRICTED_LABEL = "includes restricted cash not separately disclosed";

export type RestrictedCashCase =
  /** 1: a separately disclosed restricted-cash fact at the same date is subtracted. */
  | "separate-fact-subtracted"
  /** 2: a cash line with no restricted component, used as filed. */
  | "no-restricted-component"
  /** 3: a face line whose element includes restricted cash, no separate fact: face value, labelled, evidence Limited. */
  | "face-includes-restricted";

export interface RestrictedCashRead {
  case: RestrictedCashCase | null;
  /** Set when the filing fits none of the three cases. */
  unresolved: string | null;
  faceLine: { element: string; caption: string; value: number } | null;
  separate: { tag: string; value: number; source: string } | null;
  cashUsed: number | null;
  liquidity: number | null;
  label: string | null;
  notSeparated: boolean;
}

export function restrictedCash(
  p: LiquidityPeriod,
  extract: FilingStatementExtract,
  date: string,
  facts: CompanyFacts | null
): RestrictedCashRead {
  const none = { faceLine: null, separate: null, cashUsed: null, label: null, notSeparated: false };
  if (p.cashLines.length) return { ...none, case: "no-restricted-component", unresolved: null, liquidity: liquidityWithSecurities(p) };
  const at = (element: string) => extract.instants[element]?.find((f) => f.end === date)?.value;
  const line = extract.balanceSheet?.lines.find((l) => RESTRICTED_FACE.test(l.element) && at(l.element) !== undefined);
  if (!line) {
    const restricted = p.excluded.filter((l) => /Restricted/.test(l.element) || /\brestricted\b/i.test(l.caption));
    return {
      ...none,
      case: null,
      unresolved: restricted.length ? `restricted line(s) ${restricted.map((l) => l.element).join(", ")} but no cash line and no cash-and-restricted-cash face line` : null,
      liquidity: null,
    };
  }
  const face = at(line.element) as number;
  let separate: RestrictedCashRead["separate"] = null;
  for (const t of RESTRICTED_TAGS) {
    const v = at(`us-gaap:${t}`);
    if (v !== undefined) {
      separate = { tag: t, value: v, source: `filing ${extract.accessionNumber}` };
      break;
    }
    const pt = facts ? (getConceptPoints(facts, t) ?? []).filter((x) => x.end === date && !x.start).sort((a, b) => (a.filed < b.filed ? 1 : -1))[0] : undefined;
    if (pt) {
      separate = { tag: t, value: pt.val, source: `company facts ${pt.accn} (${pt.form}, filed ${pt.filed})` };
      break;
    }
  }
  const investments = p.investmentLines.reduce((s, l) => s + l.value, 0);
  const cashUsed = face - (separate?.value ?? 0);
  if (separate && cashUsed < 0) {
    return { ...none, case: null, unresolved: `separate restricted cash ${separate.value} exceeds the face line ${face}`, faceLine: { element: line.element, caption: line.caption, value: face }, separate, liquidity: null };
  }
  return {
    case: separate ? "separate-fact-subtracted" : "face-includes-restricted",
    unresolved: null,
    faceLine: { element: line.element, caption: line.caption, value: face },
    separate,
    cashUsed,
    liquidity: cashUsed + investments,
    label: separate ? null : RESTRICTED_LABEL,
    notSeparated: !separate,
  };
}

// ------------------------------------------------------------------ R3

/** Filers whose balance sheet consolidates a finance arm, with the axis and members that split it. */
export const FINANCE_SPLIT: Record<string, { axis: string; finance: string; nonFinance: string }> = {
  "0000037996": { axis: "us-gaap:StatementBusinessSegmentsAxis", finance: "f:FordCreditMember", nonFinance: "f:CompanyExcludingFordCreditMember" },
  "0001467858": { axis: "gm:BusinessGroupAxis", finance: "gm:GmFinancialMember", nonFinance: "gm:AutomotiveMember" },
};

const DEBT_ELEMENT = /Debt|Borrowings|CommercialPaper|NotesPayable|LongTermLoans/;

export interface AxisFact {
  concept: string;
  member: string;
  value: number;
}

/** Facts at `date` on one axis alone (Ford's 2025 filings add srt:ConsolidationItemsAxis = OperatingSegmentsMember, accepted). */
export function axisFacts(inst: FilingInstance, axis: string, date: string, concepts: string[]): AxisFact[] {
  const out: AxisFact[] = [];
  for (const f of inst.facts) {
    if (!concepts.includes(f.concept)) continue;
    const c = inst.contexts.get(f.contextRef);
    if (!c || c.start || c.end !== date) continue;
    const keys = Object.keys(c.members).filter((k) => !(k === "srt:ConsolidationItemsAxis" && c.members[k] === "us-gaap:OperatingSegmentsMember"));
    if (keys.length !== 1 || keys[0] !== axis) continue;
    if (!out.some((o) => o.concept === f.concept && o.member === c.members[axis])) out.push({ concept: f.concept, member: c.members[axis], value: f.value });
  }
  return out;
}

export interface FinanceScopeRead {
  debtLines: string[];
  liquidityLines: string[];
  facts: AxisFact[];
  consolidatedDebt: number | null;
  financeDebt: number | null;
  /** Operating-company (ex-finance) debt and liquidity: both or neither. */
  exFinanceDebt: number | null;
  exFinanceLiquidity: number | null;
  separable: boolean;
  why: string;
}

/** The debt lines the split reads: face-of-balance-sheet debt elements with no non-dimensional value at the date. */
export function financeDebtLines(extract: FilingStatementExtract, date: string): string[] {
  const at = (el: string) => extract.instants[el]?.find((f) => f.end === date)?.value;
  return (extract.balanceSheet?.lines ?? []).filter((l) => !l.total && DEBT_ELEMENT.test(l.element) && at(l.element) === undefined).map((l) => l.element);
}

/** Pure over the axis facts: cash and debt on the same (operating-company) scope, or not separable. */
export function financeScope(split: { finance: string; nonFinance: string }, debtLines: string[], liquidityLines: string[], facts: AxisFact[]): FinanceScopeRead {
  const value = (concept: string, member: string) => facts.find((f) => f.concept === concept && f.member === member)?.value;
  const sum = (concepts: string[], member: string) => concepts.reduce<number | null>((s, c) => (s === null || value(c, member) === undefined ? null : s + (value(c, member) as number)), 0);
  const debtFin = debtLines.length ? sum(debtLines, split.finance) : null;
  const debtEx = debtLines.length ? sum(debtLines, split.nonFinance) : null;
  const liqEx = liquidityLines.length ? sum(liquidityLines, split.nonFinance) : null;
  const missing = [
    ...debtLines.filter((c) => value(c, split.nonFinance) === undefined).map((c) => `${c} [${split.nonFinance}]`),
    ...liquidityLines.filter((c) => value(c, split.nonFinance) === undefined).map((c) => `${c} [${split.nonFinance}]`),
  ];
  const separable = debtLines.length > 0 && liquidityLines.length > 0 && missing.length === 0 && debtEx !== null && liqEx !== null;
  return {
    debtLines,
    liquidityLines,
    facts,
    consolidatedDebt: debtEx !== null && debtFin !== null ? debtEx + debtFin : null,
    financeDebt: debtFin,
    exFinanceDebt: separable ? debtEx : null,
    exFinanceLiquidity: separable ? liqEx : null,
    separable,
    why: separable
      ? "debt and liquidity both on the operating-company member"
      : !debtLines.length
        ? "no debt line to split"
        : !liquidityLines.length
          ? "no liquidity line to split"
          : `not filed on the operating-company member: ${missing.join(", ")}`,
  };
}

// ------------------------------------------------------------------ D

// The debt elements the liquidity strip reads (lib/present/liquidityDebt.ts), and the face-value elements.
const DEBT_CONCEPTS = new Set(
  [
    "ShortTermBorrowings", "CommercialPaper", "OtherShortTermBorrowings", "ShortTermBankLoansAndNotesPayable", "LinesOfCreditCurrent",
    "LongTermDebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent", "ConvertibleNotesPayableCurrent", "ConvertibleDebtCurrent",
    "NotesPayableCurrent", "SeniorNotesCurrent", "SecuredDebtCurrent", "UnsecuredDebtCurrent",
    "DebtCurrent",
    "LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations", "LongTermNotesPayable", "ConvertibleDebtNoncurrent",
    "ConvertibleLongTermNotesPayable", "SeniorLongTermNotes", "UnsecuredLongTermDebt", "SecuredLongTermDebt", "LongTermLineOfCredit",
    "OtherLongTermDebtNoncurrent", "LongTermLoansPayable",
    "LongTermDebt", "ConvertibleNotesPayable", "LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities",
    "DebtLongtermAndShorttermCombinedAmount", "DebtAndCapitalLeaseObligations",
    "DebtInstrumentCarryingAmount", "DebtInstrumentFaceAmount",
  ].map((c) => `us-gaap:${c}`)
);

/** Every debt concept the filing's instance reports anywhere (any context, dimensional or not). */
export function debtConceptsInFiling(inst: Pick<FilingInstance, "facts">): string[] {
  return [...new Set(inst.facts.filter((f) => DEBT_CONCEPTS.has(f.concept)).map((f) => f.concept))];
}

/** D: debt for a period whose balance sheet shows no debt line. Zero only when no debt concept appears anywhere in the filing. */
export function debtWithoutLine(conceptsInFiling: string[]): { debt: number | null; why: string } {
  return conceptsInFiling.length
    ? { debt: null, why: `no debt line read, but the filing reports ${conceptsInFiling.join(", ")}: net debt not measurable` }
    : { debt: 0, why: "no debt concept anywhere in the filing: debt 0" };
}

// ------------------------------------------------------------------ one period

export interface NetDebtLoaders {
  extract: (filing: FilingEntry) => Promise<FilingStatementExtract>;
  instance: (filing: FilingEntry) => Promise<FilingInstance>;
}

export interface NetDebtPeriod {
  date: string;
  label: string;
  source: { accessionNumber: string; form: string; filingDate: string } | null;
  skipped: string[];
  strip: { liquidity: number | null; debt: number | null; debtState: string | null; net: number | null } | null;
  restricted: RestrictedCashRead | null;
  financeScope: FinanceScopeRead | null;
  debtRule: string | null;
  liquidity: number | null;
  debt: number | null;
  net: number | null;
  notes: string[];
  basis: string;
}

export async function netDebtAt(cik: string, kf: KeyFinancials, facts: CompanyFacts, which: 0 | 4, load: NetDebtLoaders): Promise<NetDebtPeriod> {
  const q = kf.quarters[which];
  const empty = (why: string, skipped: string[] = []): NetDebtPeriod => ({
    date: q?.periodEnd ?? "",
    label: q?.label ?? "",
    source: null,
    skipped,
    strip: null,
    restricted: null,
    financeScope: null,
    debtRule: null,
    liquidity: null,
    debt: null,
    net: null,
    notes: [],
    basis: why,
  });
  if (!q) return empty("no quarter");
  const revenue = kf.revenue.values[0]?.value;
  const skipped: string[] = [];
  for (const filing of candidateFilings(q.periodEnd, kf)) {
    let x: FilingStatementExtract;
    try {
      x = await load.extract(filing);
    } catch {
      continue;
    }
    if (!x.balanceSheet?.dates.includes(q.periodEnd)) continue;
    if (!presentsDate(x, q.periodEnd)) {
      skipped.push(`${filing.form} ${filing.filingDate} ${filing.accessionNumber} (no total liabilities and equity at ${q.periodEnd})`);
      continue;
    }
    const p = readBalanceSheetPeriod(x, q.periodEnd, q.label, revenue);
    const out: NetDebtPeriod = {
      date: q.periodEnd,
      label: q.label,
      source: { accessionNumber: filing.accessionNumber, form: filing.form, filingDate: filing.filingDate },
      skipped,
      strip: { liquidity: p.liquidity ?? null, debt: p.debt ?? null, debtState: p.debtState, net: p.net ?? null },
      restricted: null,
      financeScope: null,
      debtRule: null,
      // Cash plus short-term investments as read; a line combining debt and equity securities stays out of it (noted).
      liquidity: liquidityWithSecurities(p),
      debt: p.debt ?? null,
      net: null,
      notes: [],
      basis: "liquidity strip",
    };
    if (p.combined) out.notes.push(`not in liquidity: ${p.combined.caption} (debt and equity securities in one line)`);
    // R4
    const r4 = restrictedCash(p, x, q.periodEnd, facts);
    out.restricted = r4;
    if (r4.case === "separate-fact-subtracted" || r4.case === "face-includes-restricted") {
      out.liquidity = r4.liquidity;
      if (r4.label) out.notes.push(r4.label);
      out.basis = r4.case === "separate-fact-subtracted" ? "R4: face line less the separately disclosed restricted cash" : "R4: face line, restricted cash not separated";
    }
    // R3
    const split = FINANCE_SPLIT[cik.padStart(10, "0")];
    if (split) {
      const inst = await load.instance(filing);
      const debtLines = financeDebtLines(x, q.periodEnd);
      const liquidityLines = [...p.cashLines, ...p.investmentLines].map((l) => l.element);
      const fsr = financeScope(split, debtLines, liquidityLines, axisFacts(inst, split.axis, q.periodEnd, [...debtLines, ...liquidityLines]));
      out.financeScope = fsr;
      out.debt = fsr.exFinanceDebt;
      out.liquidity = fsr.exFinanceLiquidity;
      out.basis = fsr.separable ? "R3: operating-company debt and liquidity" : `R3: not separable (${fsr.why})`;
    } else if (out.debt === null && p.debtState === "none") {
      // D
      const inst = await load.instance(filing);
      const d = debtWithoutLine(debtConceptsInFiling(inst));
      out.debt = d.debt;
      out.debtRule = d.why;
    }
    out.net = out.debt !== null && out.liquidity !== null ? out.debt - out.liquidity : null;
    return out;
  }
  return empty("no filing's balance sheet presents this date (strict check)", skipped);
}
