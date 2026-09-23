// Shared shape for scripts/snapshot.ts (writer) and scripts/diff-snapshot.ts
// (comparator). A snapshot captures every cell's full provenance
// (value/tag/method/derived), not just the value, so a diff can tell "the
// number changed" apart from "the same number now comes from a different
// tag/method" -- both are worth flagging, for different reasons.

import { buildKeyFinancials } from "@/lib/xbrl/keyFinancials";
import { AnnualFigures } from "@/lib/present/annualFigures";

export const ROW_NAMES = [
  "revenue",
  "costOfRevenue",
  "grossProfit",
  "researchAndDevelopment",
  "sga",
  "operatingIncome",
  "netIncome",
  "operatingCashFlow",
  "capitalExpenditures",
  "freeCashFlow",
  "cash",
  "accountsReceivable",
  "accountsPayable",
  "currentAssets",
  "currentLiabilities",
  "totalAssets",
  "totalLiabilities",
  "equity",
  "retainedEarnings",
  "longTermDebt",
] as const satisfies readonly (keyof ReturnType<typeof buildKeyFinancials>)[];

export type RowName = (typeof ROW_NAMES)[number];

export interface SnapshotCell {
  value: number;
  concept: string;
  method: string;
  derived: boolean;
}

export interface SnapshotQuarter {
  label: string;
  periodEnd: string;
  form: string;
  accessionNumber: string;
  filingDate: string;
}

/**
 * The Annual toggle's figures, snapshotted alongside the quarterly cells.
 * They come from a different code path (a longer filing lookback, as-filed
 * fiscal-year totals rather than derived quarters), so a quarterly
 * regression suite says nothing about them -- one fixture's FY-2 cash was
 * wrong for exactly that reason and no test noticed.
 *
 * Only the value rows are stored: the two margin rows the table shows are
 * a pure function of revenue, gross profit and operating income, all of
 * which are here, so storing them would only duplicate the same facts.
 */
export interface AnnualSnapshotYear {
  label: string;
  periodEnd: string;
}

export interface AnnualSnapshotCell {
  value: number;
  concept: string;
}

export interface AnnualSnapshot {
  years: AnnualSnapshotYear[];
  /** Row name -> cells, index-aligned with `years`. null = MISSING. */
  rows: Record<AnnualRowName, (AnnualSnapshotCell | null)[]>;
}

export const ANNUAL_ROW_NAMES = [
  "revenue",
  "grossProfit",
  "researchAndDevelopment",
  "sga",
  "operatingIncome",
  "netIncome",
  "freeCashFlow",
  "cash",
] as const satisfies readonly (keyof AnnualFigures["rows"])[];

export type AnnualRowName = (typeof ANNUAL_ROW_NAMES)[number];

export interface Snapshot {
  ticker: string;
  cik: string;
  /**
   * No generation timestamp: it changed on every write, so a snapshot that
   * was byte-identical in substance still showed up as a modified file in
   * `git status`, burying the cell changes that actually matter. Everything
   * here is a function of the filings, so a clean diff means a clean diff.
   */
  quarters: SnapshotQuarter[];
  /** Row name -> cells, index-aligned with `quarters`. null = MISSING. */
  rows: Record<RowName, (SnapshotCell | null)[]>;
  /** The Annual toggle's three fiscal years. null when the filer has no 10-K in range. */
  annual: AnnualSnapshot | null;
}

export function buildSnapshot(
  ticker: string,
  cik: string,
  kf: ReturnType<typeof buildKeyFinancials>,
  annualFigures: AnnualFigures | null
): Snapshot {
  const rows = {} as Record<RowName, (SnapshotCell | null)[]>;
  for (const name of ROW_NAMES) {
    rows[name] = kf[name].values.map((v) =>
      v ? { value: v.value, concept: v.concept, method: v.method, derived: v.derived } : null
    );
  }

  let annual: AnnualSnapshot | null = null;
  if (annualFigures) {
    const annualRows = {} as Record<AnnualRowName, (AnnualSnapshotCell | null)[]>;
    for (const name of ANNUAL_ROW_NAMES) {
      annualRows[name] = annualFigures.rows[name].map((c) =>
        c ? { value: c.value, concept: c.concept } : null
      );
    }
    annual = { years: annualFigures.years.map((y) => ({ ...y })), rows: annualRows };
  }

  return {
    ticker,
    cik,
    quarters: kf.quarters.map((q) => ({ ...q })),
    rows,
    annual,
  };
}
