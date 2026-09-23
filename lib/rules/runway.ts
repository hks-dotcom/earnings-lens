import { KeyFinancials } from "@/lib/xbrl/keyFinancials";

/**
 * What the cash flow statement says about the quarter, in the two cases
 * that are worth saying something about -- and they are not the same case.
 *
 * Free cash flow is operating cash flow minus capital expenditure, so it
 * goes negative for two unrelated reasons, and treating them alike gets
 * one of them badly wrong:
 *
 * - **burn**: operating cash flow itself is negative. The business is not
 *   funding itself, the cash pile is the only thing paying for the
 *   quarter, and how long it lasts is a real question about whether they
 *   can pay us. This is the case the runway rule exists for.
 * - **heavy investment**: operations threw off cash and the company spent
 *   more than that on capital. Amazon's quarter is the shape: $45bn in
 *   from operations, $54bn out to capex. Calling that "burning cash, with
 *   about two years of runway" is not a nuance, it is false -- the cash
 *   pile is not funding the business, and the spending is discretionary in
 *   a way a burn is not. It gets a watch item and nothing else: no runway
 *   figure, and no effect on the payment-terms ladder.
 *
 * Operating cash flow exactly zero is neither, and an unfiled operating
 * cash flow is neither: a missing value stays missing rather than being
 * read as one case or the other.
 */

export type CashCase = "burn" | "heavy-investment" | "none";

export type BurnBasis = "this quarter" | "four-quarter average";

/**
 * What the runway divides: cash and short-term investments, or cash alone.
 *
 * - "cash-and-short-term-investments": both filed for the quarter.
 * - "cash-only-not-filed": the filer never reports short-term investments,
 *   so cash is all there is and nothing needs saying.
 * - "cash-only-missing-this-quarter": the filer reports them, but not for
 *   this quarter. Cash alone is used and the text says so, because the
 *   runway is then understated by an amount nobody can see.
 */
export type LiquidityBasis =
  | "cash-and-short-term-investments"
  | "cash-only-not-filed"
  | "cash-only-missing-this-quarter";

export interface CashPosition {
  case: CashCase;

  // --- the burn case ------------------------------------------------------
  /**
   * This quarter's burn, as a positive number. Measured on free cash flow,
   * not on operating cash flow alone: a company funding capex out of a
   * shrinking cash pile is spending that cash whatever line it leaves on.
   */
  latestBurn: number | undefined;
  /**
   * The four-quarter average burn, as a positive number. Undefined when
   * any of the four quarters is unfiled (a missing value stays missing;
   * averaging three quarters and calling it four would understate it), and
   * undefined when the four quarters were cash-positive on average, since
   * that is not a burn.
   */
  averageBurn: number | undefined;
  /** The larger of the two: the divisor the rule actually uses. */
  burnUsed: number | undefined;
  /** Which measure won, so the readout can name it. */
  burnBasis: BurnBasis | undefined;
  cash: number | undefined;
  /** Short-term investments added to cash, when filed for the quarter. */
  shortTermInvestments?: number;
  /** What the runway divides (the burn case, with a burn measured, only). */
  liquidityBasis?: LiquidityBasis;
  /** Cash plus short-term investments, or cash alone -- the numerator. */
  liquidity?: number;
  /**
   * Whole quarters of runway.
   *
   * Floored, not rounded: 13.5 quarters of cash is thirteen quarters they
   * can certainly fund and a fourteenth they cannot. Flooring never moves
   * a company across a declared threshold either -- both thresholds are
   * whole quarters, so `Math.floor(x) < k` and `x < k` are the same test.
   */
  quarters: number | undefined;

  // --- the heavy-investment case -----------------------------------------
  capitalExpenditure: number | undefined;
  operatingCashFlow: number | undefined;
  capitalExpenditureYearAgo: number | undefined;
  operatingCashFlowYearAgo: number | undefined;
}

const NONE: CashPosition = {
  case: "none",
  latestBurn: undefined,
  averageBurn: undefined,
  burnUsed: undefined,
  burnBasis: undefined,
  cash: undefined,
  quarters: undefined,
  capitalExpenditure: undefined,
  operatingCashFlow: undefined,
  capitalExpenditureYearAgo: undefined,
  operatingCashFlowYearAgo: undefined,
};

