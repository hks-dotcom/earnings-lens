import { FilingInstance } from "@/lib/edgar/xbrlInstance";
import { DURATION_CONCEPTS } from "@/lib/xbrl/concepts";
import { DURATION_WINDOWS, FilingPeriod } from "@/lib/xbrl/periods";

/**
 * Axis priority: a filer's actual reportable business segments
 * (us-gaap:StatementBusinessSegmentsAxis, e.g. NVIDIA's "Compute &
 * Networking" / "Graphics") take precedence over a looser product/market
 * disaggregation (srt:ProductOrServiceAxis, e.g. NVIDIA's "Data Center" /
 * "Edge Computing" -- what the mock happens to show, sourced from the 8-K).
 * We report whichever axis actually has revenue facts for the target
 * period, tried in this order, and always say which one it was.
 */
export const SEGMENT_AXIS_PRIORITY = [
  "us-gaap:StatementBusinessSegmentsAxis",
  "srt:ProductOrServiceAxis",
] as const;

export type SegmentAxis = (typeof SEGMENT_AXIS_PRIORITY)[number];

export interface SegmentFact {
  member: string;
  value: number;
  concept: string;
  method: "direct" | "derived-quarterly";
  periodStart?: string;
  periodEnd: string;
}

export interface SegmentRevenue {
  axis: SegmentAxis | null;
  /**
   * "direct": a filed 3-month figure for this exact quarter.
   * "annual-only": only the 10-K's full-year note is filed and Q1-Q3 of
   *   the same fiscal year couldn't be found/derived, so these are FY
   *   totals, not this quarter's revenue -- do not sum against a quarterly
   *   total revenue figure.
   * "derived-quarterly": a 10-K-only quarter (Q4) with its discrete revenue
   *   derived as (FY annual − Q1 − Q2 − Q3), matching the same derivation
   *   the main P&L rows use. Every value's own `method` will say
   *   "derived-quarterly" too.
   */
  periodKind: "direct" | "annual-only" | "derived-quarterly" | null;
  values: SegmentFact[];
}

const IGNORABLE_COMPANION_AXES = new Set(["srt:ConsolidationItemsAxis"]);

function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / 86400000);
}

/**
 * Extracts segment revenue facts from ONE instance document for a specific
 * axis and duration window (quarterly or annual), for a specific concept
 * (same tag-priority order as the top-level revenue line -- commits to the
 * first candidate concept that has any matching facts, rather than mixing
 * concepts within one segment breakdown).
 */
function extractForAxis(
  instance: FilingInstance,
  periodEnd: string,
  axis: SegmentAxis,
  window: [number, number]
): { concept: string; values: SegmentFact[] } | undefined {
  for (const suffix of DURATION_CONCEPTS.revenue) {
    const concept = `us-gaap:${suffix}`;
    const matches: SegmentFact[] = [];
    for (const fact of instance.facts) {
      if (fact.concept !== concept) continue;
      const ctx = instance.contexts.get(fact.contextRef);
      if (!ctx || ctx.end !== periodEnd || !ctx.start) continue;
      const member = ctx.members[axis];
      if (!member) continue;
      const extraAxes = Object.keys(ctx.members).filter(
        (a) => a !== axis && !IGNORABLE_COMPANION_AXES.has(a)
      );
      if (extraAxes.length > 0) continue;
      const days = daysBetween(ctx.start, ctx.end);
      if (days < window[0] || days > window[1]) continue;
      matches.push({
        member,
        value: fact.value,
        concept,
        method: "direct",
        periodStart: ctx.start,
        periodEnd: ctx.end,
      });
    }
    if (matches.length > 0) {
      const seen = new Set<string>();
      const deduped = matches.filter((m) => (seen.has(m.member) ? false : (seen.add(m.member), true)));
      return { concept, values: deduped };
    }
  }
  return undefined;
}

