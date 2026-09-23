import { KeyFinancials, LineItem, CellValue } from "@/lib/xbrl/keyFinancials";
import { ResolutionMethod } from "@/lib/xbrl/periods";
import { plainFormula } from "@/lib/xbrl/tagLabels";
import { dayAfter, formatPeriodRange, MINUS } from "@/lib/present/format";

/**
 * The † footnote, generated from what the cells actually are.
 *
 * "Derived marks name the period and the method." A bare † tells a reader
 * a number was computed but not which quarter or how, which is the part
 * that decides whether they trust it. Everything here is read off each
 * cell's own provenance, so a ticker whose filer tags its quarters
 * directly gets a shorter footnote and one that doesn't gets a longer
 * one, with no per-company text anywhere.
 *
 * One plain line per derivation method, not one per cell. The reader is
 * checking a method once, not auditing cells one at a time: repeating
 * "= the fiscal-year figure minus Q1 to Q3" for each column it applies to
 * makes the legend longer without making it say more. Tag names never
 * appear -- those live on each cell, on hover.
 *
 * It describes only what is on screen: the rows the table renders, in the
 * columns it renders. The five-quarter window holds two quarters that
 * appear only as points on the trend line, and a legend explaining a †
 * the reader cannot see is noise.
 */

export interface DerivedNote {
  method: ResolutionMethod;
  text: string;
}

/**
 * Rows whose value is computed from other rows. When such a row is marked
 * derived, the formula is only half the reason -- the inputs may be
 * derived too (free cash flow is a difference of two year-to-date
 * subtractions), and the legend's year-to-date line has to cover them
 * even though those rows have no column of their own.
 */
const COMPUTED_FROM: Record<string, (keyof KeyFinancials)[]> = {
  grossProfit: ["revenue", "costOfRevenue"],
  freeCashFlow: ["operatingCashFlow", "capitalExpenditures"],
};

function labelWithRange(kf: KeyFinancials, index: number): string {
  const q = kf.quarters[index];
  if (!q) return "";
  // A quarter starts the day after the previous one ended. The oldest
  // displayed quarter's predecessor is in the lookback list, not on screen.
  const priorEnd =
    kf.quarters[index + 1]?.periodEnd ?? kf.publishedPeriods[index + 1]?.filing.reportDate;
  const range = formatPeriodRange(dayAfter(priorEnd), q.periodEnd);
  return range ? `${q.label} (${range})` : q.label;
}

/**
 * Lowercase a row label for use mid-sentence, without wrecking an
 * acronym: "Revenue" -> "revenue", but "SG&A" and "R&D (engineering
 * spend)" keep their capitals. The test is the second character -- a
 * lowercase one means the first is just sentence case.
 */
function softLower(label: string): string {
  return /^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label;
}

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

interface Hit {
  index: number;
  rowKey: string;
  rowLabel: string;
  cell: CellValue;
}

