/**
 * Explanation data for each health area and each "other ratio" (rules
 * 4.3 and 10): formula, this quarter's values and the warning condition.
 *
 * Every number comes from the computed result the verdict used (inputs
 * and Layer 1 values), and every threshold from rulesConfig, so the
 * explanation cannot drift from the calculation. Structured data, not UI.
 */
import { RULES } from "@/lib/verdict/rulesConfig";
import { AREA_ORDER, FLAG_AREA } from "@/lib/verdict/layer1";
import type {
  AreaExplanation,
  AreaId,
  ExplanationInput,
  FilingStatusResult,
  FlagExplanation,
  FlagName,
  Layer1Result,
  OtherRatioExplanation,
  VerdictInputs,
} from "@/lib/verdict/types";

/** "12-month": the window the 12-month figures sum over. */
const YEAR = `${RULES.windows.quartersPerYear * RULES.cash.monthsPerQuarter}-month`;
const share = (k: number) => `${+(k * 100).toFixed(4)}%`;
const times = (k: number) => `${k}×`;

/** Card titles and scales (4.3). */
const CARD: Record<AreaId, { title: string; scale: string[] }> = {
  "cash-generation": { title: "Cash flow from operations", scale: ["Clear", "Warning", "Severe"] },
  "near-term-liquidity": { title: "Near-term liquidity", scale: ["Clear", "Warning"] },
  "operating-performance": { title: "Operating performance", scale: ["Clear", "Warning"] },
  "funding-and-leverage": { title: "Funding and leverage", scale: ["Clear", "Warning"] },
  "filing-status": { title: "Filing status", scale: ["Clear", "Warning", "Critical"] },
};

function flagText(): Record<FlagName, { formula: string; warningWhen: string }> {
  const c = RULES.cash;
  const b = RULES.borrowing;
  const o = RULES.operating;
  return {
    "SEVERE BURN": {
      formula: `${YEAR} operating cash flow < 0 AND the same a year ago < 0 AND runway < ${c.severeRunwayMonths} months`,
      warningWhen: `Operating cash flow negative in both ${YEAR} windows and runway below ${c.severeRunwayMonths} months`,
    },
    "CAUTION BURN": {
      formula: `${YEAR} operating cash flow < 0 AND the same a year ago < 0 AND runway ≥ ${c.severeRunwayMonths} AND < ${c.cautionRunwayMonths} months`,
      warningWhen: `Operating cash flow negative in both ${YEAR} windows and runway from ${c.severeRunwayMonths} to under ${c.cautionRunwayMonths} months`,
    },
    "PERSISTENT BURN, RUNWAY UNKNOWN": {
      formula: `${YEAR} operating cash flow < 0 AND the same a year ago < 0 AND runway unknown`,
      warningWhen: `Operating cash flow negative in both ${YEAR} windows and runway cannot be computed`,
    },
    "INVESTMENT CASH PRESSURE": {
      formula:
        `${YEAR} free cash flow < 0 AND the same a year ago < 0 AND (${YEAR} operating cash flow < a year ago OR net debt now > net debt a year ago)`,
      warningWhen: `Free cash flow negative in both ${YEAR} windows while operating cash flow falls or net debt rises`,
    },
    "WEAK LIQUIDITY": {
      formula: `Current ratio < ${RULES.liquidity.weakCurrentRatio} AND ${YEAR} operating cash flow < 0`,
      warningWhen: `Current ratio below ${RULES.liquidity.weakCurrentRatio} while ${YEAR} operating cash flow is negative`,
    },
    "OPERATING DETERIORATION": {
      formula: `Revenue Y/Y (latest quarter) ≤ ${o.revenueYoYPct}% AND operating margin change (latest quarter) ≤ ${o.marginChangePts} points`,
      warningWhen: `Revenue down ${Math.abs(o.revenueYoYPct)}% or more on the year and operating margin down ${Math.abs(o.marginChangePts)} points or more`,
    },
    LEVERAGE: {
      formula: `${YEAR} operating cash flow > ${share(b.ocfShareOfRevenue)} × ${YEAR} revenue AND net debt > 0 AND net debt ÷ ${YEAR} operating cash flow > ${times(b.leverageMultiple)}`,
      warningWhen: `Net debt more than ${times(b.leverageMultiple)} ${YEAR} operating cash flow (measured only when that cash flow is above ${share(b.ocfShareOfRevenue)} of revenue)`,
    },
    "FUNDING SUBSTITUTION": {
      formula: `Net debt increase > ${share(b.increaseShareOfAbsOcf)} × |${YEAR} operating cash flow| AND ${YEAR} operating cash flow < a year ago AND (${YEAR} operating cash flow ≤ 0 OR net debt ÷ ${YEAR} operating cash flow > ${times(b.substitutionRatio)})`,
      warningWhen: `Net debt up by more than ${share(b.increaseShareOfAbsOcf)} of the size of ${YEAR} operating cash flow while that cash flow falls`,
    },
    "LOW-CASH DEBT": {
      formula: `${YEAR} operating cash flow ≤ ${share(b.ocfShareOfRevenue)} × ${YEAR} revenue AND net debt > ${share(b.netDebtShareOfRevenue)} × ${YEAR} revenue`,
      warningWhen: `Operating cash flow at or below ${share(b.ocfShareOfRevenue)} of revenue while net debt is above ${share(b.netDebtShareOfRevenue)} of revenue`,
    },
    "MISSED FILING": {
      formula:
        "A required 10-Q or 10-K is past its deadline (the extended deadline if a valid 12b-25 was filed), counted in business days, and no report has been filed",
      warningWhen: "A required periodic report is overdue",
    },
  };
}

