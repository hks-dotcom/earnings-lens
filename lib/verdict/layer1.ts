/**
 * Layer 1, financial health (rules section 4): ten flags in five areas,
 * then one state. Shared by both sellers.
 */
import { RULES } from "@/lib/verdict/rulesConfig";
import { and3, ge, gt, known, le, lt, minus, or3, T3, times } from "@/lib/verdict/logic";
import type { AreaId, CriticalFiling, FlagName, HealthState, Layer1Result, VerdictInputs } from "@/lib/verdict/types";

/** Flag order: area order, then the order of the rules table. */
export const FLAG_ORDER: FlagName[] = [
  "SEVERE BURN",
  "CAUTION BURN",
  "PERSISTENT BURN, RUNWAY UNKNOWN",
  "INVESTMENT CASH PRESSURE",
  "WEAK LIQUIDITY",
  "OPERATING DETERIORATION",
  "LEVERAGE",
  "FUNDING SUBSTITUTION",
  "LOW-CASH DEBT",
  "MISSED FILING",
];

export const AREA_ORDER: AreaId[] = ["cash-generation", "near-term-liquidity", "operating-performance", "funding-and-leverage", "filing-status"];

export const FLAG_AREA: Record<FlagName, AreaId> = {
  "SEVERE BURN": "cash-generation",
  "CAUTION BURN": "cash-generation",
  "PERSISTENT BURN, RUNWAY UNKNOWN": "cash-generation",
  "INVESTMENT CASH PRESSURE": "cash-generation",
  "WEAK LIQUIDITY": "near-term-liquidity",
  "OPERATING DETERIORATION": "operating-performance",
  LEVERAGE: "funding-and-leverage",
  "FUNDING SUBSTITUTION": "funding-and-leverage",
  "LOW-CASH DEBT": "funding-and-leverage",
  "MISSED FILING": "filing-status",
};

/** Area names as the rules table writes them (4.1). */
export const AREA_NAME: Record<AreaId, string> = {
  "cash-generation": "Cash generation",
  "near-term-liquidity": "Near-term liquidity",
  "operating-performance": "Operating performance",
  "funding-and-leverage": "Funding and leverage",
  "filing-status": "Filing status",
};

const CASH_FLAGS: FlagName[] = ["SEVERE BURN", "CAUTION BURN", "PERSISTENT BURN, RUNWAY UNKNOWN", "INVESTMENT CASH PRESSURE"];

const DAY = 86_400_000;
const shiftDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** True when `date` lies in the filing lookback window ending on the assessment date (inclusive). */
export function inLookback(date: string, assessmentDate: string): boolean {
  return date >= shiftDays(assessmentDate, -RULES.windows.filingLookbackDays) && date <= assessmentDate;
}

const CRITICAL_LABEL: Record<CriticalFiling["item"], string> = {
  "1.03": "Bankruptcy or receivership",
  "2.04": "Triggering event that accelerates an obligation",
  "4.02": "Non-reliance on previously issued financial statements: a reporting-reliability problem, not necessarily insolvency",
};

export function criticalLabel(c: CriticalFiling): string {
  return `${CRITICAL_LABEL[c.item]} (8-K Item ${c.item}, filed ${c.filingDate})`;
}

/** Critical filings in the 12 months before the assessment date. */
export function criticalInWindow(x: VerdictInputs): CriticalFiling[] {
  return x.criticalFilings.filter((c) => inLookback(c.filingDate, x.assessmentDate));
}

