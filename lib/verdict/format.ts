/**
 * Number and date formats for the verdict's words (rules 17.4): one decimal
 * for % and points, two for ×, money in $B with one decimal ($M below
 * $1B). Callers check for missing values first; these never fill one in.
 */

export const MINUS = "−";

/** "$161.4B", "−$11.6B", "$812.0M". */
export function money(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? MINUS : "";
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  return `${sign}$${Math.round(a).toLocaleString("en-US")}`;
}

/** "+19.6", "−3.4", "0.0": a change, with its sign. */
export function signed(v: number, digits = 1): string {
  const s = Math.abs(v).toFixed(digits);
  return `${v > 0 && Number(s) !== 0 ? "+" : v < 0 && Number(s) !== 0 ? MINUS : ""}${s}`;
}

/** "20.8", "−1.5": a level, minus sign only. */
export function plain(v: number, digits = 1): string {
  const s = Math.abs(v).toFixed(digits);
  return `${v < 0 && Number(s) !== 0 ? MINUS : ""}${s}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-07-31" -> "Jul 31, 2026"; anything else unchanged. */
export function day(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}
