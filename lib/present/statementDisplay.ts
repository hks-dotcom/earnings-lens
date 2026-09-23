import {
  isValue,
  StatementCell,
  StatementColumn,
  StatementRow,
  Statements,
  StatementValue,
} from "@/lib/xbrl/statements";
import { formatChange, formatMoney, formatPeriodEnd, Unit } from "@/lib/present/format";

/**
 * How the statement tabs show a filed figure. Nothing here changes a
 * value: XBRL files payments and costs as positive amounts, and the sign
 * the reader sees is applied at display only.
 *
 * - Signs follow the money: income and cash coming in are positive; costs,
 *   tax and cash going out are negative, so each column adds down.
 * - Red only for a figure negative against its nature: a loss, negative
 *   free cash flow, a non-operating loss, negative after-tax items. An
 *   ordinary cost or payment shows its minus in plain type, and so do net
 *   new debt and "other operating expense (income), net".
 * - Under each figure, its change on the previous quarter (or fiscal year),
 *   on the amount as filed: +9.5% on a cost means the cost grew. A
 *   percentage only when both figures are positive, otherwise the change
 *   in $ millions. Never coloured; blank for the oldest column or when
 *   either figure is missing.
 */

export type StatementTab = "income" | "balance" | "cashFlow";

/** Rows whose figure goes out of the business: shown negative. */
const OUTFLOW_ROWS = new Set([
  "interestExpense",
  "incomeTax",
  "capitalExpenditures",
  "acquisitions",
  "investmentPurchases",
  "buybacks",
  "dividends",
]);

/** Rows that are income or cash in by nature: red when negative. */
const POSITIVE_NATURE_ROWS = new Set([
  "revenue",
  "grossProfit",
  "operatingIncome",
  "nonoperating",
  "otherNonoperating",
  "pretaxIncome",
  "afterTaxItems",
  "netIncome",
  "freeCashFlow",
]);

export function displaySign(row: StatementRow): 1 | -1 {
  if (row.key.startsWith("line:")) return row.sign ?? -1; // company lines: toward operating income
  if (row.debtKind === "repayment") return -1;
  return OUTFLOW_ROWS.has(row.key) ? -1 : 1;
}

export function displayValue(row: StatementRow, cell: StatementValue): number {
  return displaySign(row) * cell.value;
}

export function isRed(row: StatementRow, cell: StatementValue): boolean {
  return POSITIVE_NATURE_ROWS.has(row.key) && displayValue(row, cell) < 0;
}

/** The change under a figure, on the amounts as filed; "" when there is nothing to compare. */
export function changeText(current: StatementCell | undefined, previous: StatementCell | undefined, unit: Unit): string {
  if (!isValue(current) || !isValue(previous)) return "";
  return formatChange(current.value, previous.value, unit).text;
}

const METHOD_TEXT: Record<string, string> = {
  direct: "as filed",
  instant: "as filed",
  "ytd-subtraction": "year-to-date minus the prior year-to-date",
  "annual-minus-9mo": "annual − Q1 to Q3",
  "computed-sum": "computed from filed lines",
  "computed-difference": "computed from filed lines",
  spliced: "from a second tag that matches this row's tag in the most recent period both report",
  "spliced-ytd": "year-to-date across two tags that match in the most recent period both report",
};

export function cellTitle(row: StatementRow, col: StatementColumn, cell: StatementCell, unit: Unit): string {
  const head = `${row.label} · ${col.label} (${formatPeriodEnd(col.periodEnd)})`;
  if (!isValue(cell)) return `${head}\nMISSING: ${cell.missing}`;
  const lines = [head];
  const tag = cell.concept.replace(/^us-gaap:/, "");
  lines.push(`XBRL: ${tag}${cell.companyTag ? " (the company's own tag, read from the filing)" : ""}`);
  let method = METHOD_TEXT[cell.method] ?? cell.method;
  if (cell.method === "spliced-ytd" && cell.splicedWith) method += `: ${tag}, less the prior figure under ${cell.splicedWith}`;
  if (cell.components?.length) method += ` (${cell.components.map((c) => c.replace(/^us-gaap:/, "")).join(", ")})`;
  lines.push(`Method: ${method}`);
  if (cell.joinedFrom) lines.push(`Read under ${cell.joinedFrom}, the element this line used in that filing`);
  if (cell.nilPeriods?.length) lines.push(`${cell.nilPeriods.join(", ")}: not in the filed statement, read as nil`);
  if (cell.restated) {
    lines.push(
      `As restated in ${cell.restated.form} filed ${cell.restated.filingDate}; originally ${formatMoney(cell.restated.original, unit)}`
    );
  }
  return lines.join("\n");
}

