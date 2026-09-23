import { KeyFinancials, LineItem } from "@/lib/xbrl/keyFinancials";
import { ALTMAN_ZONES } from "@/lib/rules/declaredValues";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(startIso: string, endIso: string): number {
  return Math.round((Date.parse(endIso) - Date.parse(startIso)) / DAY_MS);
}

export type AltmanZoneName = "safe" | "grey" | "distress";

export interface AltmanZoneResult {
  z: number | undefined;
  /** The zone the score alone puts the company in. */
  scored: AltmanZoneName | undefined;
  /** The zone the rules actually use. Differs from `scored` only when the cap applies. */
  zone: AltmanZoneName | undefined;
  /** True when a distress score was lifted to grey because the company is profitable and cash-generative. */
  capped: boolean;
  ttmOperatingIncome: number | undefined;
  ttmFreeCashFlow: number | undefined;
}

/** The sentence the page, the footer and the Copy brief all use when the cap applies. Written once so they cannot drift apart. */
export const ALTMAN_CAP_NOTE =
  "Z'' is in distress, but the company is profitable and cash-generative, so it's treated as grey zone.";

export interface FinancialHealth {
  /** Index-aligned with kf.quarters (0 = latest). undefined where an input is missing. */
  currentRatio: (number | undefined)[];
  debtToEquity: (number | undefined)[];
  /** Days sales outstanding: AR(end) / revenue(quarter) x days-in-quarter. */
  dso: (number | undefined)[];
  /** Days payable outstanding: AP(end) / COGS(quarter) x days-in-quarter. */
  dpo: (number | undefined)[];
  /** Altman Z'' (book-equity, no market cap needed): 6.56 X1 + 3.26 X2 + 6.72 X3 + 1.05 X4, TTM EBIT. */
  altmanZDoublePrime: (number | undefined)[];
  /** The zone each quarter's score lands in, after the profitable-and-cash-generative cap. Index-aligned with kf.quarters. */
  altmanZone: AltmanZoneResult[];
  /** Gross profit / revenue, as a percentage (e.g. 75.0 for 75.0%). */
  grossMarginPct: (number | undefined)[];
  /** Operating income / revenue, as a percentage. */
  operatingMarginPct: (number | undefined)[];
}

/**
 * A margin's point-change ("+0.1 pt") is computed from the DISPLAYED
 * (1-decimal) values, not the underlying full-precision ratio -- matching
 * how the page itself will show it. Two margins that display as "75.0%"
 * and "74.9%" always diff to exactly "+0.1 pt", even if the unrounded
 * ratios would round the point-change itself differently.
 */
export function marginPtsChange(
  current: number | undefined,
  base: number | undefined
): number | undefined {
  if (current === undefined || base === undefined) return undefined;
  const roundedCurrent = Math.round(current * 10) / 10;
  const roundedBase = Math.round(base * 10) / 10;
  return Math.round((roundedCurrent - roundedBase) * 10) / 10;
}

/** Signals read Y/Y (seasonality-proof): DPO 4 quarters back (same quarter last year), not the prior quarter. */
export function dpoVsYearAgo(dpo: (number | undefined)[], i: number): number | undefined {
  const current = dpo[i];
  const yearAgo = dpo[i + 4];
  if (current === undefined || yearAgo === undefined) return undefined;
  return current - yearAgo;
}

function val(line: LineItem, i: number): number | undefined {
  return line.values[i]?.value;
}

/**
 * Trailing-twelve-month sum of a duration line item ending at display index
 * `i`, using the 4 quarters starting at i (this quarter back through 3
 * quarters ago). Returns undefined if any of the 4 quarters is missing --
 * never partial-summed, since that would silently understate TTM.
 */
function ttmSum(line: LineItem, i: number): number | undefined {
  const window = line.values.slice(i, i + 4);
  if (window.length < 4 || window.some((v) => v === undefined)) return undefined;
  return window.reduce((sum, v) => sum + (v as { value: number }).value, 0);
}

function scoredZone(z: number | undefined): AltmanZoneName | undefined {
  if (z === undefined) return undefined;
  if (z > ALTMAN_ZONES.safeAbove) return "safe";
  if (z < ALTMAN_ZONES.distressBelow) return "distress";
  return "grey";
}

/**
 * The zone the rules read, which is the score's own zone except for one
 * cap.
 *
 * Z'' is a balance-sheet score. Two of its four terms -- retained earnings
 * over assets, and equity over liabilities -- punish an accumulated
 * deficit and negative book equity, and a company that has bought back
 * more stock than it has ever earned in book terms scores as distressed
 * while collecting cash every quarter. The score is not wrong; it is
 * answering a different question from the one the ladder asks. So a
 * distress score is lifted to grey -- not to safe -- when the last twelve
 * months show BOTH operating profit and positive free cash flow, and every
 * grey-zone rule then applies unchanged: rising payables still forces
 * Weak, and any red flag still does.
 *
 * Both figures must be present. A missing one is not a passing one, so a
 * company whose capex is untagged keeps its distress score.
 */
