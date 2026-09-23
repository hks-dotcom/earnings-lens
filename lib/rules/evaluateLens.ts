import { KeyFinancials } from "@/lib/xbrl/keyFinancials";
import { AltmanZoneResult, FinancialHealth } from "@/lib/metrics/health";
import { CompanySubmissions } from "@/lib/edgar/submissions";
import {
  computeRevenueSignal,
  computeEngineeringSpendSignal,
  computeTechInvestmentInfo,
  computePaymentBehaviorSignal,
  computeRetrenchmentSignal,
  RevenueSignal,
  EngineeringSpendSignal,
  TechInvestmentInfo,
  PaymentBehaviorSignal,
  RetrenchmentSignal,
} from "@/lib/rules/signals";
import { computeRedFlags, RedFlagsResult } from "@/lib/rules/redFlags";
import { computeLadder, negotiationNote, LadderResult } from "@/lib/rules/ladder";
import { computeCashPosition, CashPosition } from "@/lib/rules/runway";
import { computeOpportunity, computeRisk, computeQuadrant, OpportunityResult, RiskResult, Quadrant } from "@/lib/rules/matrix";
import { computeDealStructure, DealStructureResult, Lens } from "@/lib/rules/dealStructure";

export interface LensResult {
  lens: Lens;
  revenue: RevenueSignal;
  /** Computed for both lenses -- the matrix's shared opportunity formula reads R&D $ growth regardless of lens; the SaaS lens shows techInvestment (intensity) instead, as context. */
  engineeringSpend: EngineeringSpendSignal;
  techInvestment?: TechInvestmentInfo; // SaaS lens display only
  paymentBehavior: PaymentBehaviorSignal;
  retrenchment: RetrenchmentSignal;
  redFlags: RedFlagsResult;
  altmanZPrime: number | undefined;
  /** The zone the ladder read, and whether a distress score was lifted to grey because the company is profitable and cash-generative. */
  altmanZone: AltmanZoneResult;
  /**
   * What the cash flow statement says: a burn (operating cash flow
   * negative, with a runway that can cap the rung), heavy investment
   * (operations positive, capital spending larger, no ladder effect), or
   * neither.
   */
  cashPosition: CashPosition;
  ladder: LadderResult;
  opportunity: OpportunityResult;
  risk: RiskResult;
  quadrant: Quadrant;
  dealStructure: DealStructureResult;
  negotiationNote: string;
}

/**
 * Runs the full rules engine for one lens on an already-fetched company.
 * Red flags, the ladder, and the revenue/R&D signals are the same
 * regardless of lens; what differs is retrenchment's effect on opportunity
 * (SaaS lens only), the deal structure, and which R&D framing the card
 * shows (growth vs. intensity).
 */
export function evaluateLens(
  lens: Lens,
  kf: KeyFinancials,
  health: FinancialHealth,
  subs: CompanySubmissions,
  now: Date = new Date()
): LensResult {
  const revenue = computeRevenueSignal(kf);
  const engineeringSpend = computeEngineeringSpendSignal(kf);
  const paymentBehavior = computePaymentBehaviorSignal(health);

  const annualEnds = kf.lookbackPeriods.filter((p) => p.fp === "FY").map((p) => p.filing.reportDate);
  const redFlags = computeRedFlags(subs, kf.lookbackPeriods[0], annualEnds, now);
  const retrenchment = computeRetrenchmentSignal(kf, subs, now);

  const zPrime = health.altmanZDoublePrime[0];
  const altmanZone = health.altmanZone[0];
  const cashPosition = computeCashPosition(kf);
  const ladder = computeLadder(altmanZone, redFlags, paymentBehavior, cashPosition);
  const opportunity = computeOpportunity(lens, revenue, engineeringSpend, retrenchment);
  const risk = computeRisk(ladder.rung, retrenchment);
  const quadrant = computeQuadrant(opportunity.high, risk.high);
  const dealStructure = computeDealStructure(lens, ladder.rung);
  const note = negotiationNote(paymentBehavior, ladder.rung);

  const result: LensResult = {
    lens,
    revenue,
    engineeringSpend,
    paymentBehavior,
    retrenchment,
    redFlags,
    altmanZPrime: zPrime,
    altmanZone,
    cashPosition,
    ladder,
    opportunity,
    risk,
    quadrant,
    dealStructure,
    negotiationNote: note,
  };
  if (lens === "SaaS") result.techInvestment = computeTechInvestmentInfo(kf);
  return result;
}
