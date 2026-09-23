import { LadderRung } from "@/lib/rules/ladder";
import { EngineeringSpendSignal, RetrenchmentSignal, RevenueSignal } from "@/lib/rules/signals";
import { Lens } from "@/lib/rules/dealStructure";

export type Quadrant = "Pursue" | "Pursue with guardrails" | "Monitor" | "Limit exposure";

export interface OpportunityResult {
  high: boolean;
  rule: string;
  /** True when R&D has no filed data at all, so revenue decided alone -- the card should say "R&D not filed". */
  rdNotFiled: boolean;
}

/**
 * High when revenue is up Y/Y (beyond the ±2% band) AND R&D is not down
 * Y/Y. If R&D isn't filed, revenue decides alone. R&D intensity never
 * factors in here -- it's context only (intensity falls whenever revenue
 * outgrows R&D, which isn't a negative). SaaS lens only: retrenchment
 * forces opportunity low outright (a SaaS vendor loses seats now and the
 * renewal later), overriding revenue/R&D entirely.
 */
export function computeOpportunity(
  lens: Lens,
  revenue: RevenueSignal,
  rd: EngineeringSpendSignal,
  retrenchment: RetrenchmentSignal
): OpportunityResult {
  if (lens === "SaaS" && retrenchment.triggered) {
    return {
      high: false,
      rule: `Retrenchment present (${retrenchment.causes.join("; ")}) -- the SaaS lens sets opportunity to low regardless of revenue/R&D.`,
      rdNotFiled: rd.direction === undefined,
    };
  }

  const revenueUp = revenue.direction === "up";
  const revenueDesc = revenue.direction === undefined ? "MISSING" : `${revenue.direction} (${revenue.yoyPct?.toFixed(1)}% Y/Y)`;

  if (rd.direction === undefined) {
    return {
      high: revenueUp,
      rule: `R&D not filed. Revenue ${revenueDesc} decides opportunity alone.`,
      rdNotFiled: true,
    };
  }

  const rdNotDown = rd.direction !== "down";
  const high = revenueUp && rdNotDown;
  return {
    high,
    rule: `Revenue ${revenueDesc} and R&D ${rd.direction} (${rd.yoyPct?.toFixed(1)}% Y/Y) -- ${rdNotDown ? "not down" : "down"}.`,
    rdNotFiled: false,
  };
}

/** The risk reading a reader sees: low, medium or high. */
export type RiskReading = "low" | "medium" | "high";

export interface RiskResult {
  high: boolean;
  rule: string;
  /**
   * The rung as low / medium / high, with spending cuts raising a low
   * reading to medium: they put the company in the higher-risk half of the
   * matrix, so a "low" beside that column would contradict it. Medium and
   * high stay as they are. The display and the terms -- Net 45, the deal
   * structure, the negotiation note -- follow the reading; the rung, the
   * matrix and the quadrant do not change.
   */
  reading: RiskReading;
}

/** Strong → low (medium with spending cuts), Neutral → medium, Weak → high. */
export function riskReading(ladderRung: LadderRung, retrenchment: RetrenchmentSignal): RiskReading {
  if (ladderRung === "Strong") return retrenchment.triggered ? "medium" : "low";
  return ladderRung === "Neutral" ? "medium" : "high";
}

/** High when the ladder rung is Neutral or Weak, OR retrenchment is present (both lenses). Low only when Strong AND no retrenchment. */
export function computeRisk(ladderRung: LadderRung, retrenchment: RetrenchmentSignal): RiskResult {
  const rungHigh = ladderRung !== "Strong";
  const high = rungHigh || retrenchment.triggered;
  let rule: string;
  if (rungHigh && retrenchment.triggered) {
    rule = `Ladder is ${ladderRung} and retrenchment is present.`;
  } else if (rungHigh) {
    rule = `Ladder is ${ladderRung}.`;
  } else if (retrenchment.triggered) {
    rule = `Ladder is Strong, but retrenchment is present (${retrenchment.causes.join("; ")}).`;
  } else {
    rule = "Ladder is Strong and no retrenchment.";
  }
  return { high, rule, reading: riskReading(ladderRung, retrenchment) };
}

/**
 * high+low = Pursue; high+high = Pursue with guardrails; low+low = Monitor;
 * low+high = Limit exposure. The risk axis additionally has three dot
 * positions (Strong/Neutral/Weak) so companies on different rungs never
 * overlap -- a presentation concern; the rung itself is already carried on
 * the ladder result for whoever positions the dot.
 */
export function computeQuadrant(opportunityHigh: boolean, riskHigh: boolean): Quadrant {
  if (!riskHigh) return opportunityHigh ? "Pursue" : "Monitor";
  return opportunityHigh ? "Pursue with guardrails" : "Limit exposure";
}
