import { KeyFinancials } from "@/lib/xbrl/keyFinancials";
import { isValue, StatementRow, Statements } from "@/lib/xbrl/statements";

/**
 * Liquidity vs debt: the strip under the Financial health tiles.
 *
 * Two periods, the latest quarter and the same quarter last year, each with
 * cash and short-term investments against debt. Every figure is a filed
 * balance-sheet row the Balance sheet tab already shows; nothing here is a
 * rule input. It moves no rung, no quadrant, no Summary and no finding.
 *
 * - Liquidity is the runway's figure with the runway's rule: cash plus
 *   short-term investments; cash alone when short-term investments are
 *   never filed, or when they are filed but not for this quarter. Either
 *   way the bar is labelled "Cash". Only the first is complete liquidity:
 *   a filer that holds short-term investments but didn't file them for
 *   the quarter has a cash-only figure that can flip Net Debt into Net
 *   Cash, so that period's net figure is MISSING and the components line
 *   says why. (The runway keeps its cash-only fallback, which can only
 *   understate it.)
 * - Debt is long-term debt including the part due within a year, plus
 *   short-term borrowings. Leases are excluded. A row the filer uses that
 *   is missing for the quarter makes debt, and the net figure, MISSING. A
 *   filer that has tagged neither shows "No debt tagged", with no bar and
 *   no net figure.
 * - Units are per period: $M when the larger of the period's two amounts
 *   is under $1B (whole numbers, or one decimal when quarterly revenue is
 *   under $100M), otherwise $B with one decimal.
 */

export type PartState = "included" | "missing" | "not-tagged";

/** How a period's amounts are written: "$1.2B", "$845M" or "$35.5M". */
export interface StripUnit {
  scale: "B" | "M";
  decimals: 0 | 1;
}

export interface LiquidityPeriod {
  label: string;
  periodEnd: string;
  cash: number | undefined;
  shortTermInvestments: number | undefined;
  /** "not-tagged": short-term investments are never filed, so cash is all there is. */
  stiState: PartState;
  /** Cash plus short-term investments (or cash alone); undefined when cash is missing. */
  liquidity: number | undefined;
  /** Cash plus short-term investments, or cash when they are never filed: the figure a net can rest on. */
  liquidityComplete: boolean;
  longTermDebt: number | undefined;
  ltdState: PartState;
  shortTermBorrowings: number | undefined;
  stbState: PartState;
  /** Undefined when a debt row the filer uses is missing, or no debt is tagged. */
  debt: number | undefined;
  /**
   * Debt − liquidity: positive is Net Debt, otherwise Net Cash. Undefined
   * when either side is, or when liquidity is cash alone because
   * short-term investments aren't filed for the quarter.
   */
  net: number | undefined;
  unit: StripUnit;
}

export interface LiquidityDebt {
  /** False when the filer has tagged no debt at all: "No debt tagged". */
  debtTagged: boolean;
  /** Short-term investments are filed at some point, so the bar is "Cash and short-term investments". */
  stiFiledEver: boolean;
  latest: LiquidityPeriod;
  yearAgo: LiquidityPeriod;
}

const SMALL_REVENUE_USD = 100_000_000;
const BILLION = 1_000_000_000;

function at(row: StatementRow | undefined, i: number): number | undefined {
  const c = row?.quarterly[i];
  return isValue(c) ? c.value : undefined;
}

/** A row the filer uses within the five quarters shown. */
function usedInWindow(row: StatementRow | undefined): boolean {
  return !!row && !row.notFiled && row.quarterly.some(isValue);
}

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