/**
 * Segment revenue for one displayed quarter, reading straight from that
 * filing's own XBRL instance document (never R-files). For a 10-Q, this is
 * the filed 3-month figure. For a 10-K (Q4, which EDGAR never files
 * standalone), the annual segment note gives only the full-year figure --
 * this derives the discrete Q4 by fetching Q1-Q3's own instances (of the
 * same fiscal year) and subtracting, exactly mirroring the main P&L rows'
 * annual-minus-9mo derivation. Falls back to reporting the annual figure
 * (clearly labeled, not summed against quarterly total revenue) if Q1-Q3
 * can't all be resolved.
 */
export async function extractSegmentRevenueForPeriod(
  period: FilingPeriod,
  allPeriods: FilingPeriod[],
  getInstance: (period: FilingPeriod) => Promise<FilingInstance>
): Promise<SegmentRevenue> {
  const instance = await getInstance(period);

  if (period.fp !== "FY") {
    for (const axis of SEGMENT_AXIS_PRIORITY) {
      const found = extractForAxis(instance, period.filing.reportDate, axis, DURATION_WINDOWS.Q1);
      if (found) return { axis, periodKind: "direct", values: found.values };
    }
    return { axis: null, periodKind: null, values: [] };
  }

  // FY (10-K): try to derive the discrete Q4 from the annual note.
  for (const axis of SEGMENT_AXIS_PRIORITY) {
    const annual = extractForAxis(instance, period.filing.reportDate, axis, DURATION_WINDOWS.FY);
    if (!annual) continue;

    const q1p = allPeriods.find((p) => p.fy === period.fy && p.fp === "Q1");
    const q2p = allPeriods.find((p) => p.fy === period.fy && p.fp === "Q2");
    const q3p = allPeriods.find((p) => p.fy === period.fy && p.fp === "Q3");
    if (!q1p || !q2p || !q3p) {
      return {
        axis,
        periodKind: "annual-only",
        values: annual.values.map((v) => ({ ...v, method: "direct" as const })),
      };
    }

    const [q1inst, q2inst, q3inst] = await Promise.all([
      getInstance(q1p),
      getInstance(q2p),
      getInstance(q3p),
    ]);
    const q1 = extractForAxis(q1inst, q1p.filing.reportDate, axis, DURATION_WINDOWS.Q1);
    const q2 = extractForAxis(q2inst, q2p.filing.reportDate, axis, DURATION_WINDOWS.Q1);
    const q3 = extractForAxis(q3inst, q3p.filing.reportDate, axis, DURATION_WINDOWS.Q1);
    if (!q1 || !q2 || !q3) {
      return {
        axis,
        periodKind: "annual-only",
        values: annual.values.map((v) => ({ ...v, method: "direct" as const })),
      };
    }

    const derived: SegmentFact[] = [];
    for (const a of annual.values) {
      const v1 = q1.values.find((v) => v.member === a.member);
      const v2 = q2.values.find((v) => v.member === a.member);
      const v3 = q3.values.find((v) => v.member === a.member);
      if (v1 && v2 && v3) {
        derived.push({
          member: a.member,
          value: a.value - v1.value - v2.value - v3.value,
          concept: a.concept,
          method: "derived-quarterly",
          // No single true start date for a subtraction result.
          periodStart: undefined,
          periodEnd: a.periodEnd,
        });
      }
    }
    if (derived.length > 0) return { axis, periodKind: "derived-quarterly", values: derived };
  }
  return { axis: null, periodKind: null, values: [] };
}

/**
 * Forces a specific axis (rather than trying the priority list) -- used to
 * show what a lower-priority axis would give alongside the one actually
 * chosen, for comparison.
 */
export async function extractSegmentRevenueForAxis(
  period: FilingPeriod,
  axis: SegmentAxis,
  getInstance: (period: FilingPeriod) => Promise<FilingInstance>
): Promise<{ values: SegmentFact[]; periodKind: "direct" | "annual-only" } | undefined> {
  const instance = await getInstance(period);
  const window = period.fp === "FY" ? DURATION_WINDOWS.FY : DURATION_WINDOWS.Q1;
  const found = extractForAxis(instance, period.filing.reportDate, axis, window);
  if (!found) return undefined;
  return {
    values: found.values,
    periodKind: period.fp === "FY" ? "annual-only" : "direct",
  };
}