function flagInputs(f: FlagName, x: VerdictInputs, l1: Layer1Result, fs: FilingStatusResult): ExplanationInput[] {
  const v = l1.values;
  const ocf: ExplanationInput[] = [
    { name: `${YEAR} operating cash flow`, value: x.ocf12m.now, unit: "USD" },
    { name: `${YEAR} operating cash flow a year ago`, value: x.ocf12m.yearAgo, unit: "USD" },
  ];
  const nd: ExplanationInput[] = [
    { name: "Net debt", value: x.netDebt.now, unit: "USD" },
    { name: "Net debt a year ago", value: x.netDebt.yearAgo, unit: "USD" },
  ];
  switch (f) {
    case "SEVERE BURN":
    case "CAUTION BURN":
    case "PERSISTENT BURN, RUNWAY UNKNOWN":
      return [...ocf, { name: "Runway", value: v.runwayMonths, unit: "months" }];
    case "INVESTMENT CASH PRESSURE":
      return [
        { name: `${YEAR} free cash flow`, value: x.fcf12m.now, unit: "USD" },
        { name: `${YEAR} free cash flow a year ago`, value: x.fcf12m.yearAgo, unit: "USD" },
        ...ocf,
        ...nd,
      ];
    case "WEAK LIQUIDITY":
      return [
        { name: "Current ratio", value: x.currentRatio, unit: "x" },
        { name: "Current assets", value: x.supporting.currentAssets, unit: "USD" },
        { name: "Current liabilities", value: x.supporting.currentLiabilities, unit: "USD" },
        ocf[0],
      ];
    case "OPERATING DETERIORATION":
      return [
        { name: "Revenue Y/Y (latest quarter)", value: x.revenueYoYPct[0], unit: "%" },
        { name: "Operating margin change (latest quarter)", value: x.operatingMarginChangePts, unit: "pts" },
      ];
    case "LEVERAGE":
      return [
        ocf[0],
        { name: `${YEAR} revenue`, value: x.revenue12m, unit: "USD" },
        { name: `${share(RULES.borrowing.ocfShareOfRevenue)} of ${YEAR} revenue`, value: v.ocfBar, unit: "USD" },
        nd[0],
        { name: `Net debt ÷ ${YEAR} operating cash flow`, value: v.leverageMultiple, unit: "x" },
      ];
    case "FUNDING SUBSTITUTION":
      return [
        ...ocf,
        ...nd,
        { name: "Net debt increase", value: v.netDebtIncrease, unit: "USD" },
        { name: `${share(RULES.borrowing.increaseShareOfAbsOcf)} of |${YEAR} operating cash flow|`, value: v.increaseBar, unit: "USD" },
        { name: `Net debt ÷ ${YEAR} operating cash flow`, value: v.substitutionRatio, unit: "x" },
      ];
    case "LOW-CASH DEBT":
      return [
        ocf[0],
        { name: `${YEAR} revenue`, value: x.revenue12m, unit: "USD" },
        { name: `${share(RULES.borrowing.ocfShareOfRevenue)} of ${YEAR} revenue`, value: v.ocfBar, unit: "USD" },
        nd[0],
        { name: `${share(RULES.borrowing.netDebtShareOfRevenue)} of ${YEAR} revenue`, value: v.netDebtBar, unit: "USD" },
      ];
    case "MISSED FILING":
      return [
        { name: "Filing status", value: fs.card.text, unit: "text" },
        { name: "Form", value: x.filing.measurable ? x.filing.form : null, unit: "text" },
        { name: "Period", value: x.filing.measurable ? x.filing.periodEnd : null, unit: "date" },
        { name: "Deadline", value: x.filing.measurable ? x.filing.deadline : null, unit: "date" },
        { name: "Extended deadline", value: x.filing.measurable ? x.filing.extendedDeadline : null, unit: "date" },
        { name: "Filed", value: x.filing.measurable ? x.filing.filedOn : null, unit: "date" },
      ];
  }
}

