/**
 * Display rules from the spec's Presentation section. Everything here is
 * pure formatting -- it never changes a figure, only how it reads.
 */

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The minus sign used everywhere on screen: U+2212, not a hyphen. */
export const MINUS = "−";

export interface Unit {
  /** Goes in the section title, e.g. "$ millions". */
  label: string;
  divisor: number;
  decimals: number;
}

/**
 * "The unit is in the section title, not only in a table corner. When the
 * latest quarter's revenue is under $100M, figures show one decimal."
 *
 * The unit itself stays $ millions for every company -- switching a small
 * filer to thousands would make two tickers' tables unreadable side by
 * side. What changes is precision: at NAII's ~$35M a quarter, whole
 * millions would round SG&A and R&D into each other.
 */
export const MILLIONS: Unit = { label: "$ millions", divisor: 1_000_000, decimals: 0 };
export const MILLIONS_1DP: Unit = { label: "$ millions", divisor: 1_000_000, decimals: 1 };

const ONE_DECIMAL_BELOW_USD = 100_000_000;

export function chooseUnit(latestQuarterRevenue: number | undefined): Unit {
  if (latestQuarterRevenue !== undefined && Math.abs(latestQuarterRevenue) < ONE_DECIMAL_BELOW_USD) {
    return MILLIONS_1DP;
  }
  return MILLIONS;
}

/**
 * A figure in the table's unit. Negatives carry a real minus sign; the
 * caller paints them red (see isNegative) -- colour is a component
 * concern, the string is not.
 */
export function formatMoney(value: number | undefined, unit: Unit = MILLIONS): string {
  if (value === undefined) return "MISSING";
  const scaled = value / unit.divisor;
  const text = Math.abs(scaled).toLocaleString("en-US", {
    minimumFractionDigits: unit.decimals,
    maximumFractionDigits: unit.decimals,
  });
  // -0.04 rounds to "0.0"; don't print a minus sign on a displayed zero.
  const isZeroOnScreen = Number(text.replace(/,/g, "")) === 0;
  return scaled < 0 && !isZeroOnScreen ? `${MINUS}${text}` : text;
}

export function isNegative(value: number | undefined): boolean {
  return value !== undefined && value < 0;
}

export function formatPct(value: number | undefined, digits = 1): string {
  if (value === undefined) return "MISSING";
  const text = Math.abs(value).toFixed(digits);
  return `${value < 0 ? MINUS : "+"}${text}%`;
}

/**
 * What a change column shows when either figure is missing. MISSING is a
 * statement about a filed figure; a change between two figures, one of
 * which isn't there, is not missing -- it doesn't exist, and a second
 * MISSING beside the first reads as a second gap in the filings.
 */
export const NO_CHANGE = "—";

export function formatPts(value: number | undefined, digits = 1): string {
  if (value === undefined) return NO_CHANGE;
  const text = Math.abs(value).toFixed(digits);
  return `${value < 0 ? MINUS : "+"}${text} pts`;
}

export function pctChange(current: number | undefined, base: number | undefined): number | undefined {
  if (current === undefined || base === undefined || base === 0) return undefined;
  return ((current - base) / Math.abs(base)) * 100;
}

export type ChangeKind = "pct" | "absolute" | "missing";

export interface Change {
  text: string;
  kind: ChangeKind;
}

/**
 * "Changes on a negative or zero base: when either value is negative or
 * zero, or the sign flips, the change is shown in dollars, not %.
 * Percentages are shown only when both values are positive."
 *
 * A percentage needs a positive base to mean anything. Operating income
 * going from −13 to −16 is not "−23% worse" and it is certainly not the
 * "+23%" that dividing by a negative base produces; it is 3 further into
 * the red. Requiring BOTH values positive covers the sign-flip case for
 * free -- if the sign flipped, one of them isn't positive.
 */
export function formatChange(
  current: number | undefined,
  base: number | undefined,
  unit: Unit = MILLIONS
): Change {
  if (current === undefined || base === undefined) return { text: NO_CHANGE, kind: "missing" };
  if (current > 0 && base > 0) {
    return { text: formatPct(pctChange(current, base)), kind: "pct" };
  }
  const delta = current - base;
  const magnitude = formatMoney(Math.abs(delta), unit);
  return { text: `${delta < 0 ? MINUS : "+"}${magnitude}`, kind: "absolute" };
}

/** "2026-07-26" -> "Jul 26, 2026" -- every column header carries one. */
export function formatPeriodEnd(iso: string | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${MONTHS_SHORT[m - 1]} ${d}, ${y}`;
}

/** "2026-04-27".."2026-07-26" -> "Apr–Jul 2026"; same month/year collapses. */
export function formatPeriodRange(startIso: string | undefined, endIso: string | undefined): string {
  if (!startIso || !endIso) return "";
  const [sy, sm] = startIso.split("-").map(Number);
  const [ey, em] = endIso.split("-").map(Number);
  if (!sy || !sm || !ey || !em) return "";
  if (sy === ey && sm === em) return `${MONTHS_SHORT[sm - 1]} ${sy}`;
  if (sy === ey) return `${MONTHS_SHORT[sm - 1]}${"–"}${MONTHS_SHORT[em - 1]} ${ey}`;
  return `${MONTHS_SHORT[sm - 1]} ${sy}${"–"}${MONTHS_SHORT[em - 1]} ${ey}`;
}

/**
 * The day after a period end, i.e. where the next period starts. Quarter
 * start dates aren't filed as such: a quarter runs from the day after the
 * previous quarter ended.
 */
export function dayAfter(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso + "T00:00:00Z");
  if (Number.isNaN(t)) return undefined;
  return new Date(t + 86_400_000).toISOString().slice(0, 10);
}

/**
 * A figure inside prose (segment lines, notes), in the table's unit so the
 * two never disagree: "$88,300M", "$35.5M". The table prints bare numbers
 * under a unit heading; prose has no heading to lean on.
 */
export function formatMoneyInline(value: number | undefined, unit: Unit = MILLIONS): string {
  if (value === undefined) return "MISSING";
  const scaled = value / unit.divisor;
  return `${scaled < 0 ? MINUS : ""}$${formatMoney(Math.abs(value), unit)}M`;
}