export function buildDerivedNotes(
  kf: KeyFinancials,
  rowLabels: Record<string, string>,
  displayedRowKeys: string[],
  displayedColumns: number[]
): DerivedNote[] {
  const byMethod = new Map<ResolutionMethod, Hit[]>();
  const record = (rowKey: string, index: number, cell: CellValue | undefined) => {
    if (!cell?.derived) return;
    const list = byMethod.get(cell.method) ?? [];
    list.push({ index, rowKey, rowLabel: rowLabels[rowKey] ?? rowKey, cell });
    byMethod.set(cell.method, list);
  };

  for (const rowKey of displayedRowKeys) {
    const line = kf[rowKey as keyof KeyFinancials] as LineItem | undefined;
    if (!line || !Array.isArray(line.values)) continue;
    for (const index of displayedColumns) record(rowKey, index, line.values[index]);

    // A computed row's off-screen inputs derive too; fold them into the
    // same method lines so free cash flow's year-to-date origin is stated
    // once, under year-to-date, rather than tacked onto the formula.
    for (const inputKey of COMPUTED_FROM[rowKey] ?? []) {
      const inputLine = kf[inputKey] as LineItem | undefined;
      if (!inputLine) continue;
      for (const index of displayedColumns) record(inputKey as string, index, inputLine.values[index]);
    }
  }

  const notes: DerivedNote[] = [];
  const columnsOf = (hits: Hit[]) =>
    [...new Set(hits.map((h) => h.index))].sort((a, b) => a - b).map((i) => labelWithRange(kf, i));
  const rowsOf = (hits: Hit[]) => [...new Set(hits.map((h) => softLower(h.rowLabel)))];

  const annual = byMethod.get("annual-minus-9mo");
  if (annual?.length) {
    notes.push({
      method: "annual-minus-9mo",
      text: `${joinAnd(columnsOf(annual))}: the fiscal-year figure ${MINUS} Q1 to Q3, because EDGAR files no standalone Q4.`,
    });
  }

  const ytd = byMethod.get("ytd-subtraction");
  if (ytd?.length) {
    notes.push({
      method: "ytd-subtraction",
      text: `${joinAnd(rowsOf(ytd))} at ${joinAnd(columnsOf(ytd))}: filed year-to-date, so each quarter is year-to-date ${MINUS} the prior year-to-date.`,
    });
  }

  for (const method of ["computed-sum", "computed-difference"] as const) {
    const hits = byMethod.get(method);
    if (!hits?.length) continue;
    // One line covering every row computed this way, each with its formula
    // in plain words.
    const seen = new Set<string>();
    const formulas: string[] = [];
    for (const h of hits) {
      if (seen.has(h.rowKey)) continue;
      seen.add(h.rowKey);
      formulas.push(`${softLower(h.rowLabel)} = ${plainFormula(h.cell.concept)}`);
    }
    notes.push({ method, text: `Computed: ${formulas.join("; ")}.` });
  }

  const spliced = byMethod.get("spliced");
  if (spliced?.length) {
    notes.push({
      method: "spliced",
      text: `${joinAnd(rowsOf(spliced))} at ${joinAnd(columnsOf(spliced))}: taken from a second tag that matches this row's own tag within $1M on a shared period.`,
    });
  }

  // Each note is a sentence in the legend, so each one starts with a
  // capital letter. Several are built from a row label that was
  // deliberately lowered for mid-sentence use ("free cash flow at Q2
  // FY27: ..."), which reads as a fragment when it is the first thing on
  // the line.
  return notes.map((n) => ({ ...n, text: capitalizeSentence(n.text) }));
}

/**
 * Capitalises a legend sentence without touching an acronym or a fiscal
 * label -- "free cash flow" becomes "Free cash flow", while "SG&A" and
 * "Q4 FY26" are already right and are left exactly as they are.
 */
function capitalizeSentence(text: string): string {
  if (!text) return text;
  return /^[a-z]/.test(text) ? text[0].toUpperCase() + text.slice(1) : text;
}

/**
 * A margin or other ratio inherits derivation from its inputs: "anything
 * computed from a derived figure is itself marked derived". A margin built
 * on a derived Q4 revenue is no more as-filed than the revenue was.
 */
export function anyDerived(...cells: (CellValue | undefined)[]): boolean {
  return cells.some((c) => c?.derived === true);
}

/**
 * The per-cell provenance string, shown on hover. This is where the tag
 * name lives now: precise, checkable against EDGAR, and out of the way of
 * anyone who doesn't want it.
 */
export function cellProvenance(cell: CellValue, quarterLabel: string, periodEnd: string): string {
  const method =
    cell.method === "direct"
      ? "as filed for the quarter"
      : cell.method === "instant"
        ? "as filed at the period end"
        : cell.method === "ytd-subtraction"
          ? "year-to-date minus the prior year-to-date"
          : cell.method === "annual-minus-9mo"
            ? "fiscal-year figure minus Q1 to Q3"
            : cell.method === "computed-sum"
              ? "sum of the tags below"
              : cell.method === "computed-difference"
                ? "difference of the tags below"
                : "spliced from a corroborated second tag";
  return `${quarterLabel} · period ending ${periodEnd}\nXBRL: ${cell.concept}\nMethod: ${method}`;
}
