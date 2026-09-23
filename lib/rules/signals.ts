import { KeyFinancials } from "@/lib/xbrl/keyFinancials";
import { FinancialHealth } from "@/lib/metrics/health";
import { CompanySubmissions } from "@/lib/edgar/submissions";
import { findRestructuringFiling } from "@/lib/rules/restructuring";
import { formatDate } from "@/lib/rules/redFlags";
import { DPO_BAND_PCT, GROWTH_FLAT_BAND_PCT } from "@/lib/rules/declaredValues";

export type Direction = "up" | "down" | "flat";

function pctChange(current: number | undefined, base: number | undefined): number | undefined {
  if (current === undefined || base === undefined || base === 0) return undefined;
  return ((current - base) / Math.abs(base)) * 100;
}

function directionFromYoy(yoyPct: number | undefined): Direction | undefined {
  if (yoyPct === undefined) return undefined;
  if (yoyPct > GROWTH_FLAT_BAND_PCT) return "up";
  if (yoyPct < -GROWTH_FLAT_BAND_PCT) return "down";
  return "flat";
}

export interface RevenueSignal {
  direction: Direction | undefined;
  yoyPct: number | undefined;
  qoqPct: number | undefined;
}

/** Revenue growth. Signal reads Y/Y (seasonality-proof); Q/Q is shown as context only. */
export function computeRevenueSignal(kf: KeyFinancials): RevenueSignal {
  const current = kf.revenue.values[0]?.value;
  const prior = kf.revenue.values[1]?.value;
  const yearAgo = kf.revenue.values[4]?.value;
  const yoyPct = pctChange(current, yearAgo);
  return { direction: directionFromYoy(yoyPct), yoyPct, qoqPct: pctChange(current, prior) };
}

export interface EngineeringSpendSignal {
  direction: Direction | undefined;
  yoyPct: number | undefined;
  qoqPct: number | undefined;
  intensityCurrentPct: number | undefined; // R&D / revenue, current quarter
  intensityYearAgoPct: number | undefined;
}

/** The Services lens's opportunity signal: R&D $ Y/Y growth (directional), with R&D intensity shown as context. */
export function computeEngineeringSpendSignal(kf: KeyFinancials): EngineeringSpendSignal {
  const current = kf.researchAndDevelopment.values[0]?.value;
  const prior = kf.researchAndDevelopment.values[1]?.value;
  const yearAgo = kf.researchAndDevelopment.values[4]?.value;
  const revenueCurrent = kf.revenue.values[0]?.value;
  const revenueYearAgo = kf.revenue.values[4]?.value;
  const yoyPct = pctChange(current, yearAgo);
  return {
    direction: directionFromYoy(yoyPct),
    yoyPct,
    qoqPct: pctChange(current, prior),
    intensityCurrentPct: current !== undefined && revenueCurrent ? (current / revenueCurrent) * 100 : undefined,
    intensityYearAgoPct:
      yearAgo !== undefined && revenueYearAgo ? (yearAgo / revenueYearAgo) * 100 : undefined,
  };
}

export interface TechInvestmentInfo {
  intensityCurrentPct: number | undefined;
  intensityYearAgoPct: number | undefined;
}

/**
 * The SaaS lens's opportunity input is R&D intensity, shown as fact -- not
 * graded up/down. Intensity can fall even while R&D dollars and revenue
 * both grow (revenue growing faster than R&D), which isn't a spending
 * signal worth a directional arrow.
 */
export function computeTechInvestmentInfo(kf: KeyFinancials): TechInvestmentInfo {
  const spend = computeEngineeringSpendSignal(kf);
  return { intensityCurrentPct: spend.intensityCurrentPct, intensityYearAgoPct: spend.intensityYearAgoPct };
}

export type PaymentBehaviorState = "rising" | "falling" | "stable" | "missing";

export interface PaymentBehaviorSignal {
  state: PaymentBehaviorState;
  dpoCurrent: number | undefined;
  dpoYearAgo: number | undefined;
  /** (current - yearAgo) / yearAgo x 100. Positive = DPO rising (paying slower). */
  yoyPctChange: number | undefined;
}

/** DPO Y/Y trend against the declared ±10% band. Never compared Q/Q (seasonality). */
export function computePaymentBehaviorSignal(health: FinancialHealth): PaymentBehaviorSignal {
  const dpoCurrent = health.dpo[0];
  const dpoYearAgo = health.dpo[4];
  if (dpoCurrent === undefined || dpoYearAgo === undefined || dpoYearAgo === 0) {
    return { state: "missing", dpoCurrent, dpoYearAgo, yoyPctChange: undefined };
  }
  const yoyPctChange = ((dpoCurrent - dpoYearAgo) / dpoYearAgo) * 100;
  const state: PaymentBehaviorState =
    yoyPctChange > DPO_BAND_PCT ? "rising" : yoyPctChange < -DPO_BAND_PCT ? "falling" : "stable";
  return { state, dpoCurrent, dpoYearAgo, yoyPctChange };
}

export interface RetrenchmentSignal {
  triggered: boolean;
  causes: string[];
}

/**
 * A restructuring filing (8-K Item 2.05), or R&D or SG&A falling Y/Y
 * beyond the flat band. Never an account-level claim -- the readout is
 * always the same fixed sentence regardless of which condition fired.
 */
export function computeRetrenchmentSignal(
  kf: KeyFinancials,
  subs: CompanySubmissions,
  now: Date = new Date()
): RetrenchmentSignal {
  const causes: string[] = [];

  const restructuring = findRestructuringFiling(subs, now);
  if (restructuring) {
    causes.push(`restructuring filing (8-K Item 2.05) filed ${formatDate(restructuring.filingDate)}`);
  }

  const rndCurrent = kf.researchAndDevelopment.values[0]?.value;
  const rndYearAgo = kf.researchAndDevelopment.values[4]?.value;
  const rndYoy = pctChange(rndCurrent, rndYearAgo);
  if (rndYoy !== undefined && rndYoy < -GROWTH_FLAT_BAND_PCT) {
    causes.push(`R&D down ${rndYoy.toFixed(1)}% Y/Y, beyond the ${GROWTH_FLAT_BAND_PCT}% flat band`);
  }

  const sgaCurrent = kf.sga.values[0]?.value;
  const sgaYearAgo = kf.sga.values[4]?.value;
  const sgaYoy = pctChange(sgaCurrent, sgaYearAgo);
  if (sgaYoy !== undefined && sgaYoy < -GROWTH_FLAT_BAND_PCT) {
    causes.push(`SG&A down ${sgaYoy.toFixed(1)}% Y/Y, beyond the ${GROWTH_FLAT_BAND_PCT}% flat band`);
  }

  return { triggered: causes.length > 0, causes };
}
