import { KeyFinancials } from "@/lib/xbrl/keyFinancials";

/**
 * The net income row's standing note.
 *
 * "Lens rules read operating income, never net income. Net income can
 * carry large non-operating gains." The note exists so a reader who
 * glances at the biggest number on the row knows the rules deliberately
 * ignored it, and how far off it is. WHY the gap exists is filed prose,
 * so it belongs to the Claude layer -- this text never speculates, it
 * only states the size and direction of the gap.
 */

export interface NetIncomeGap {
  netIncome: number | undefined;
  operatingIncome: number | undefined;
  /** netIncome − operatingIncome. Positive = net income is above. */
  gap: number | undefined;
  oppositeSigns: boolean;
  /** Always present, for every ticker -- generated, never hand-written. */
  note: string;
}

/** "$4.0B" / "$412M" / "$3.5M" -- a readable magnitude for prose, not a table cell. */
export function formatMagnitude(absValue: number): string {
  if (absValue >= 1_000_000_000) return `$${(absValue / 1_000_000_000).toFixed(1)}B`;
  if (absValue >= 10_000_000) return `$${Math.round(absValue / 1_000_000).toLocaleString("en-US")}M`;
  return `$${(absValue / 1_000_000).toFixed(1)}M`;
}

export function computeNetIncomeGap(kf: KeyFinancials): NetIncomeGap {
  const netIncome = kf.netIncome.values[0]?.value;
  const operatingIncome = kf.operatingIncome.values[0]?.value;

  if (netIncome === undefined || operatingIncome === undefined) {
    const missing = netIncome === undefined ? "Net income" : "Operating income";
    return {
      netIncome,
      operatingIncome,
      gap: undefined,
      oppositeSigns: false,
      note: `${missing} is not filed for this quarter, so the gap can't be stated; lens rules read operating income.`,
    };
  }

  const gap = netIncome - operatingIncome;
  const oppositeSigns = Math.sign(netIncome) * Math.sign(operatingIncome) < 0;

  let note: string;
  if (gap === 0) {
    note = "Net income equals operating income this quarter; lens rules read operating income.";
  } else if (oppositeSigns) {
    const niSide = netIncome < 0 ? "a loss" : "a profit";
    const oiSide = operatingIncome < 0 ? "a loss" : "a profit";
    note = `Net income is ${niSide} while operating income is ${oiSide}, a gap of ${formatMagnitude(Math.abs(gap))} this quarter; lens rules read operating income.`;
  } else {
    const direction = gap > 0 ? "above" : "below";
    note = `Net income is ${formatMagnitude(Math.abs(gap))} ${direction} operating income this quarter; lens rules read operating income.`;
  }

  return { netIncome, operatingIncome, gap, oppositeSigns, note };
}
