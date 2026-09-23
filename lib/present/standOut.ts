import { LensResult } from "@/lib/rules/evaluateLens";
import { KeyFinancials } from "@/lib/xbrl/keyFinancials";
import { FinancialHealth, marginPtsChange } from "@/lib/metrics/health";
import { RedFlagType } from "@/lib/rules/redFlags";
import {
  COSTS_VS_REVENUE_POINTS,
  DPO_BAND_PCT,
  GROSS_MARGIN_MOVE_PTS,
  OPERATING_INCOME_FAST_MOVE_PCT,
  OPERATING_INCOME_MOVE_PCT,
  RUNWAY_NEUTRAL_CAP_QUARTERS,
  RUNWAY_WEAK_BELOW_QUARTERS,
} from "@/lib/rules/declaredValues";
import {
  GROWTH_FLAT_BAND_PCT,
  NON_OPERATING_SWING_PCT_OF_REVENUE,
  PAYMENT_TERMS_BASELINE_DAYS,
  PAYMENT_TERMS_CEILING_DAYS,
  STATUTORY_TAX_RATE_PCT,
  TAX_DIVERGENCE_PCT_OF_REVENUE,
} from "@/lib/rules/declaredValues";
import { financialTriggers, TriggerKind } from "@/lib/rules/explanationTriggers";
import { formatMagnitude } from "@/lib/present/netIncomeGap";
import { chooseUnit, formatMoneyInline, MINUS, Unit } from "@/lib/present/format";
import { termsSentence } from "@/lib/present/termsSentence";
import { runwayCaveat, runwaySubject } from "@/lib/rules/runway";
import { payablesPctText } from "@/lib/rules/signals";
import { FlowFacts } from "@/lib/present/flowFacts";
import {
  ACQUISITIONS_PCT_OF_REVENUE,
  BORROWING_PCT_OF_REVENUE,
  RETURNS_PCT_OF_REVENUE,
} from "@/lib/rules/declaredValues";
import { formatDate } from "@/lib/rules/redFlags";
import { restructuringFilingsOf, restructuringKey } from "@/lib/rules/explanationTriggers";
import { riskWord } from "@/lib/present/riskWords";
import { LENS_NAME } from "@/lib/present/lensNames";

/**
 * "What stands out": short, rule-based observations about how the numbers
 * relate and move, not their levels.
 *
 * An item appears only when its threshold fires, and every threshold is a
 * declared value read from lib/rules/declaredValues.ts -- the same
 * constants the page footer prints -- so an item can never state a
 * threshold the footer contradicts.
 *
 * The order is fixed by the spec and produced by the order of the pushes
 * below: red flags, cash burn or heavy investment, a one-off item, spending
 * cuts, payables, costs, losses, margin, then terms, which is always last
 * and always present. Sorting
 * afterwards would make the order a property of a comparator nobody reads;
 * here it is the shape of the function.
 *
 * Tone drives the coloured bar on the left: amber for a watch item, green
 * for good news, blue for terms, slate for a one-off item -- which is
 * neither good nor bad news about the counterparty, only a reason net
 * income reads differently from operating income.
 *
 * Every item carries its rule: the declared threshold that made it fire,
 * in words, with the declared values read from the same constants the
 * rules use.
 */

export type StandOutTone = "watch" | "good" | "terms" | "info";

export type StandOutKind =
  | "red-flag"
  | "cash-burn"
  | "heavy-investment"
  | "borrowing"
  | "acquisitions"
  | "returns"
  | "one-off"
  | "spending-cuts"
  | "payables"
  | "costs"
  | "losses"
  | "margin"
  | "terms";

/**
 * The statements a finding reads, as tags on the finding: each opens its
 * tab. "filings" is a filing, not a statement (red flags, a restructuring
 * 8-K); "all" is the terms item, which reads everything.
 */
export type StatementTag = "is" | "bs" | "cf" | "filings" | "all";

export interface TermMark {
  label: string;
  ok: boolean;
}

export interface StandOutItem {
  kind: StandOutKind;
  /** The short all-caps tag in the left column. */
  tag: string;
  tone: StandOutTone;
  /**
   * The bold headline: one phrase, and never a figure. The Summary quotes
   * it verbatim ("The one thing to watch is ..."), and the Summary carries
   * no ratio values.
   */
  headline: string;
  /** One plain sentence. May carry figures; the Summary never quotes it. */
  sentence: string;
  /** The figures behind the item, on the muted line. Empty for the terms item, which has none of its own. */
  figures: string;
  /** Terms item only: the Net 30 / 45 / 60 marks. */
  terms?: TermMark[];
  /** The rule that made the item fire, as a clause: shown after "Rule:". */
  rule: string;
  /** The statements it reads, as tags that open their tabs; set by buildStandOut on every item. */
  statements?: StatementTag[];
  /**
   * The explanation trigger whose answer, when the filing gives one, closes
   * `sentence`. Only the items the Claude layer explains carry one.
   */
  explainKey?: string;
  /**
   * Further explanations that close `sentence`, each as its own sentence
   * with its own citation. Only spending cuts have any: one per
   * restructuring filing after the first, since each filing is explained
   * (and cached) on its own.
   */
  alsoExplainKeys?: string[];
  /**
   * Further rule-based sentences, each followed by its own explanation.
   * Only the one-off item has any: when more than one of its triggers
   * fires, it is one item with a sentence per trigger.
   */
  more?: { sentence: string; explainKey: string }[];
}

