import { KeyFinancials } from "@/lib/xbrl/keyFinancials";
import { isValue, StatementRow, Statements } from "@/lib/xbrl/statements";

/**
 * The cash-flow figures the three display-only findings read -- borrowing,
 * acquisitions and investments, returns -- taken from the same rows the
 * Cash flow and Balance sheet tabs show, so a finding and its tab can
 * never disagree. Built on the server with the board, from company facts;
 * only the acquisitions caption needs a filing, and only when the finding
 * fires.
 */
export interface FlowFacts {
  /** Latest quarter, as the Cash flow tab shows it. */
  netNewDebt?: number;
  /** Debt lines counted in net new debt, filed for the latest quarter. */
  debtLines: { label: string; kind: "proceeds" | "repayment" | "net"; value: number }[];
  longTermDebt?: number;
  longTermDebtYearAgo?: number;
  acquisitions?: number;
  acquisitionsYearAgo?: number;
  /** The company's own caption for the line, from its latest filing that has one. */
  acquisitionsCaption?: string;
  /** Four quarters to the latest: buybacks and dividends (none when never filed), free cash flow. */
  ttm: {
    buybacks?: number;
    dividends?: number;
    freeCashFlow?: number;
    from?: string;
    to?: string;
  };
}

/** A four-quarter sum, or undefined if any quarter is missing -- missing stays missing. */
function fourQuarters(row: StatementRow | undefined): number | undefined {
  if (!row) return undefined;
  const cells = row.quarterly.slice(0, 4);
  if (cells.length < 4 || !cells.every(isValue)) return undefined;
  return cells.reduce((s, c) => s + (isValue(c) ? c.value : 0), 0);
}

export function buildFlowFacts(s: Statements, kf: KeyFinancials): FlowFacts {
  const cf = (key: string) => s.cashFlow.find((r) => r.key === key);
  const bs = (key: string) => s.balance.find((r) => r.key === key);
  const at = (r: StatementRow | undefined, i: number) => {
    const c = r?.quarterly[i];
    return isValue(c) ? c.value : undefined;
  };

  const debtLines = s.cashFlow
    .filter((r) => r.key.startsWith("debt:") && !r.debtTotal)
    .map((r) => ({ label: r.label, kind: r.debtKind!, value: at(r, 0) }))
    .filter((d): d is { label: string; kind: "proceeds" | "repayment" | "net"; value: number } => d.value !== undefined);

  const buybacks = cf("buybacks");
  const dividends = cf("dividends");
  const fcfCells = kf.freeCashFlow.values.slice(0, 4);
  const fcfTtm =
    fcfCells.length === 4 && fcfCells.every((v) => v !== undefined)
      ? fcfCells.reduce((sum, v) => sum + v!.value, 0)
      : undefined;

  return {
    netNewDebt: at(cf("netNewDebt"), 0),
    debtLines,
    longTermDebt: at(bs("longTermDebt"), 0),
    longTermDebtYearAgo: at(bs("longTermDebt"), 4),
    acquisitions: at(cf("acquisitions"), 0),
    acquisitionsYearAgo: at(cf("acquisitions"), 4),
    acquisitionsCaption: s.acquisitionsCaption,
    ttm: {
      // "Buybacks or dividends never filed in any period count as none."
      buybacks: buybacks?.filedEver === false ? 0 : fourQuarters(buybacks),
      dividends: dividends?.filedEver === false ? 0 : fourQuarters(dividends),
      freeCashFlow: fcfTtm,
      from: kf.quarters[3]?.label,
      to: kf.quarters[0]?.label,
    },
  };
}