export function buildLiquidityDebt(s: Statements, kf: KeyFinancials): LiquidityDebt {
  const bs = (key: string) => s.balance.find((r) => r.key === key);
  const cashRow = bs("cash");
  const stiRow = bs("shortTermInvestments");
  const ltdRow = bs("longTermDebt");
  const stbRow = bs("shortTermBorrowings");

  const stiFiledEver = kf.shortTermInvestmentsFiledEver;
  // Long-term debt reads the same flag debt / equity does: any of its own
  // tags on a balance sheet inside the lookback. Short-term borrowings count
  // when the filer uses the row in the quarters shown.
  const ltdTagged = kf.debtTagFiledInLookback;
  const stbTagged = usedInWindow(stbRow);
  const debtTagged = ltdTagged || stbTagged;

  const revenue = kf.revenue.values[0]?.value;

  const period = (i: number): LiquidityPeriod => {
    const cash = at(cashRow, i);
    const sti = at(stiRow, i);
    const stiState: PartState = !stiFiledEver ? "not-tagged" : sti === undefined ? "missing" : "included";
    const liquidity = cash === undefined ? undefined : cash + (sti ?? 0);
    const liquidityComplete = stiState !== "missing";

    const ltd = at(ltdRow, i);
    const stb = at(stbRow, i);
    const ltdState: PartState = !ltdTagged ? "not-tagged" : ltd === undefined ? "missing" : "included";
    const stbState: PartState = !stbTagged ? "not-tagged" : stb === undefined ? "missing" : "included";
    const debt =
      !debtTagged || ltdState === "missing" || stbState === "missing" ? undefined : (ltd ?? 0) + (stb ?? 0);
    const net = debt === undefined || liquidity === undefined || !liquidityComplete ? undefined : debt - liquidity;

    return {
      label: kf.quarters[i]?.label ?? "",
      periodEnd: kf.quarters[i]?.periodEnd ?? "",
      cash,
      shortTermInvestments: sti,
      stiState,
      liquidity,
      liquidityComplete,
      longTermDebt: ltd,
      ltdState,
      shortTermBorrowings: stb,
      stbState,
      debt,
      net,
      unit: stripUnit([liquidity, debt], revenue),
    };
  };

  return {
    debtTagged,
    stiFiledEver,
    latest: period(0),
    yearAgo: period(4),
  };
}

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

/** A period's liquidity bar label: "Cash" unless short-term investments are in the figure. */
export function liquidityLabel(p: LiquidityPeriod): string {
  return p.stiState === "included" ? "Cash and short-term investments" : "Cash";
}

/**
 * The header's right side: "Net Debt $10.3B" then " · Net Cash $36.9B a
 * year ago" (muted on the page). No net figure when no debt is tagged.
 */
export function netHeader(l: LiquidityDebt): { now: string; yearAgo: string } {
  if (!l.debtTagged) return { now: "No debt tagged", yearAgo: "" };
  return {
    now: netText(l.latest) ?? "Net MISSING",
    yearAgo: ` · ${netText(l.yearAgo) ?? "MISSING"} a year ago`,
  };
}

/**
 * The components line for the latest quarter: "Q2 FY26: cash $78.2B +
 * short-term investments $44.8B · long-term debt, incl. the part due within
 * a year, $133.0B + short-term borrowings $0.3B. Leases excluded."
 */
export function componentsLine(l: LiquidityDebt): string {
  const p = l.latest;
  const $ = (v: number | undefined) => liquidityAmount(v, p.unit);
  const liquidity =
    p.stiState === "included"
      ? `cash ${$(p.cash)} + short-term investments ${$(p.shortTermInvestments)}`
      : p.stiState === "missing"
        ? `cash ${$(p.cash)} (short-term investments not filed for this quarter, so cash only)`
        : `cash ${$(p.cash)}`;

  let debt: string;
  if (!l.debtTagged) {
    debt = "no debt tagged";
  } else {
    const parts: string[] = [];
    if (p.ltdState !== "not-tagged") parts.push(`long-term debt, incl. the part due within a year, ${$(p.longTermDebt)}`);
    if (p.stbState !== "not-tagged") parts.push(`short-term borrowings ${$(p.shortTermBorrowings)}`);
    debt = parts.join(" + ");
    if (p.ltdState === "not-tagged") debt += "; no long-term debt tagged";
    if (p.stbState === "not-tagged") debt += "; no short-term borrowings tagged";
  }
  const yearAgoNote =
    l.yearAgo.stiState === "missing" && l.yearAgo.label
      ? ` ${l.yearAgo.label}: short-term investments not filed, so cash only.`
      : "";
  return `${p.label}: ${liquidity} · ${debt}. Leases excluded.${yearAgoNote}`;
}

/** The Copy brief's line: "Liquidity vs debt: $123.0B vs $133.3B, Net Debt $10.3B (Net Cash $36.9B a year ago)." */
export function liquidityBriefLine(l: LiquidityDebt): string {
  const p = l.latest;
  const $ = (v: number | undefined) => liquidityAmount(v, p.unit);
  const liquidity =
    p.stiState === "missing" ? `cash ${$(p.liquidity)} (short-term investments not filed for this quarter)` : $(p.liquidity);
  if (!l.debtTagged) return `Liquidity vs debt: ${liquidity}; no debt tagged.`;
  const now = netText(p) ?? "Net MISSING";
  const then = netText(l.yearAgo) ?? "MISSING";
  return `Liquidity vs debt: ${liquidity} vs ${$(p.debt)}, ${now} (${then} a year ago).`;
}

export const LIQUIDITY_TIP =
  "Cash and short-term investments against borrowings. Debt is long-term debt including the part due within a year, plus short-term borrowings; leases are excluded. Net Debt = debt − cash and short-term investments. The runway uses the same cash and short-term investments.";