export const RED_FLAG_HEADLINE: Record<RedFlagType, string> = {
  "late-filing-12b25": "A late-filing notice on file.",
  "8-K-1.03": "A bankruptcy filing on file.",
  "8-K-2.04": "Debt has been called early.",
  "8-K-4.01": "The auditor has changed.",
  "8-K-4.02": "A restatement on file.",
  "missed-deadline": "A filing deadline has passed.",
};

/** A Y/Y move in words. Percentages only when both values are positive, per the negative-base rule. */
function moveWords(current: number, base: number, unit: Unit): string {
  if (current > 0 && base > 0) {
    const pct = ((current - base) / base) * 100;
    return `${pct >= 0 ? "up" : "down"} ${Math.abs(Math.round(pct))}%`;
  }
  const delta = current - base;
  return `${delta >= 0 ? "up" : "down"} ${formatMoneyInline(Math.abs(delta), unit)}`;
}

/** The Y/Y percentage change, or undefined when the base isn't positive (no percentage of a negative or zero base). */
function pctOnPositiveBase(current: number | undefined, base: number | undefined): number | undefined {
  if (current === undefined || base === undefined || base <= 0 || current <= 0) return undefined;
  return ((current - base) / base) * 100;
}

function pct1(value: number | undefined): string {
  if (value === undefined) return "MISSING";
  return `${value < 0 ? MINUS : ""}${Math.abs(value).toFixed(1)}%`;
}

/**
 * An amount something is compared against: "none" when it is zero, so a
 * finding reads "$249M this quarter, against none in Q2 FY26" rather than
 * against "$0M". Only an exact zero: a figure that merely rounds to $0M is
 * still an amount, and missing stays MISSING.
 */
export function comparedMoney(value: number | undefined, unit: Unit): string {
  return value === 0 ? "none" : formatMoneyInline(value, unit);
}

/**
 * A percentage move in words, rounded to a whole number unless rounding
 * would put it on the wrong side of the band it is being compared with --
 * "up 10%, beyond the ±10% band" is a contradiction a reader can see, so
 * 10.4% stays 10.4% -- or onto the band itself, where a whole number
 * can't say which side it is on. Also keeps one decimal where a whole
 * number would read as no move at all.
 */
export function bandPctWords(pct: number, band: number): string {
  const abs = Math.abs(pct);
  const whole = Math.round(abs);
  const crossesBand = abs > band !== whole > band;
  const text = crossesBand || whole === band || (whole === 0 && abs > 0) ? abs.toFixed(1) : String(whole);
  return `${pct >= 0 ? "up" : "down"} ${text}%`;
}

/**
 * The payables day counts as shown, one decimal each, and the rules' own
 * Y/Y change rounded to a whole percentage -- the same value that decided
 * the rung, so the finding, the terms line, the Why box and the Copy brief
 * all print one number.
 */
export interface PayablesShown {
  days: string;
  daysYearAgo: string;
  /** e.g. "up 27%". */
  move: string;
}

export function payablesShown(lens: LensResult): PayablesShown | undefined {
  const p = lens.paymentBehavior;
  if (p.dpoCurrent === undefined || p.dpoYearAgo === undefined || p.yoyPctChange === undefined) return undefined;
  return {
    days: p.dpoCurrent.toFixed(1),
    daysYearAgo: p.dpoYearAgo.toFixed(1),
    move: `${p.yoyPctChange >= 0 ? "up" : "down"} ${payablesPctText(p.yoyPctChange)}%`,
  };
}

/**
 * Why a day count could not be measured, from which input is absent. A
 * payables trend that can't be measured is never "not rising": it is
 * unknown, and says so.
 */
export function dpoMissingReason(kf: KeyFinancials): string {
  const cogs = [0, 4].map((i) => kf.costOfRevenue.values[i]?.value);
  const payables = [0, 4].map((i) => kf.accountsPayable.values[i]?.value);
  const yearAgoLabel = kf.quarters[4]?.label ?? "the year-ago quarter";
  const latestLabel = kf.quarters[0]?.label ?? "this quarter";
  if (cogs.every((v) => v === undefined || v === 0)) return "no cost of revenue is filed";
  if (cogs[0] === undefined) return `cost of revenue is not filed for ${latestLabel}`;
  if (cogs[1] === undefined) return `cost of revenue is not filed for ${yearAgoLabel}`;
  if (payables.every((v) => v === undefined)) return "no payables figure is filed";
  if (payables[0] === undefined) return `payables are not filed for ${latestLabel}`;
  if (payables[1] === undefined) return `payables are not filed for ${yearAgoLabel}`;
  return "the day count can't be computed for both quarters";
}

/** "Payables ≈ 54.2 days of cost of revenue, down 13% on last year." -- the fact the terms and payables items both rest on. */
export function payablesFact(lens: LensResult): string {
  const shown = payablesShown(lens);
  if (!shown) return "Payables day count not filed for this quarter.";
  return `Payables ≈ ${shown.days} days of cost of revenue, ${shown.move} on last year.`;
}

function redFlagItems(lens: LensResult): StandOutItem[] {
  return lens.redFlags.findings.map((finding) => ({
    kind: "red-flag" as const,
    tag: "RED FLAG",
    tone: "watch" as const,
    headline: RED_FLAG_HEADLINE[finding.type],
    sentence: `A red-flag filing asks whether they can pay, and sets risk to ${riskWord("Weak")}.`,
    figures: finding.detail,
    rule: "flagged on a late-filing notice, bankruptcy, debt called early, auditor change, restatement or missed filing deadline in the last 12 months.",
    explainKey: `red-flag:${finding.type}:${finding.date}`,
  }));
}

