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
 *   never filed (and the bar is labelled "Cash"), or when they are filed
 *   but not for this quarter (and the components line says so).
 * - Debt is long-term debt including the part due within a year, plus
 *   short-term borrowings. Leases are excluded. A row the filer uses that
 *   is missing for the quarter makes debt, and the net figure, MISSING. A
 *   filer that has tagged neither shows "No debt tagged", with no bar and
 *   no net figure.
 */

export type PartState = "included" | "missing" | "not-tagged";

export interface LiquidityPeriod {
  label: string;
  periodEnd: string;
  cash: number | undefined;
  shortTermInvestments: number | undefined;
  /** "not-tagged": short-term investments are never filed, so cash is all there is. */
  stiState: PartState;
  /** Cash plus short-term investments (or cash alone); undefined when cash is missing. */
  liquidity: number | undefined;
  longTermDebt: number | undefined;
  ltdState: PartState;
  shortTermBorrowings: number | undefined;
  stbState: PartState;
  /** Undefined when a debt row the filer uses is missing, or no debt is tagged. */
  debt: number | undefined;
  /** Debt − liquidity: positive is Net Debt, otherwise Net Cash. Undefined when either side is. */
  net: number | undefined;
}

export interface LiquidityDebt {
  /** False when the filer has tagged no debt at all: "No debt tagged". */
  debtTagged: boolean;
  /** Short-term investments are filed at some point, so the bar is "Cash and short-term investments". */
  stiFiledEver: boolean;
  latest: LiquidityPeriod;
  yearAgo: LiquidityPeriod;
  /** $M with one decimal when quarterly revenue is under $100M, otherwise $B with one decimal. */
  scale: "B" | "M";
}

const SMALL_REVENUE_USD = 100_000_000;

function at(row: StatementRow | undefined, i: number): number | undefined {
  const c = row?.quarterly[i];
  return isValue(c) ? c.value : undefined;
}

/** A row the filer uses within the five quarters shown. */
function usedInWindow(row: StatementRow | undefined): boolean {
  return !!row && !row.notFiled && row.quarterly.some(isValue);
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

  const period = (i: number): LiquidityPeriod => {
    const cash = at(cashRow, i);
    const sti = at(stiRow, i);
    const stiState: PartState = !stiFiledEver ? "not-tagged" : sti === undefined ? "missing" : "included";
    const liquidity = cash === undefined ? undefined : cash + (sti ?? 0);

    const ltd = at(ltdRow, i);
    const stb = at(stbRow, i);
    const ltdState: PartState = !ltdTagged ? "not-tagged" : ltd === undefined ? "missing" : "included";
    const stbState: PartState = !stbTagged ? "not-tagged" : stb === undefined ? "missing" : "included";
    const debt =
      !debtTagged || ltdState === "missing" || stbState === "missing" ? undefined : (ltd ?? 0) + (stb ?? 0);
    const net = debt === undefined || liquidity === undefined ? undefined : debt - liquidity;

    return {
      label: kf.quarters[i]?.label ?? "",
      periodEnd: kf.quarters[i]?.periodEnd ?? "",
      cash,
      shortTermInvestments: sti,
      stiState,
      liquidity,
      longTermDebt: ltd,
      ltdState,
      shortTermBorrowings: stb,
      stbState,
      debt,
      net,
    };
  };

  const revenue = kf.revenue.values[0]?.value;
  return {
    debtTagged,
    stiFiledEver,
    latest: period(0),
    yearAgo: period(4),
    scale: revenue !== undefined && Math.abs(revenue) < SMALL_REVENUE_USD ? "M" : "B",
  };
}

/** "$123.0B", or "$35.5M" for a small filer; "MISSING" when absent. */
export function liquidityAmount(value: number | undefined, scale: "B" | "M"): string {
  if (value === undefined) return "MISSING";
  const divisor = scale === "B" ? 1_000_000_000 : 1_000_000;
  const text = (Math.abs(value) / divisor).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${value < 0 ? "−" : ""}$${text}${scale}`;
}

/** "Net Debt $10.3B" or "Net Cash $36.9B"; undefined when there is no net figure to state. */
export function netText(p: LiquidityPeriod, scale: "B" | "M"): string | undefined {
  if (p.net === undefined) return undefined;
  return p.net > 0 ? `Net Debt ${liquidityAmount(p.net, scale)}` : `Net Cash ${liquidityAmount(-p.net, scale)}`;
}

/** The liquidity bar's label: "Cash" when short-term investments are never filed. */
export function liquidityLabel(l: LiquidityDebt): string {
  return l.stiFiledEver ? "Cash and short-term investments" : "Cash";
}

/**
 * The header's right side: "Net Debt $10.3B" then " · Net Cash $36.9B a
 * year ago" (muted on the page). No net figure when no debt is tagged.
 */
export function netHeader(l: LiquidityDebt): { now: string; yearAgo: string } {
  if (!l.debtTagged) return { now: "No debt tagged", yearAgo: "" };
  return {
    now: netText(l.latest, l.scale) ?? "Net MISSING",
    yearAgo: ` · ${netText(l.yearAgo, l.scale) ?? "MISSING"} a year ago`,
  };
}

/**
 * The components line for the latest quarter: "Q2 FY26: cash $78.2B +
 * short-term investments $44.8B · long-term debt, incl. the part due within
 * a year, $133.0B + short-term borrowings $0.3B. Leases excluded."
 */
export function componentsLine(l: LiquidityDebt): string {
  const p = l.latest;
  const $ = (v: number | undefined) => liquidityAmount(v, l.scale);
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
  const $ = (v: number | undefined) => liquidityAmount(v, l.scale);
  if (!l.debtTagged) return `Liquidity vs debt: ${$(l.latest.liquidity)}; no debt tagged.`;
  const now = netText(l.latest, l.scale) ?? "Net MISSING";
  const then = netText(l.yearAgo, l.scale) ?? "MISSING";
  return `Liquidity vs debt: ${$(l.latest.liquidity)} vs ${$(l.latest.debt)}, ${now} (${then} a year ago).`;
}

export const LIQUIDITY_TIP =
  "Cash and short-term investments against borrowings. Debt is long-term debt including the part due within a year, plus short-term borrowings; leases are excluded. Net Debt = debt − cash and short-term investments. The runway uses the same cash and short-term investments.";