function zoneWithCap(
  z: number | undefined,
  ttmOperatingIncome: number | undefined,
  ttmFreeCashFlow: number | undefined
): AltmanZoneResult {
  const scored = scoredZone(z);
  const qualifies =
    scored === "distress" &&
    ttmOperatingIncome !== undefined &&
    ttmOperatingIncome > 0 &&
    ttmFreeCashFlow !== undefined &&
    ttmFreeCashFlow > 0;
  return {
    z,
    scored,
    zone: qualifies ? "grey" : scored,
    capped: qualifies,
    ttmOperatingIncome,
    ttmFreeCashFlow,
  };
}

function periodEndDates(kf: KeyFinancials): string[] {
  // quarters[i].periodEnd for the display window, plus one more from the
  // published list so the oldest displayed quarter still has a "days in
  // quarter" reference point.
  //
  // Published, not lookback: the lookback can lead the displayed quarters
  // by one filing while EDGAR is still aggregating it, and a day count
  // taken between a quarter and someone else's quarter is wrong in a way
  // that shows up as a wrong DSO and DPO rather than as a blank.
  return kf.publishedPeriods.map((p) => p.filing.reportDate);
}

export function computeFinancialHealth(kf: KeyFinancials): FinancialHealth {
  const n = kf.quarters.length;
  const ends = periodEndDates(kf);

  const currentRatio: (number | undefined)[] = [];
  const debtToEquity: (number | undefined)[] = [];
  const dso: (number | undefined)[] = [];
  const dpo: (number | undefined)[] = [];
  const altmanZDoublePrime: (number | undefined)[] = [];
  const altmanZone: AltmanZoneResult[] = [];
  const grossMarginPct: (number | undefined)[] = [];
  const operatingMarginPct: (number | undefined)[] = [];

  for (let i = 0; i < n; i++) {
    const ca = val(kf.currentAssets, i);
    const cl = val(kf.currentLiabilities, i);
    currentRatio.push(ca !== undefined && cl ? ca / cl : undefined);

    const debt = val(kf.longTermDebt, i);
    const equity = val(kf.equity, i);
    debtToEquity.push(debt !== undefined && equity ? debt / equity : undefined);

    const daysInQuarter = ends[i] && ends[i + 1] ? daysBetween(ends[i + 1], ends[i]) : undefined;

    const ar = val(kf.accountsReceivable, i);
    const revenue = val(kf.revenue, i);
    dso.push(
      ar !== undefined && revenue && daysInQuarter ? (ar / revenue) * daysInQuarter : undefined
    );

    const ap = val(kf.accountsPayable, i);
    const cogs = val(kf.costOfRevenue, i);
    dpo.push(ap !== undefined && cogs && daysInQuarter ? (ap / cogs) * daysInQuarter : undefined);

    const ta = val(kf.totalAssets, i);
    const tl = val(kf.totalLiabilities, i);
    const re = val(kf.retainedEarnings, i);
    const ttmEbit = ttmSum(kf.operatingIncome, i);
    if (
      ca !== undefined &&
      cl !== undefined &&
      ta &&
      re !== undefined &&
      ttmEbit !== undefined &&
      equity !== undefined &&
      tl
    ) {
      const x1 = (ca - cl) / ta;
      const x2 = re / ta;
      const x3 = ttmEbit / ta;
      const x4 = equity / tl;
      altmanZDoublePrime.push(6.56 * x1 + 3.26 * x2 + 6.72 * x3 + 1.05 * x4);
    } else {
      altmanZDoublePrime.push(undefined);
    }
    altmanZone.push(zoneWithCap(altmanZDoublePrime[i], ttmEbit, ttmSum(kf.freeCashFlow, i)));

    const marginRevenue = val(kf.revenue, i);
    const gp = val(kf.grossProfit, i);
    grossMarginPct.push(marginRevenue && gp !== undefined ? (gp / marginRevenue) * 100 : undefined);
    const opInc = val(kf.operatingIncome, i);
    operatingMarginPct.push(
      marginRevenue && opInc !== undefined ? (opInc / marginRevenue) * 100 : undefined
    );
  }

  return {
    currentRatio,
    debtToEquity,
    dso,
    dpo,
    altmanZDoublePrime,
    altmanZone,
    grossMarginPct,
    operatingMarginPct,
  };
}

export { ALTMAN_ZONES } from "@/lib/rules/declaredValues";