/**
 * The cash slot: at most one item, and which one depends on whether the
 * business funded itself this quarter.
 *
 * A burn and heavy investment both show a negative free cash flow and mean
 * opposite things, so they never appear together and neither ever appears
 * as the other.
 */
function cashItem(lens: LensResult, kf: KeyFinancials, unit: Unit): StandOutItem | undefined {
  if (lens.cashPosition.case === "burn") return cashBurnItem(lens, kf, unit);
  if (lens.cashPosition.case === "heavy-investment") return heavyInvestmentItem(lens, kf, unit);
  return undefined;
}

/**
 * Operations threw off cash and capital spending was larger still.
 *
 * No runway, because nothing is running out: the cash pile is not funding
 * the quarter. It is a watch item because a company outspending its own
 * cash generation is a company whose priorities could change, not because
 * it is in trouble.
 */
function heavyInvestmentItem(lens: LensResult, kf: KeyFinancials, unit: Unit): StandOutItem | undefined {
  const c = lens.cashPosition;
  if (c.capitalExpenditure === undefined || c.operatingCashFlow === undefined) return undefined;
  const q = kf.quarters;
  const cell = (value: number | undefined, i: number) =>
    value === undefined ? undefined : `${i === 0 ? formatMoneyInline(value, unit) : comparedMoney(value, unit)} (${q[i]?.label ?? "?"})`;
  const capexCells = [cell(c.capitalExpenditure, 0), cell(c.capitalExpenditureYearAgo, 4)].filter(Boolean);
  const ocfCells = [cell(c.operatingCashFlow, 0), cell(c.operatingCashFlowYearAgo, 4)].filter(Boolean);

  return {
    kind: "heavy-investment",
    tag: "HEAVY INVESTMENT",
    tone: "watch",
    headline: "Investing more than it generates.",
    sentence: `Capital spending of ${formatMoneyInline(c.capitalExpenditure, unit)} this quarter against operating cash flow of ${formatMoneyInline(c.operatingCashFlow, unit)}.`,
    figures: `Capex ${capexCells.join(", ")} · operating cash flow ${ocfCells.join(", ")}`,
    rule: "operating cash flow positive, free cash flow negative. No runway and no effect on risk; a company whose operations burn cash shows a runway instead.",
  };
}

const CASH_BURN_RULE = `operating cash flow negative this quarter. Runway = (cash + short-term investments) ÷ the larger of this quarter's and the four-quarter average burn; under ${RUNWAY_NEUTRAL_CAP_QUARTERS} quarters caps risk at ${riskWord("Neutral")}, under ${RUNWAY_WEAK_BELOW_QUARTERS} sets it to ${riskWord("Weak")}.`;

function cashBurnItem(lens: LensResult, kf: KeyFinancials, unit: Unit): StandOutItem | undefined {
  const r = lens.cashPosition;
  const latestFcf = kf.freeCashFlow.values[0]?.value;
  if (latestFcf === undefined) {
    // Operations are negative but capex is unfiled, so the burn cannot be
    // measured. Say what is known and no more.
    return {
      kind: "cash-burn",
      tag: "CASH BURN",
      tone: "watch",
      headline: "Burning cash.",
      sentence: `Operating cash flow was ${formatMoneyInline(r.operatingCashFlow, unit)} this quarter; capital spending is not filed, so runway can't be stated.`,
      figures: `Operating cash flow ${formatMoneyInline(r.operatingCashFlow, unit)} (${kf.quarters[0]?.label ?? "?"}) · cash ${formatMoneyInline(kf.cash.values[0]?.value, unit)}`,
      rule: CASH_BURN_RULE,
    };
  }
  const q = kf.quarters;

  const headline =
    r.quarters === undefined
      ? "Burning cash."
      : r.quarters >= RUNWAY_NEUTRAL_CAP_QUARTERS
        ? "Burning cash, with a long runway."
        : r.quarters >= RUNWAY_WEAK_BELOW_QUARTERS
          ? "Burning cash, with a limited runway."
          : "Burning cash, with a short runway.";

  const opening = `Free cash flow was ${formatMoneyInline(latestFcf, unit)} this quarter`;
  let sentence: string;
  const covers = `${runwaySubject(r)} about ${r.quarters} quarters of burn`;
  if (r.quarters === undefined) {
    sentence = `${opening}; cash is not filed, so runway can't be stated.`;
  } else if (r.burnBasis === "four-quarter average") {
    sentence = `${opening}. ${covers}, at the four-quarter average burn of ${formatMoneyInline(r.averageBurn, unit)} a quarter, the larger of the two measures${runwayCaveat(r)}.`;
  } else {
    sentence = `${opening}. ${covers}, at this quarter's rate${runwayCaveat(r)}.`;
  }

  // Both burn measures, because the rule divides by the larger of them:
  // a reader who can only see one of the two can't check the figure.
  const fcfCells = [0, 1, 4]
    .filter((i) => kf.freeCashFlow.values[i] !== undefined && q[i])
    .map((i) => `${i === 0 ? formatMoneyInline(kf.freeCashFlow.values[i]!.value, unit) : comparedMoney(kf.freeCashFlow.values[i]!.value, unit)} (${q[i].label})`);
  const average =
    r.averageBurn === undefined
      ? "four-quarter average burn not available"
      : `four-quarter average burn ${formatMoneyInline(r.averageBurn, unit)}`;
  const cash =
    (r.cash === undefined ? "cash MISSING" : `cash ${formatMoneyInline(r.cash, unit)}`) +
    (r.shortTermInvestments !== undefined
      ? ` · short-term investments ${formatMoneyInline(r.shortTermInvestments, unit)}`
      : r.liquidityBasis === "cash-only-missing-this-quarter"
        ? " · short-term investments MISSING"
        : "");

  return {
    kind: "cash-burn",
    tag: "CASH BURN",
    tone: "watch",
    headline,
    sentence,
    figures: `FCF ${fcfCells.join(", ")} · ${average} · ${cash}`,
    rule: CASH_BURN_RULE,
  };
}

