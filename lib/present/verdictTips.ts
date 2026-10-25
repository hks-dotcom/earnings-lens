/**
 * The ⓘ of each health area in plain words (rules 4.3, 16, 17.2, 17.6), in
 * the style of mock V24: what each measure is, this quarter's values with
 * plain labels, one bullet per warning condition, and any test that could
 * not run. Every number is the engine's computed value; every threshold is
 * read from the rules config. No flag names, no operators.
 */
import { RULES } from "@/lib/verdict/rulesConfig";
import { AreaDisplay } from "@/lib/verdict/display";
import { balanceWords, listWords, netMovement, plainFilingReason, plainInputs, TEST_NAME } from "@/lib/verdict/plain";
import { day, money, plain, signed } from "@/lib/verdict/format";
import type { VerdictResult } from "@/lib/verdict/types";

export const NOT_AVAILABLE = "Not available";

export interface AreaTip {
  formula: string[];
  thisQuarter: string[];
  critical: string[];
  couldNotRun: string[];
  warningWhen: string[];
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pct = (k: number) => `${+(k * 100).toFixed(4)}%`;
/** "Label: value", or "Label: — Not available". */
const line = (label: string, v: number | null, f: (n: number) => string) => `${label}: ${v === null ? `— ${NOT_AVAILABLE}` : f(v)}`;

function couldNotRun(r: VerdictResult, a: AreaDisplay): string[] {
  return a.notMeasured.map((t) => {
    const name = capital(TEST_NAME[t.flag]);
    if (t.flag === "MISSED FILING") return `${name}: ${plainFilingReason(t.reason)}`;
    const missing = plainInputs(t.missing);
    return `${name}: ${missing.length ? `${listWords(missing)} not available` : "an input is not available"}`;
  });
}

export function areaTip(r: VerdictResult, a: AreaDisplay): AreaTip {
  const x = r.inputs;
  const v = r.layer1.values;
  const c = RULES.cash;
  const b = RULES.borrowing;
  const o = RULES.operating;
  const base = { critical: [] as string[], couldNotRun: couldNotRun(r, a) };
  const netDebtLines = (): string[] => {
    const { now, yearAgo } = x.netDebt;
    const out = [now === null ? `Net debt: — ${NOT_AVAILABLE}` : `Now: ${balanceWords(now)}`, yearAgo === null ? `A year ago: — ${NOT_AVAILABLE}` : `A year ago: ${balanceWords(yearAgo)}`];
    if (now !== null && yearAgo !== null) out.push(`Change: ${netMovement(now, yearAgo)}`);
    return out;
  };
  switch (a.area) {
    case "cash-generation":
      return {
        ...base,
        formula: [
          "Operating cash flow: net cash from operating activities, last 4 quarters added up",
          "Free cash flow (Earnings Lens basis): operating cash flow − purchases of property and equipment",
          "Runway: months of cash left at the current rate of cash use",
        ],
        thisQuarter: [
          line("Operating cash flow, last 12 months", x.ocf12m.now, money),
          line("Operating cash flow, the 12 months before", x.ocf12m.yearAgo, money),
          line("Free cash flow, last 12 months", x.fcf12m.now, money),
          line("Free cash flow, the 12 months before", x.fcf12m.yearAgo, money),
          v.runwayMonths === null ? "Runway: only computed when quarterly operating cash flow is negative" : `Runway: ${v.runwayMonths} months`,
          ...netDebtLines(),
        ],
        warningWhen: [
          `Severe: operating cash flow negative now and a year ago, with under ${c.severeRunwayMonths} months of cash left`,
          `Operating cash flow negative now and a year ago, with ${c.severeRunwayMonths}–${c.cautionRunwayMonths} months of cash left, or runway unknown`,
          "Free cash flow negative now and a year ago, while operating cash flow falls or net debt rises",
        ],
      };
    case "near-term-liquidity":
      return {
        ...base,
        formula: ["Liquidity: cash and cash equivalents + short-term marketable securities", "Current ratio: current assets ÷ current liabilities"],
        thisQuarter: [
          line("Cash and short-term investments", x.supporting.liquidityNow, money),
          ...x.supporting.liquidityNotes.map(capital),
          line("Current assets", x.supporting.currentAssets, money),
          line("Current liabilities", x.supporting.currentLiabilities, money),
          line("Current ratio", x.currentRatio, (n) => `${n.toFixed(1)}x`),
          line("Operating cash flow, last 12 months", x.ocf12m.now, money),
        ],
        warningWhen: [`Current ratio below ${RULES.liquidity.weakCurrentRatio} while operating cash flow over the last 12 months is negative`],
      };
    case "operating-performance":
      return {
        ...base,
        formula: ["Sales growth: revenue against the same quarter a year ago", "Operating margin: operating income ÷ revenue"],
        thisQuarter: [
          line("Sales vs the same quarter a year ago", x.revenueYoYPct[0], (n) => `${signed(n)}%`),
          line("Operating margin vs the same quarter a year ago", x.operatingMarginChangePts, (n) => `${signed(n)} pts`),
          line("Sales the quarter before, vs a year earlier", x.revenueYoYPct[1], (n) => `${signed(n)}%`),
        ],
        warningWhen: [`Sales down ${Math.abs(o.revenueYoYPct)}% or more and operating margin down ${Math.abs(o.marginChangePts)} points or more, against the same quarter a year ago`],
      };
    case "funding-and-leverage": {
      const ocf = x.ocf12m.now;
      const rev = x.revenue12m;
      return {
        ...base,
        formula: [
          "Net debt: total debt − cash and short-term investments; below zero it is net cash",
          "Net debt ÷ operating cash flow: years of operating cash needed to repay net debt",
          "Operating cash flow as a share of sales, both over the last 12 months",
        ],
        thisQuarter: [
          ...netDebtLines(),
          line("Operating cash flow, last 12 months", ocf, money),
          line("Operating cash flow, the 12 months before", x.ocf12m.yearAgo, money),
          line("Sales, last 12 months", rev, money),
          ...(ocf !== null && rev !== null && rev !== 0 ? [`Operating cash flow as a share of sales: ${plain((ocf / rev) * 100)}%`] : []),
          ...(v.leverageMultiple !== null ? [`Net debt ÷ operating cash flow: ${v.leverageMultiple.toFixed(2)}×`] : []),
        ],
        warningWhen: [
          `Net debt above ${b.leverageMultiple}× operating cash flow`,
          `Operating cash flow ${pct(b.ocfShareOfRevenue)} of sales or less, with net debt above ${pct(b.netDebtShareOfRevenue)} of sales`,
          `Net debt up by more than ${pct(b.increaseShareOfAbsOcf)} of the size of operating cash flow while operating cash flow falls, with net debt above ${b.substitutionRatio}× operating cash flow (or operating cash flow at or below zero)`,
        ],
      };
    }
    case "filing-status": {
      const f = x.filing;
      const thisQuarter = [`Status: ${r.filingStatus.card.text}`];
      if (f.measurable) {
        if (f.form) thisQuarter.push(`Report: ${f.form}${f.periodEnd ? ` for the period ended ${day(f.periodEnd)}` : ""}`);
        if (f.deadline) thisQuarter.push(`Deadline: ${day(f.deadline)}`);
        if (f.extendedDeadline) thisQuarter.push(`Extended deadline (late-filing notice): ${day(f.extendedDeadline)}`);
        thisQuarter.push(f.filedOn ? `Filed: ${day(f.filedOn)}` : "Filed: not yet");
      }
      if (!a.critical.length) thisQuarter.push("No bankruptcy, debt-acceleration or non-reliance filing in the last 12 months");
      return {
        ...base,
        critical: a.critical,
        formula: [
          "Latest 10-Q or 10-K filed by its SEC deadline, counted in business days",
          "A late-filing notice (12b-25) extends the deadline; a report filed within it counts as filed",
          "Critical: an 8-K item 1.03, 2.04 or 4.02 in the last 12 months",
        ],
        thisQuarter,
        warningWhen: [
          "A 10-Q or 10-K past its deadline, with no report filed",
          "Critical: bankruptcy (1.03), debt acceleration (2.04) or non-reliance on past financials (4.02)",
          "A 4.02 means past financials can’t be relied on, not necessarily that the company is insolvent",
        ],
      };
    }
  }
}
