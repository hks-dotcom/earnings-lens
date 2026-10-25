import type { SegmentRevenue } from "@/lib/xbrl/segments";

/** Rules 17.6: the segments must reconcile to total revenue within this much to be shown. */
export const RECONCILE_TOLERANCE_USD = 1_000_000;

/**
 * The operating-segments split the page shows (rules 10, 17.6), or null
 * when the section is hidden: fewer than two segments, none filed, no
 * total to take shares of, or filed amounts that do not sum to total
 * revenue within $1M. An annual-only split reconciles to the fiscal
 * year's revenue, a quarterly one to the quarter's.
 */
export function segmentSplit(
  seg: SegmentRevenue | null,
  quarterRevenue: number | undefined,
  yearRevenue: number | undefined
): { total: number; values: { member: string; value: number }[] } | null {
  if (!seg || !seg.axis || seg.values.length < 2) return null;
  const total = seg.periodKind === "annual-only" ? yearRevenue : quarterRevenue;
  if (total === undefined) return null;
  const sum = seg.values.reduce((t, v) => t + v.value, 0);
  if (Math.abs(sum - total) > RECONCILE_TOLERANCE_USD) return null;
  return { total, values: seg.values.map((v) => ({ member: v.member, value: v.value })) };
}