/**
 * The one-off item: something between operating income and net income big
 * enough that net income tells a different story from the figure the rules
 * read.
 *
 * It fires on exactly the explanation layer's three financial triggers --
 * the same function decides both -- so the item and the explanation that
 * closes it can never be about different things. When more than one fires
 * it is still one item, with a sentence per trigger; the headline follows
 * the Summary's own choice, which names a tax item first because it is
 * the more specific of the two.
 */
const ONE_OFF_ORDER: TriggerKind[] = ["unusual-tax", "non-operating-swing", "opposite-signs"];

type OneOffFigure = "operating" | "pretax" | "tax" | "net";

interface OneOffPart {
  kind: TriggerKind;
  headline: string;
  sentence: string;
  figures: OneOffFigure[];
  rule: string;
}

/**
 * An amount in the one-off item's prose: billions to one decimal, and
 * millions at the table's own precision -- one decimal only when quarterly
 * revenue is under $100M -- so "$1M" here is the "1" in the table's row.
 */
function oneOffAmount(absValue: number, unit: Unit): string {
  if (absValue >= 1_000_000_000) return formatMagnitude(absValue);
  const millions = (absValue / 1_000_000).toLocaleString("en-US", {
    minimumFractionDigits: unit.decimals,
    maximumFractionDigits: unit.decimals,
  });
  return `$${millions}M`;
}

function signedAmount(value: number, unit: Unit): string {
  return `${value < 0 ? MINUS : ""}${oneOffAmount(Math.abs(value), unit)}`;
}

export function oneOffItem(kf: KeyFinancials, unit: Unit): StandOutItem | undefined {
  const fired = new Set(financialTriggers(kf).map((t) => t.kind));
  const kinds = ONE_OFF_ORDER.filter((k) => fired.has(k));
  if (kinds.length === 0) return undefined;

  // Every value read here is one the trigger that fired already required,
  // so none of them is missing when its part is built.
  const revenue = kf.revenue.values[0]?.value ?? 0;
  const operating = kf.operatingIncome.values[0]?.value ?? 0;
  const pretax = kf.pretaxIncome.values[0]?.value ?? 0;
  const tax = kf.incomeTaxExpense.values[0]?.value ?? 0;
  const net = kf.netIncome.values[0]?.value ?? 0;

  const part = (kind: TriggerKind): OneOffPart => {
    if (kind === "non-operating-swing") {
      const band = (revenue * NON_OPERATING_SWING_PCT_OF_REVENUE) / 100;
      return {
        kind,
        headline: "A non-operating item moved net income.",
        sentence: `Pre-tax income is ${oneOffAmount(Math.abs(pretax - operating), unit)} ${pretax > operating ? "above" : "below"} operating income.`,
        figures: ["operating", "pretax"],
        rule: `pre-tax income differs from operating income by more than ${NON_OPERATING_SWING_PCT_OF_REVENUE}% of quarterly revenue (${oneOffAmount(band, unit)} here)`,
      };
    }
    if (kind === "unusual-tax") {
      const band = (revenue * TAX_DIVERGENCE_PCT_OF_REVENUE) / 100;
      const statutory = (pretax * STATUTORY_TAX_RATE_PCT) / 100;
      return {
        kind,
        headline: "An unusual tax item moved net income.",
        sentence: `Income tax of ${signedAmount(tax, unit)} against ${signedAmount(statutory, unit)} at the ${STATUTORY_TAX_RATE_PCT}% federal rate.`,
        figures: ["pretax", "tax"],
        rule: `income tax differs from ${STATUTORY_TAX_RATE_PCT}% of pre-tax income by more than ${TAX_DIVERGENCE_PCT_OF_REVENUE}% of quarterly revenue (${oneOffAmount(band, unit)} here), and the same quarter last year was not also flagged`,
      };
    }
    return {
      kind,
      headline: "Net income and operating income point opposite ways.",
      sentence: `Net income is ${signedAmount(net, unit)} while operating income is ${signedAmount(operating, unit)}.`,
      figures: ["operating", "net"],
      rule: "net income and operating income have opposite signs",
    };
  };

  const parts = kinds.map(part);
  const wanted = new Set(parts.flatMap((p) => p.figures));
  const figureText: Record<OneOffFigure, string> = {
    operating: `operating income ${formatMoneyInline(operating, unit)}`,
    pretax: `pre-tax income ${formatMoneyInline(pretax, unit)}`,
    tax: `income tax ${formatMoneyInline(tax, unit)}`,
    net: `net income ${formatMoneyInline(net, unit)}`,
  };
  // Always in income-statement order, whichever triggers asked for them.
  const figures = (["operating", "pretax", "tax", "net"] as OneOffFigure[])
    .filter((f) => wanted.has(f))
    .map((f) => figureText[f])
    .join(" · ");

  const [first, ...rest] = parts;
  return {
    kind: "one-off",
    tag: "ONE-OFF ITEM",
    tone: "info",
    headline: first.headline,
    sentence: first.sentence,
    figures: `${figures[0].toUpperCase()}${figures.slice(1)} (${kf.quarters[0]?.label ?? "latest quarter"})`,
    rule: `flagged when ${parts.map((p) => p.rule).join("; or when ")}.`,
    explainKey: first.kind,
    more: rest.map((p) => ({ sentence: p.sentence, explainKey: p.kind })),
  };
}