export function derivedMark(cell: StatementValue): string {
  return `${cell.derived ? "†" : ""}${cell.nilPeriods?.length ? "ⁿ" : ""}${cell.restated ? "ʳ" : ""}`;
}

function monthsOf(end: string): string {
  const d = new Date(`${end}T00:00:00Z`);
  const start = new Date(d.getTime() - 80 * 86_400_000);
  const m = (x: Date) => x.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const y = (x: Date) => x.getUTCFullYear();
  return y(start) === y(d) ? `${m(start)}–${m(d)} ${y(d)}` : `${m(start)} ${y(start)}–${m(d)} ${y(d)}`;
}

/**
 * The † footnote under a statement: each derivation that appears on screen,
 * naming its columns and method, then the marks (ⁿ nil, ʳ restated), then
 * how to read signs and changes.
 */
export function statementFootnote(s: Statements, tab: StatementTab, annual: boolean, unit: Unit): string {
  const rows = s[tab].filter((r) => r.kind !== "section" && !r.hidden && !r.notFiled);
  const cols = annual ? s.years : s.quarters;
  const cells = (r: StatementRow) => (annual ? r.annual : r.quarterly);
  const parts: string[] = [];

  if (!annual) {
    const q4 = cols.filter((c, i) => rows.some((r) => isValue(cells(r)[i]) && (cells(r)[i] as StatementValue).method === "annual-minus-9mo"));
    for (const c of q4) {
      const fy = c.label.replace(/^Q4 /, "");
      parts.push(`${c.label} (${monthsOf(c.periodEnd)}) = ${fy} annual − Q1 to Q3.`);
    }
    const ytd = cols.filter((c, i) => rows.some((r) => isValue(cells(r)[i]) && (cells(r)[i] as StatementValue).method === "ytd-subtraction"));
    if (ytd.length) parts.push(`${ytd.map((c) => c.label).join(", ")}: cash-flow quarters are year-to-date minus the prior year-to-date.`);
  }
  const computed = rows.filter((r) => cells(r).some((c) => isValue(c) && (c.method === "computed-sum" || c.method === "computed-difference")));
  if (computed.length) parts.push(`${computed.map((r) => r.label).join(", ")}: computed from filed lines, so every column of them is derived.`);
  if (rows.some((r) => cells(r).some((c) => isValue(c) && (c.method === "spliced" || c.method === "spliced-ytd")))) {
    parts.push("Some cells come from a second tag that matches the row's tag in the most recent period both report.");
  }
  const nil = rows.filter((r) => cells(r).some((c) => isValue(c) && c.nilPeriods?.length));
  if (nil.length) parts.push(`ⁿ ${nil.map((r) => r.label).join(", ")}: a prior quarter not in the filed statement is read as nil.`);
  const restated = rows.filter((r) => cells(r).some((c) => isValue(c) && c.restated));
  if (restated.length) {
    parts.push(
      `ʳ Restated: ${restated.map((r) => r.label).join(", ")} shown as the latest filing presenting the period restates it; hover for the original, as Key financials shows it.`
    );
  }
  if (tab === "income" && rows.some((r) => r.companyTag)) {
    parts.push("Lines between revenue and operating income are the company's own, with its captions and order; lines on its own tags are read from each filing.");
  }
  if (tab === "cashFlow" && s.cashFlow.some((r) => cells(r).some((c) => !isValue(c) && c.missing === "filed under the company's own tag"))) {
    parts.push("Acquisitions: where a filing puts the line under the company's own tag, that column is MISSING.");
  }
  parts.push(
    `Small figures under each number: change on the ${annual ? "previous fiscal year" : "previous quarter"}. A percentage when both figures are positive; otherwise the change in ${unit.label}. For costs and payments the change is on the amount, so +9.5% means the cost grew. Changes are never coloured.`
  );
  parts.push(
    "Signs follow the money: revenue, income and cash coming in are positive; costs, tax and cash going out are negative, so each column adds down (indented lines sit inside the total above). Red marks a figure that is negative against its nature, such as a loss or negative free cash flow. Hover a figure for its tag and method."
  );
  return parts.join(" ");
}

export { formatMoney };