export function computeCashPosition(kf: KeyFinancials): CashPosition {
  const operatingCashFlow = kf.operatingCashFlow.values[0]?.value;
  const latestFcf = kf.freeCashFlow.values[0]?.value;

  // Neither case can be decided without knowing which way operations went.
  if (operatingCashFlow === undefined) return NONE;

  if (operatingCashFlow > 0) {
    if (latestFcf === undefined || latestFcf >= 0) return NONE;
    return {
      ...NONE,
      case: "heavy-investment",
      capitalExpenditure: kf.capitalExpenditures.values[0]?.value,
      operatingCashFlow,
      capitalExpenditureYearAgo: kf.capitalExpenditures.values[4]?.value,
      operatingCashFlowYearAgo: kf.operatingCashFlow.values[4]?.value,
    };
  }

  // Exactly zero is not negative. It is not a burn, and with free cash
  // flow at or below it there is nothing being invested either.
  if (operatingCashFlow === 0) return NONE;

  // Operating cash flow is negative, so free cash flow is too (capex is
  // never negative) -- unless capex is unfiled, in which case the burn
  // cannot be measured and the runway stays missing.
  if (latestFcf === undefined) {
    return { ...NONE, case: "burn", cash: kf.cash.values[0]?.value, operatingCashFlow };
  }

  const latestBurn = -latestFcf;

  const window = kf.freeCashFlow.values.slice(0, 4);
  let averageBurn: number | undefined;
  if (window.length === 4 && window.every((v) => v !== undefined)) {
    const mean = window.reduce((sum, v) => sum + v!.value, 0) / 4;
    if (mean < 0) averageBurn = -mean;
  }

  const useAverage = averageBurn !== undefined && averageBurn > latestBurn;
  const burnUsed = useAverage ? averageBurn! : latestBurn;
  const burnBasis: BurnBasis = useAverage ? "four-quarter average" : "this quarter";

  // Runway = (cash + short-term investments) ÷ the burn. Short-term
  // investments are as liquid as the rule needs: a company burning cash
  // sells them before it runs out. Never filed: cash alone. Filed but not
  // for this quarter: cash alone, flagged, so the text can say so.
  const cash = kf.cash.values[0]?.value;
  const sti = kf.shortTermInvestments.values[0]?.value;
  const liquidityBasis: LiquidityBasis = !kf.shortTermInvestmentsFiledEver
    ? "cash-only-not-filed"
    : sti === undefined
      ? "cash-only-missing-this-quarter"
      : "cash-and-short-term-investments";
  const liquidity = cash === undefined ? undefined : cash + (sti ?? 0);
  const quarters = liquidity === undefined ? undefined : Math.floor(liquidity / burnUsed);

  const out: CashPosition = {
    ...NONE,
    case: "burn",
    latestBurn,
    averageBurn,
    burnUsed,
    burnBasis,
    cash,
    liquidityBasis,
    quarters,
    operatingCashFlow,
  };
  if (sti !== undefined) out.shortTermInvestments = sti;
  if (liquidity !== undefined) out.liquidity = liquidity;
  return out;
}

/**
 * "Cash and short-term investments cover" or "Cash covers": the subject
 * and verb of every runway sentence, from what the runway divided.
 */
export function runwaySubject(position: CashPosition): string {
  return position.liquidityBasis === "cash-and-short-term-investments"
    ? "Cash and short-term investments cover"
    : "Cash covers";
}

/** The clause the text adds when short-term investments are filed but not for this quarter; empty otherwise. */
export function runwayCaveat(position: CashPosition): string {
  return position.liquidityBasis === "cash-only-missing-this-quarter"
    ? "; short-term investments are not filed for this quarter, so cash alone is counted"
    : "";
}

const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

function inWords(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

/**
 * Runway as a bare duration in words, for the Summary.
 *
 * The Summary carries no ratio values, but "a duration in words is
 * allowed" -- so thirteen quarters of cash reads as "more than three
 * years" there, while the "What stands out" item beside it is free to
 * print the quarter count itself.
 *
 * Bare, with no trailing "of runway", because the Summary builds it into
 * a clause of its own ("cash covers more than three years at the current
 * burn") and a noun phrase cannot be spliced onto a clause.
 */
export function runwayInWords(quarters: number | undefined): string | undefined {
  if (quarters === undefined) return undefined;
  if (quarters < 4) return "less than a year";
  const years = Math.floor(quarters / 4);
  if (years >= 10) return "more than ten years";
  const exact = quarters % 4 === 0;
  return `${exact ? "about" : "more than"} ${inWords(years)} year${years === 1 ? "" : "s"}`;
}