/** "A", "A and B", "A, B and C". */
export function listInWords(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Spending cuts. A restructuring filing is named with its date, every one
 * in the window, oldest first; each filing's explanation closes the
 * sentence as its own sentence with its own citation. An R&D or SG&A cut is
 * a sentence of its own, closed by the quarter's explanation.
 */
function spendingCutsItem(lens: LensResult, kf: KeyFinancials, unit: Unit): StandOutItem | undefined {
  if (!lens.retrenchment.triggered) return undefined;
  const filings = [...restructuringFilingsOf(lens)].reverse();
  // The cuts the rules found, in their words: "R&D down -3.4% Y/Y, beyond ...".
  const cuts = lens.retrenchment.causes
    .map((c) => c.match(/^(R&D|SG&A) down -?([\d.]+)% Y\/Y/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ label: m[1], pct: m[2] }));
  const cutSentence = cuts.length
    ? `${listInWords(cuts.map((c) => `${c.label} down ${c.pct}%`))} on last year.`
    : undefined;
  const cutFigures = cuts.map((c) => {
    const item = c.label === "R&D" ? kf.researchAndDevelopment : kf.sga;
    return `${c.label} ${formatMoneyInline(item.values[0]?.value, unit)}, from ${comparedMoney(item.values[4]?.value, unit)} in ${kf.quarters[4]?.label ?? "the year-ago quarter"}`;
  });

  const dates = filings.map((f) => formatDate(f.filingDate));
  const filingSentence =
    filings.length === 0
      ? undefined
      : filings.length === 1
        ? `A restructuring filing (8-K Item 2.05) on ${dates[0]}.`
        : `Restructuring filings (8-K Item 2.05) on ${listInWords(dates)}.`;
  const keys = filings.map((f) => restructuringKey(f.accessionNumber));

  const sentences: { sentence: string; explainKey: string }[] = [];
  if (filingSentence) sentences.push({ sentence: filingSentence, explainKey: keys[0] });
  if (cutSentence) sentences.push({ sentence: cutSentence, explainKey: "retrenchment" });
  if (sentences.length === 0) return undefined;
  const [first, ...rest] = sentences;

  const figures = [
    ...filings.map((f, i) => `8-K filed ${dates[i]}, accession ${f.accessionNumber}`),
    ...cutFigures,
  ].join(" · ");

  return {
    kind: "spending-cuts",
    tag: "SPENDING CUTS",
    tone: "watch",
    headline: "Spending under review; existing contracts may be revisited.",
    sentence: first.sentence,
    figures,
    rule: `flagged on a restructuring filing (8-K Item 2.05) in the last 12 months, or R&D or SG&A down more than ${GROWTH_FLAT_BAND_PCT}% on last year. Raises risk on both lenses and sets opportunity low for ${LENS_NAME.SaaS}.`,
    explainKey: first.explainKey,
    ...(filingSentence && keys.length > 1 ? { alsoExplainKeys: keys.slice(1) } : {}),
    ...(rest.length ? { more: rest } : {}),
  };
}

function payablesItem(lens: LensResult): StandOutItem | undefined {
  const p = lens.paymentBehavior;
  const shown = payablesShown(lens);
  if (p.state !== "rising" || !shown) return undefined;
  return {
    kind: "payables",
    tag: "PAYABLES",
    tone: "watch",
    // The fact, not a reading of it: payables include bills that aren't
    // for supplies, so a claim about how fast they pay suppliers says more
    // than DPO shows. The DPO tile's "i" keeps that reading, hedged with "may".
    headline: "Payables stretching.",
    sentence: `Payables are ${shown.move} on last year, beyond the ±${DPO_BAND_PCT}% band.`,
    figures: `Payables ≈ ${shown.days} days of cost of revenue, from ${shown.daysYearAgo} a year ago`,
    rule: `flagged when payables, in days of cost of revenue, move more than ${DPO_BAND_PCT}% on the same quarter last year.`,
    explainKey: "dpo-rising",
  };
}

function costsItem(kf: KeyFinancials, unit: Unit): StandOutItem | undefined {
  const sga = kf.sga.values[0]?.value;
  const sgaYearAgo = kf.sga.values[4]?.value;
  const revenue = kf.revenue.values[0]?.value;
  const revenueYearAgo = kf.revenue.values[4]?.value;

  const sgaPct = pctOnPositiveBase(sga, sgaYearAgo);
  const revenuePct = pctOnPositiveBase(revenue, revenueYearAgo);
  if (sgaPct === undefined || revenuePct === undefined) return undefined;

  const gap = sgaPct - revenuePct;
  if (Math.abs(gap) <= COSTS_VS_REVENUE_POINTS) return undefined;

  const faster = gap > 0;
  return {
    kind: "costs",
    tag: "COSTS",
    tone: faster ? "watch" : "good",
    headline: faster ? "Overhead growing faster than sales." : "Overhead growing slower than sales.",
    sentence: `SG&A ${moveWords(sga!, sgaYearAgo!, unit)} on last year against revenue ${moveWords(revenue!, revenueYearAgo!, unit)}.`,
    figures: `SG&A ${formatMoneyInline(sga, unit)}, from ${comparedMoney(sgaYearAgo, unit)} · revenue ${formatMoneyInline(revenue, unit)}, from ${comparedMoney(revenueYearAgo, unit)}`,
    rule: `flagged when SG&A growth is more than ${COSTS_VS_REVENUE_POINTS} points away from revenue growth, year on year.`,
  };
}