export function layer1(x: VerdictInputs, missedFiling: T3): Layer1Result {
  const B = RULES.borrowing;
  const ocf = x.ocf12m.now;
  const ocfYA = x.ocf12m.yearAgo;
  const rev = x.revenue12m;
  const nd0 = x.netDebt.now;
  const nd1 = x.netDebt.yearAgo;

  const runwayMonths = x.runwayQuarters === null ? null : x.runwayQuarters * RULES.cash.monthsPerQuarter;
  const burnBoth = and3(lt(ocf, 0), lt(ocfYA, 0));

  // LEVERAGE is measured only when OCF now is above 2% of revenue; LOW-CASH DEBT only when at or below.
  const ocfBar = times(rev, B.ocfShareOfRevenue);
  const ocfAboveBar = gt(ocf, ocfBar);
  const leverageMultiple = ocfAboveBar === true && nd0 !== null ? nd0 / (ocf as number) : null;
  const leverageRatioLeg: T3 = ocfAboveBar === true ? gt(leverageMultiple, B.leverageMultiple) : null;

  const netDebtBar = times(rev, B.netDebtShareOfRevenue);

  // FUNDING SUBSTITUTION: materiality on |OCF now| (S5); ratio leg true when OCF now ≤ 0.
  const netDebtIncrease = minus(nd0, nd1);
  const increaseBar = ocf === null ? null : Math.abs(ocf) * B.increaseShareOfAbsOcf;
  const substitutionRatio = ocf !== null && ocf > 0 && nd0 !== null ? nd0 / ocf : null;
  const substitutionRatioLeg: T3 = ocf === null ? null : ocf <= 0 ? true : gt(substitutionRatio, B.substitutionRatio);

  const flags: Record<FlagName, T3> = {
    "SEVERE BURN": and3(burnBoth, lt(runwayMonths, RULES.cash.severeRunwayMonths)),
    "CAUTION BURN": and3(burnBoth, ge(runwayMonths, RULES.cash.severeRunwayMonths), lt(runwayMonths, RULES.cash.cautionRunwayMonths)),
    "PERSISTENT BURN, RUNWAY UNKNOWN": and3(burnBoth, known(runwayMonths === null)),
    "INVESTMENT CASH PRESSURE": and3(lt(x.fcf12m.now, 0), lt(x.fcf12m.yearAgo, 0), or3(lt(ocf, ocfYA), gt(nd0, nd1))),
    "WEAK LIQUIDITY": and3(lt(x.currentRatio, RULES.liquidity.weakCurrentRatio), lt(ocf, 0)),
    "OPERATING DETERIORATION": and3(
      le(x.revenueYoYPct[0], RULES.operating.revenueYoYPct),
      le(x.operatingMarginChangePts, RULES.operating.marginChangePts)
    ),
    LEVERAGE: and3(ocfAboveBar, gt(nd0, 0), leverageRatioLeg),
    "FUNDING SUBSTITUTION": and3(gt(netDebtIncrease, increaseBar), lt(ocf, ocfYA), substitutionRatioLeg),
    "LOW-CASH DEBT": and3(le(ocf, ocfBar), gt(nd0, netDebtBar)),
    "MISSED FILING": missedFiling,
  };

  const fired = FLAG_ORDER.filter((f) => flags[f] === true);
  const notMeasurable = FLAG_ORDER.filter((f) => flags[f] === null);
  const areas = AREA_ORDER.filter((a) => fired.some((f) => FLAG_AREA[f] === a));
  const critical = criticalInWindow(x);

  let state: HealthState;
  let deciding: string;
  if (critical.length) {
    state = "Critical";
    deciding = critical.map(criticalLabel).join("; ");
  } else if (flags["SEVERE BURN"] === true) {
    state = "Fragile";
    const others = fired.filter((f) => f !== "SEVERE BURN");
    deciding = "SEVERE BURN" + (others.length ? ` (also: ${others.join(", ")})` : "");
  } else if (areas.length >= RULES.states.fragileMinAreas) {
    state = "Fragile";
    deciding = `Flags in ${areas.length} areas: ${areas.map((a) => `${AREA_NAME[a]} (${fired.filter((f) => FLAG_AREA[f] === a).join(", ")})`).join("; ")}`;
  } else if (areas.length === 1) {
    state = "Watch";
    deciding = `Flags in one area: ${AREA_NAME[areas[0]]} (${fired.join(", ")})`;
  } else {
    state = "Resilient";
    deciding = "No flags";
  }

  const subtitle = `Same for both entities · ${areas.length ? areas.map((a) => AREA_NAME[a]).join(" · ") : "No warning thresholds triggered"}`;

  return {
    flags,
    fired,
    notMeasurable,
    areas,
    state,
    deciding,
    subtitle,
    criticalReasons: critical.map(criticalLabel),
    anyCashFlag: or3(...CASH_FLAGS.map((f) => flags[f])),
    values: { runwayMonths, ocfBar, netDebtBar, leverageMultiple, netDebtIncrease, increaseBar, substitutionRatio },
  };
}
