import { Statements, StatementCell, StatementRow } from "@/lib/xbrl/statements";

/**
 * The statements snapshot: every cell of the three statement tabs with its
 * value, method and provenance, so a change in what a filing or company
 * facts returns shows up cell by cell rather than as a quietly different
 * table. Row order is part of the snapshot, because the income statement's
 * order is the company's own.
 */
export interface StatementsSnapshot {
  ticker: string;
  quarters: Statements["quarters"];
  years: Statements["years"];
  acquisitionsCaption: string | null;
  joins: Statements["joins"];
  tabs: Record<"income" | "balance" | "cashFlow", SnapshotRow[]>;
}

export interface SnapshotRow {
  key: string;
  label: string;
  kind: string;
  concept: string | null;
  flags: string[];
  cells: (StatementCell | null)[];
}

function flags(r: StatementRow): string[] {
  const out: string[] = [];
  if (r.sign !== undefined) out.push(`sign:${r.sign}:${r.signSource}`);
  if (r.companyTag) out.push("companyTag");
  if (r.notFiled) out.push("notFiled");
  if (r.hidden) out.push("hidden");
  if (r.debtKind) out.push(`debt:${r.debtKind}`);
  if (r.debtTotal) out.push("debtTotal");
  if (r.filedEver !== undefined) out.push(`filedEver:${r.filedEver}`);
  return out;
}

export function buildStatementsSnapshot(ticker: string, s: Statements): StatementsSnapshot {
  const tab = (rows: StatementRow[]): SnapshotRow[] =>
    rows.map((r) => ({
      key: r.key,
      label: r.label,
      kind: r.kind,
      concept: r.concept ?? null,
      flags: flags(r),
      cells: [...r.quarterly, ...r.annual],
    }));
  return {
    ticker,
    quarters: s.quarters,
    years: s.years,
    acquisitionsCaption: s.acquisitionsCaption ?? null,
    joins: s.joins,
    tabs: { income: tab(s.income), balance: tab(s.balance), cashFlow: tab(s.cashFlow) },
  };
}