interface Trajectory {
  /** The headline half: "Operating loss narrowing." */
  headline: string;
  tone: "good" | "watch";
  sentence: string;
  /** The Summary's part 3 clause: "the losses are shrinking fast". */
  summaryClause: string;
}

/**
 * The operating-income move, in the four shapes it can take plus the two
 * sign flips. Shared with the Summary, which says the same thing in its
 * own voice ("the losses are shrinking fast") without the figures.
 *
 * Exported because the Summary needs the trajectory even when the move is
 * too small for a "What stands out" item to fire: part 3 of the Summary is
 * the direction of travel, not a threshold.
 */
export function operatingTrajectory(kf: KeyFinancials, unit: Unit): Trajectory | undefined {
  const current = kf.operatingIncome.values[0]?.value;
  const yearAgo = kf.operatingIncome.values[4]?.value;
  if (current === undefined || yearAgo === undefined || current === yearAgo) return undefined;

  const movePct = yearAgo === 0 ? undefined : ((current - yearAgo) / Math.abs(yearAgo)) * 100;
  // "Fast" is the higher of the two declared bands. The lower one (25%)
  // decides whether the item appears at all; a move between the two is
  // shrinking or growing, and only past 50% is it shrinking or growing
  // fast.
  const fast = movePct !== undefined && Math.abs(movePct) > OPERATING_INCOME_FAST_MOVE_PCT ? " fast" : "";
  const delta = formatMoneyInline(Math.abs(current - yearAgo), unit);

  if (current < 0 && yearAgo < 0) {
    const narrowing = current > yearAgo;
    return {
      headline: narrowing ? "Operating loss narrowing." : "Operating loss widening.",
      tone: narrowing ? "good" : "watch",
      sentence: `The loss is ${delta} ${narrowing ? "smaller" : "larger"} than a year ago.`,
      summaryClause: `the losses are ${narrowing ? "shrinking" : "growing"}${fast}`,
    };
  }
  if (current >= 0 && yearAgo >= 0) {
    const rising = current > yearAgo;
    return {
      headline: rising ? "Operating profit rising." : "Operating profit falling.",
      tone: rising ? "good" : "watch",
      sentence: `Operating income is ${moveWords(current, yearAgo, unit)} on last year.`,
      summaryClause: `profits are ${rising ? "growing" : "falling"}${fast}`,
    };
  }
  if (current >= 0) {
    return {
      headline: "Back to an operating profit.",
      tone: "good",
      sentence: `Operating income is ${formatMoneyInline(current, unit)}, from a loss of ${formatMoneyInline(Math.abs(yearAgo), unit)} a year ago.`,
      summaryClause: "the company is back in operating profit",
    };
  }
  return {
    headline: "Swung to an operating loss.",
    tone: "watch",
    sentence: `Operating income is ${formatMoneyInline(current, unit)}, from a profit of ${formatMoneyInline(yearAgo, unit)} a year ago.`,
    summaryClause: "the company has swung to an operating loss",
  };
}

function lossesItem(kf: KeyFinancials, health: FinancialHealth, unit: Unit): StandOutItem | undefined {
  const current = kf.operatingIncome.values[0]?.value;
  const yearAgo = kf.operatingIncome.values[4]?.value;
  if (current === undefined || yearAgo === undefined || yearAgo === 0) return undefined;

  const movePct = ((current - yearAgo) / Math.abs(yearAgo)) * 100;
  if (Math.abs(movePct) <= OPERATING_INCOME_MOVE_PCT) return undefined;

  const trajectory = operatingTrajectory(kf, unit);
  if (!trajectory) return undefined;

  const marginNow = health.operatingMarginPct[0];
  const marginThen = health.operatingMarginPct[4];
  const marginPart =
    marginNow !== undefined && marginThen !== undefined
      ? ` · margin ${pct1(marginNow)}, from ${pct1(marginThen)}`
      : "";

  return {
    kind: "losses",
    tag: current < 0 ? "LOSSES" : "PROFITS",
    tone: trajectory.tone,
    headline: trajectory.headline,
    sentence: trajectory.sentence,
    figures: `Operating income ${formatMoneyInline(current, unit)}, from ${comparedMoney(yearAgo, unit)} in ${kf.quarters[4]?.label ?? "the year-ago quarter"}${marginPart}`,
    rule: `flagged when operating income moves more than ${OPERATING_INCOME_MOVE_PCT}% on last year; past ${OPERATING_INCOME_FAST_MOVE_PCT}% the Summary calls it fast.`,
  };
}

function marginItem(kf: KeyFinancials, health: FinancialHealth): StandOutItem | undefined {
  const now = health.grossMarginPct[0];
  const then = health.grossMarginPct[4];
  // The same point change the table shows: computed from the displayed
  // one-decimal values, so the item and the margin row never disagree.
  const pts = marginPtsChange(now, then);
  if (pts === undefined || Math.abs(pts) <= GROSS_MARGIN_MOVE_PTS) return undefined;

  const up = pts > 0;
  return {
    kind: "margin",
    tag: "MARGIN",
    tone: up ? "good" : "watch",
    headline: up ? "Gross margin expanding." : "Gross margin contracting.",
    sentence: `${up ? "Up" : "Down"} ${Math.abs(pts).toFixed(1)} points on last year.`,
    figures: `${pct1(now)}, from ${pct1(then)} in ${kf.quarters[4]?.label ?? "the year-ago quarter"}`,
    rule: `flagged when gross margin moves more than ${GROSS_MARGIN_MOVE_PTS} points on last year.`,
  };
}