/** The card level from fired flags only; not-measurable flags are listed beside it, never read as a level. */
function areaLevel(area: AreaId, l1: Layer1Result): AreaExplanation["level"] {
  if (area === "cash-generation" && l1.flags["SEVERE BURN"] === true) return "Severe";
  return l1.fired.some((f) => FLAG_AREA[f] === area) ? "Warning" : "Clear";
}

export function explainAreas(x: VerdictInputs, l1: Layer1Result, fs: FilingStatusResult): AreaExplanation[] {
  const text = flagText();
  return AREA_ORDER.map((area) => {
    const flags: FlagExplanation[] = (Object.keys(FLAG_AREA) as FlagName[])
      .filter((f) => FLAG_AREA[f] === area)
      .map((f) => ({ flag: f, value: l1.flags[f], formula: text[f].formula, warningWhen: text[f].warningWhen, inputs: flagInputs(f, x, l1, fs) }));
    const seen = new Set<string>();
    const thisQuarter = flags.flatMap((f) => f.inputs).filter((i) => (seen.has(i.name) ? false : (seen.add(i.name), true)));
    return {
      area,
      title: CARD[area].title,
      scale: CARD[area].scale,
      level: areaLevel(area, l1),
      notMeasurable: flags.filter((f) => f.value === null).map((f) => f.flag),
      formula: flags.map((f) => `${f.flag}: ${f.formula}`),
      thisQuarter,
      warningWhen: flags.map((f) => `${f.flag}: ${f.warningWhen}`),
      flags,
    };
  });
}

// Formulas worded as the page's health tiles word them (copied from components/HealthTiles.tsx; keep the two in step).
const NOT_USED = "Not used in the verdict.";

export function explainOtherRatios(x: VerdictInputs): OtherRatioExplanation[] {
  return [
    {
      ratio: "altmanZ",
      label: "Altman Z''",
      value: x.otherRatios.altmanZ,
      formula:
        "6.56 × (working capital ÷ total assets) + 3.26 × (retained earnings ÷ total assets) + 6.72 × (operating income, last 12 months ÷ total assets) + 1.05 × (total equity ÷ total liabilities).",
      note: NOT_USED,
    },
    {
      ratio: "dso",
      label: "DSO",
      value: x.otherRatios.dso,
      formula: "Days sales outstanding = receivables at quarter end ÷ quarterly revenue × days in the quarter.",
      note: NOT_USED,
    },
    {
      ratio: "dpo",
      label: "DPO",
      value: x.otherRatios.dpo,
      formula: "Days payables outstanding = payables at quarter end ÷ quarterly cost of revenue × days in the quarter.",
      note: NOT_USED,
    },
    {
      ratio: "debtToEquity",
      label: "Debt/equity",
      value: x.otherRatios.debtToEquity,
      formula: "Long-term debt (including the part due this year) ÷ total equity.",
      note: NOT_USED,
    },
    {
      ratio: "currentRatio",
      label: "Current ratio",
      value: x.currentRatio,
      formula: "Current assets ÷ current liabilities.",
      note: `Used only in the near-term liquidity check, when ${YEAR} operating cash flow is negative.`,
    },
  ];
}