/**
 * How the work is contracted and billed, in one phrase.
 *
 * It is the only part of the removed deal-structure table that survives on
 * the page, and it sits here because it is the other half of the terms: Net
 * 30 means something different against a monthly services invoice than it
 * does against an annual subscription billed up front, and a reader who is
 * given the days without the billing shape has half the envelope.
 *
 * The Services lens's phrase moves with the risk reading for the same reason the
 * terms ceiling does -- milestones are only acceptable against a counterparty
 * strong enough to reach them.
 */
function billingPhrase(lens: LensResult): string {
  if (lens.lens === "SaaS") return "Billed annually in advance.";
  return lens.risk.reading === "low" ? "T&M monthly; milestones acceptable." : "T&M monthly.";
}

/**
 * The terms caveat, when DPO can't be computed: the ladder's "will they pay
 * on time?" question has no answer, and a reader of the terms is owed that.
 * Shared with the Copy brief's terms envelope.
 */
export function paymentTimingCaveat(lens: LensResult, kf: KeyFinancials): string | undefined {
  if (payablesShown(lens)) return undefined;
  return `Payment timing can't be checked: ${dpoMissingReason(kf)}, so payables can't be measured.`;
}

function termsItem(lens: LensResult, kf: KeyFinancials): StandOutItem {
  const l = lens.ladder;
  return {
    kind: "terms",
    tag: "TERMS",
    tone: "terms",
    headline: termsSentence(lens),
    sentence: `${billingPhrase(lens)} ${paymentTimingCaveat(lens, kf) ?? payablesFact(lens)}`,
    figures: "",
    rule: `baseline Net ${PAYMENT_TERMS_BASELINE_DAYS}; ceiling Net ${PAYMENT_TERMS_CEILING_DAYS}, offered only when risk is ${riskWord("Strong")}; Net 60 never approved.`,
    terms: [
      { label: "Net 30", ok: l.net30 },
      { label: "Net 45", ok: l.net45 },
      { label: "Net 60", ok: l.net60 },
    ],
  };
}

// --- the display-only cash-flow findings -----------------------------------------
// Borrowing, acquisitions and investments, returns. None of them moves the
// ladder or the quadrant, and none is in the Summary: they say what the
// cash flow statement shows, beside the verdict rather than inside it.

/** "Long-term debt raised $13,557M, repaid $2,752M": the debt lines, grouped by the kind of debt. */
function debtLinesText(flows: FlowFacts, unit: Unit): string {
  const groups = new Map<string, string[]>();
  for (const d of flows.debtLines) {
    const m = d.label.match(/^(.*?)\s+(raised|repaid|drawn)$/);
    const family = m ? m[1] : d.label;
    const verb = m ? m[2] : "";
    const text = `${verb ? `${verb} ` : ""}${formatMoneyInline(d.value, unit)}`;
    groups.set(family, [...(groups.get(family) ?? []), text]);
  }
  return [...groups.entries()]
    .map(([family, parts], i) => `${i === 0 ? family : family[0].toLowerCase() + family.slice(1)} ${parts.join(", ")}`)
    .join(" · ");
}

function borrowingItem(kf: KeyFinancials, flows: FlowFacts, unit: Unit): StandOutItem | undefined {
  const revenue = kf.revenue.values[0]?.value;
  const fcf = kf.freeCashFlow.values[0]?.value;
  const debt = flows.netNewDebt;
  if (revenue === undefined || revenue <= 0 || debt === undefined) return undefined;
  const band = (revenue * BORROWING_PCT_OF_REVENUE) / 100;
  if (debt <= band) return undefined;

  const t = flows.ttm;
  const returns = t.buybacks !== undefined && t.dividends !== undefined ? t.buybacks + t.dividends : undefined;
  const fcfNegative = fcf !== undefined && fcf < 0;
  const returnsExceed = returns !== undefined && t.freeCashFlow !== undefined && returns > t.freeCashFlow;
  if (!fcfNegative && !returnsExceed) return undefined;

  const ltd =
    flows.longTermDebt !== undefined
      ? ` · long-term debt ${formatMoneyInline(flows.longTermDebt, unit)}${
          flows.longTermDebtYearAgo !== undefined
            ? `, from ${comparedMoney(flows.longTermDebtYearAgo, unit)} in ${kf.quarters[4]?.label ?? "the year-ago quarter"}`
            : ""
        }`
      : "";
  return {
    kind: "borrowing",
    tag: "BORROWING",
    tone: "watch",
    headline: fcfNegative ? "Borrowing while investment runs ahead of cash." : "Borrowing while returning more than it generates.",
    sentence: fcfNegative
      ? `Net new debt of ${formatMoneyInline(debt, unit)} this quarter, with free cash flow at ${formatMoneyInline(fcf, unit)}.`
      : `Net new debt of ${formatMoneyInline(debt, unit)} this quarter, while buybacks and dividends of ${formatMoneyInline(returns, unit)} over four quarters exceed free cash flow${t.freeCashFlow === 0 ? ", which was none" : ` of ${formatMoneyInline(t.freeCashFlow, unit)}`}.`,
    figures: `${debtLinesText(flows, unit)}${ltd}`,
    rule: `net new debt above ${BORROWING_PCT_OF_REVENUE}% of quarterly revenue (${formatMoneyInline(band, unit)} here), while free cash flow is negative or buybacks and dividends exceed it. No effect on risk.`,
  };
}

function acquisitionsItem(kf: KeyFinancials, flows: FlowFacts, unit: Unit, ticker: string): StandOutItem | undefined {
  const revenue = kf.revenue.values[0]?.value;
  const a = flows.acquisitions;
  if (revenue === undefined || revenue <= 0 || a === undefined) return undefined;
  if (a <= (revenue * ACQUISITIONS_PCT_OF_REVENUE) / 100) return undefined;
  const yearAgo =
    flows.acquisitionsYearAgo !== undefined
      ? `, against ${comparedMoney(flows.acquisitionsYearAgo, unit)} in ${kf.quarters[4]?.label ?? "the year-ago quarter"}`
      : "";
  const caption = flows.acquisitionsCaption ? `${ticker}'s line: "${flows.acquisitionsCaption}"` : "The acquisitions line";
  return {
    kind: "acquisitions",
    tag: "ACQUISITIONS AND INVESTMENTS",
    tone: "info",
    headline: "Large spending on acquisitions and investments.",
    sentence: `${formatMoneyInline(a, unit)} this quarter${yearAgo}.`,
    figures: `${caption} · ${((a / revenue) * 100).toFixed(1)}% of revenue`,
    rule: `flagged when this line exceeds ${ACQUISITIONS_PCT_OF_REVENUE}% of quarterly revenue; named as the company names it.`,
    explainKey: "acquisitions",
  };
}

/**
 * Buybacks plus dividends over four quarters above free cash flow over the
 * same quarters -- and above a declared share of the latest quarter's
 * revenue, so a token dividend against a near-zero free cash flow is not a
 * finding.
 */
export function returnsItem(kf: KeyFinancials, flows: FlowFacts, unit: Unit): StandOutItem | undefined {
  const t = flows.ttm;
  const revenue = kf.revenue.values[0]?.value;
  if (t.buybacks === undefined || t.dividends === undefined || t.freeCashFlow === undefined) return undefined;
  if (revenue === undefined || revenue <= 0) return undefined;
  const returns = t.buybacks + t.dividends;
  const threshold = (revenue * RETURNS_PCT_OF_REVENUE) / 100;
  if (returns <= t.freeCashFlow || returns <= threshold) return undefined;
  const span = t.from && t.to ? `, ${t.from} to ${t.to}` : "";
  const against =
    t.freeCashFlow === 0 ? "against none in free cash flow" : `against free cash flow of ${formatMoneyInline(t.freeCashFlow, unit)}`;
  return {
    kind: "returns",
    tag: "RETURNS",
    tone: "watch",
    headline: "Returning more cash than it generates.",
    sentence: `Buybacks and dividends of ${formatMoneyInline(returns, unit)} over four quarters, ${against}.`,
    figures: `Buybacks ${formatMoneyInline(t.buybacks, unit)} · dividends ${formatMoneyInline(t.dividends, unit)} · free cash flow ${formatMoneyInline(t.freeCashFlow, unit)}${span}`,
    rule: `flagged when buybacks plus dividends over the last four quarters exceed free cash flow over the same quarters, and exceed ${RETURNS_PCT_OF_REVENUE}% of quarterly revenue (${formatMoneyInline(threshold, unit)} here).`,
  };
}

/**
 * The statements each finding reads, as tags on the finding. A red flag and
 * a restructuring filing are filings, not statements; the terms item reads
 * all of them.
 */
function statementsFor(item: StandOutItem, lens: LensResult): StatementTag[] {
  switch (item.kind) {
    case "one-off":
    case "costs":
    case "losses":
    case "margin":
      return ["is"];
    case "payables":
      return ["bs", "is"];
    case "borrowing":
    case "cash-burn":
      return ["cf", "bs"];
    case "heavy-investment":
    case "acquisitions":
    case "returns":
      return ["cf"];
    case "spending-cuts": {
      const causes = lens.retrenchment.causes;
      const tags: StatementTag[] = [];
      if (causes.some((c) => /^(R&D|SG&A)/.test(c))) tags.push("is");
      if (causes.some((c) => /restructuring filing/.test(c))) tags.push("filings");
      return tags;
    }
    case "red-flag":
      return ["filings"];
    case "terms":
      return ["all"];
  }
}

export function buildStandOut(
  lens: LensResult,
  kf: KeyFinancials,
  health: FinancialHealth,
  flows?: FlowFacts,
  ticker = ""
): StandOutItem[] {
  const unit = chooseUnit(kf.revenue.values[0]?.value);
  const items: StandOutItem[] = [];

  items.push(...redFlagItems(lens));
  push(items, cashItem(lens, kf, unit));
  if (flows) {
    push(items, borrowingItem(kf, flows, unit));
    push(items, acquisitionsItem(kf, flows, unit, ticker));
    push(items, returnsItem(kf, flows, unit));
  }
  push(items, oneOffItem(kf, unit));
  push(items, spendingCutsItem(lens, kf, unit));
  push(items, payablesItem(lens));
  push(items, costsItem(kf, unit));
  push(items, lossesItem(kf, health, unit));
  push(items, marginItem(kf, health));
  items.push(termsItem(lens, kf));

  for (const item of items) item.statements = statementsFor(item, lens);
  return items;
}

function push(items: StandOutItem[], item: StandOutItem | undefined) {
  if (item) items.push(item);
}
