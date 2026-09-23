"use client";

import { useState } from "react";
import { KeyFinancials, LineItem, CellValue } from "@/lib/xbrl/keyFinancials";
import { FinancialHealth, marginPtsChange } from "@/lib/metrics/health";
import { AnnualFigures, AnnualCell } from "@/lib/present/annualFigures";
import { Sparkline } from "@/components/Sparkline";
import { ScrollHint } from "@/components/ScrollHint";
import { buildDerivedNotes, anyDerived, cellProvenance } from "@/lib/present/derivedNotes";
import { computeNetIncomeGap } from "@/lib/present/netIncomeGap";
import {
  chooseUnit,
  formatChange,
  formatMoney,
  formatPeriodEnd,
  formatPts,
  isNegative,
  MINUS,
  NO_CHANGE,
  Unit,
} from "@/lib/present/format";

/** Row labels, shared with the † footnote generator so the two can't drift. */
export const ROW_LABELS: Record<string, string> = {
  revenue: "Revenue",
  costOfRevenue: "Cost of revenue",
  grossProfit: "Gross profit",
  researchAndDevelopment: "R&D (engineering spend)",
  sga: "SG&A",
  operatingIncome: "Operating income",
  netIncome: "Net income",
  operatingCashFlow: "Operating cash flow",
  capitalExpenditures: "Capital expenditures",
  freeCashFlow: "Free cash flow",
  cash: "Cash & equivalents",
};

interface MoneyRow {
  kind: "money";
  key: string;
  label: string;
  line: LineItem;
  bold?: boolean;
  /** Rendered under the row label, e.g. the generated net income note. */
  note?: string;
}
interface MarginRow {
  kind: "margin";
  key: string;
  label: string;
  values: (number | undefined)[]; // index-aligned with quarters, already 1-decimal-rounded
  /** Index-aligned: true where either input cell was itself derived. */
  derived: boolean[];
}

type Row = MoneyRow | MarginRow;

const DERIVED_MARK = "†"; // †

/**
 * A figure cell: red on a negative, † when derived, and its own tag and
 * method on hover. The tag lives here rather than in the footnote, so the
 * exact fact behind any single number is one hover away without the
 * legend having to spell out tag names.
 */
function MoneyCell({
  cell,
  unit,
  bold,
  quarterLabel,
  periodEnd,
}: {
  cell: CellValue | undefined;
  unit: Unit;
  bold?: boolean;
  quarterLabel?: string;
  periodEnd?: string;
}) {
  if (!cell) return <span style={{ color: "#9C978C" }}>MISSING</span>;
  return (
    <span
      title={cellProvenance(cell, quarterLabel ?? "", periodEnd ?? "")}
      style={{ fontWeight: bold ? 600 : 400, color: isNegative(cell.value) ? "var(--bad-text)" : undefined }}
    >
      {formatMoney(cell.value, unit)}
      {cell.derived ? DERIVED_MARK : ""}
    </span>
  );
}

/** A change column's value; with either figure missing there is no change, shown as a muted dash. */
function ChangeText({ text }: { text: string }) {
  if (text === NO_CHANGE) return <span style={{ color: "#9C978C" }}>{NO_CHANGE}</span>;
  return <>{text}</>;
}

function MarginCell({ value, derived, bold }: { value: number | undefined; derived?: boolean; bold?: boolean }) {
  if (value === undefined) return <span style={{ color: "#9C978C" }}>MISSING</span>;
  return (
    <span style={{ fontWeight: bold ? 600 : 400, color: value < 0 ? "var(--bad-text)" : undefined }}>
      {value < 0 ? MINUS : ""}
      {Math.abs(value).toFixed(1)}%
      {derived ? DERIVED_MARK : ""}
    </span>
  );
}

/** Two-line column header: fiscal label over its period-end date. */
function PeriodHeader({ label, periodEnd, strong, tint }: { label: string | undefined; periodEnd: string | undefined; strong?: boolean; tint?: string }) {
  return (
    <th style={{ textAlign: "right", padding: "4px 8px", background: tint, verticalAlign: "bottom" }}>
      <div style={{ fontSize: 12, fontWeight: strong ? 600 : 500, color: strong ? "var(--text-primary)" : "var(--text-tertiary)" }}>{label ?? ""}</div>
      <div style={{ fontSize: 10, fontWeight: 400, color: "var(--text-tertiary)", whiteSpace: "nowrap" }}>{formatPeriodEnd(periodEnd)}</div>
    </th>
  );
}

export function KeyFinancialsTable({
  kf,
  health,
  annual,
}: {
  kf: KeyFinancials;
  health: FinancialHealth;
  annual: AnnualFigures | null;
}) {
  const [showAnnual, setShowAnnual] = useState(false);

  // "When the latest quarter's revenue is under $100M, figures show one
  // decimal" -- one decision for the whole board, taken from revenue.
  const unit = chooseUnit(kf.revenue.values[0]?.value);

  const round1 = (v: number | undefined) => (v === undefined ? undefined : Math.round(v * 10) / 10);
  const grossMargin = health.grossMarginPct.map(round1);
  const operatingMargin = health.operatingMarginPct.map(round1);

  // A margin inherits derivation from its inputs.
  const marginDerived = (numerator: LineItem) =>
    kf.quarters.map((_, i) => anyDerived(numerator.values[i], kf.revenue.values[i]));

  const netIncomeGap = computeNetIncomeGap(kf);

  const rows: Row[] = [
    { kind: "money", key: "revenue", label: ROW_LABELS.revenue, line: kf.revenue, bold: true },
    { kind: "margin", key: "grossMargin", label: "Gross margin", values: grossMargin, derived: marginDerived(kf.grossProfit) },
    { kind: "money", key: "researchAndDevelopment", label: ROW_LABELS.researchAndDevelopment, line: kf.researchAndDevelopment },
    { kind: "money", key: "sga", label: ROW_LABELS.sga, line: kf.sga },
    { kind: "money", key: "operatingIncome", label: ROW_LABELS.operatingIncome, line: kf.operatingIncome },
    { kind: "margin", key: "operatingMargin", label: "Operating margin", values: operatingMargin, derived: marginDerived(kf.operatingIncome) },
    { kind: "money", key: "netIncome", label: ROW_LABELS.netIncome, line: kf.netIncome, note: netIncomeGap.note },
    { kind: "money", key: "freeCashFlow", label: ROW_LABELS.freeCashFlow, line: kf.freeCashFlow },
    { kind: "money", key: "cash", label: ROW_LABELS.cash, line: kf.cash },
  ];

  // Only the three columns the table actually renders. Indexes 2 and 3 are
  // in the data for the trend line and the Y/Y maths, but have no column,
  // so a † legend naming them would point at nothing.
  const DISPLAYED_COLUMNS = [0, 1, 4];
  const derivedNotes = buildDerivedNotes(
    kf,
    ROW_LABELS,
    rows.filter((r) => r.kind === "money").map((r) => r.key),
    DISPLAYED_COLUMNS
  );
  const th: React.CSSProperties = { fontWeight: 500, fontSize: 12, color: "var(--text-tertiary)", padding: "4px 8px" };

  return (
    <div style={{ background: "var(--bg-white)", border: "1px solid var(--border-card)", borderRadius: 12, padding: "20px 22px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text-tertiary)" }}>
          KEY FINANCIALS &middot; {unit.label.toUpperCase()}
        </div>
        {annual && (
          <button
            onClick={() => setShowAnnual((s) => !s)}
            aria-pressed={showAnnual}
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: "4px 10px",
              borderRadius: 6,
              border: "1px solid var(--border-medium)",
              background: showAnnual ? "var(--text-primary)" : "var(--bg-white)",
              color: showAnnual ? "#fff" : "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            Annual
          </button>
        )}
      </div>

      <ScrollHint>
        {showAnnual && annual ? (
          <AnnualTable annual={annual} unit={unit} />
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, fontVariantNumeric: "tabular-nums", minWidth: 660 }}>
            <thead>
              <tr>
                <th></th>
                <th></th>
                <th colSpan={2} style={{ textAlign: "center", padding: "4px 8px", background: "var(--qoq-tint-bg)", borderRadius: "8px 8px 0 0", fontWeight: 600, color: "var(--qoq-tint-text)", fontSize: 12 }}>
                  vs prior quarter
                </th>
                <th style={{ width: 10 }}></th>
                <th colSpan={2} style={{ textAlign: "center", padding: "4px 8px", background: "var(--yoy-tint-bg)", borderRadius: "8px 8px 0 0", fontWeight: 600, color: "var(--yoy-tint-text)", fontSize: 12 }}>
                  vs same quarter last year
                </th>
                <th></th>
              </tr>
              <tr>
                <th style={{ ...th, textAlign: "left", verticalAlign: "bottom" }}>{unit.label}</th>
                <PeriodHeader label={kf.quarters[0]?.label} periodEnd={kf.quarters[0]?.periodEnd} strong />
                <PeriodHeader label={kf.quarters[1]?.label} periodEnd={kf.quarters[1]?.periodEnd} tint="var(--qoq-tint-bg)" />
                <th style={{ ...th, textAlign: "right", background: "var(--qoq-tint-bg)", verticalAlign: "bottom" }}>Change</th>
                <th></th>
                <PeriodHeader label={kf.quarters[4]?.label} periodEnd={kf.quarters[4]?.periodEnd} tint="var(--yoy-tint-bg)" />
                <th style={{ ...th, textAlign: "right", background: "var(--yoy-tint-bg)", verticalAlign: "bottom" }}>Change</th>
                <th style={{ ...th, textAlign: "left", verticalAlign: "bottom" }}>5-quarter trend</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <RowRender key={row.key} row={row} unit={unit} quarters={kf.quarters} />
              ))}
            </tbody>
          </table>
        )}
      </ScrollHint>

      {!showAnnual && derivedNotes.length > 0 && (
        <div style={{ fontSize: 11, lineHeight: 1.55, color: "var(--text-tertiary)" }}>
          <span style={{ fontWeight: 600 }}>{DERIVED_MARK} Derived:</span>{" "}
          {derivedNotes.map((n) => n.text).join(" ")}
        </div>
      )}
      {showAnnual && (
        <div style={{ fontSize: 11, lineHeight: 1.55, color: "var(--text-tertiary)" }}>
          Full fiscal years as filed in each 10-K, not a sum of the quarterly columns above.
        </div>
      )}
    </div>
  );
}

function RowRender({ row, unit, quarters }: { row: Row; unit: Unit; quarters: KeyFinancials["quarters"] }) {
  const labelCell = (
    <td style={{ padding: "8px 8px 8px 0", fontWeight: row.kind === "money" && row.bold ? 600 : 400, minWidth: 170 }}>
      {row.label}
      {row.kind === "money" && row.note && (
        <div style={{ fontSize: 11, fontWeight: 400, color: "var(--text-tertiary)", lineHeight: 1.4, marginTop: 2, maxWidth: 260 }}>
          {row.note}
        </div>
      )}
    </td>
  );

  if (row.kind === "margin") {
    const [cur, prior, , , yearAgo] = row.values;
    return (
      <tr style={{ borderTop: "1px solid var(--border-subtle)" }}>
        {labelCell}
        <td style={{ padding: 8, textAlign: "right" }}>
          <MarginCell value={cur} derived={row.derived[0]} bold />
        </td>
        <td style={{ padding: 8, textAlign: "right", background: "#F7F8FB", color: "var(--text-secondary)" }}>
          <MarginCell value={prior} derived={row.derived[1]} />
        </td>
        <td style={{ padding: 8, textAlign: "right", background: "#F7F8FB" }}><ChangeText text={formatPts(marginPtsChange(cur, prior))} /></td>
        <td></td>
        <td style={{ padding: 8, textAlign: "right", background: "#FBF8F3", color: "var(--text-secondary)" }}>
          <MarginCell value={yearAgo} derived={row.derived[4]} />
        </td>
        <td style={{ padding: 8, textAlign: "right", background: "#FBF8F3" }}><ChangeText text={formatPts(marginPtsChange(cur, yearAgo))} /></td>
        <td style={{ padding: "4px 8px" }}>
          <Sparkline values={row.values} />
        </td>
      </tr>
    );
  }

  const v = row.line.values;
  const qoq = formatChange(v[0]?.value, v[1]?.value, unit);
  const yoy = formatChange(v[0]?.value, v[4]?.value, unit);
  return (
    <tr style={{ borderTop: "1px solid var(--border-subtle)" }}>
      {labelCell}
      <td style={{ padding: 8, textAlign: "right" }}>
        <MoneyCell cell={v[0]} unit={unit} bold quarterLabel={quarters[0]?.label} periodEnd={quarters[0]?.periodEnd} />
      </td>
      <td style={{ padding: 8, textAlign: "right", background: "#F7F8FB", color: "var(--text-secondary)" }}>
        <MoneyCell cell={v[1]} unit={unit} quarterLabel={quarters[1]?.label} periodEnd={quarters[1]?.periodEnd} />
      </td>
      <td style={{ padding: 8, textAlign: "right", background: "#F7F8FB" }}><ChangeText text={qoq.text} /></td>
      <td></td>
      <td style={{ padding: 8, textAlign: "right", background: "#FBF8F3", color: "var(--text-secondary)" }}>
        <MoneyCell cell={v[4]} unit={unit} quarterLabel={quarters[4]?.label} periodEnd={quarters[4]?.periodEnd} />
      </td>
      <td style={{ padding: 8, textAlign: "right", background: "#FBF8F3" }}><ChangeText text={yoy.text} /></td>
      <td style={{ padding: "4px 8px" }}>
        <Sparkline values={v.map((c) => c?.value)} />
      </td>
    </tr>
  );
}

function annualCellNode(cell: AnnualCell | null, unit: Unit, bold?: boolean) {
  if (!cell) return <span style={{ color: "#9C978C" }}>MISSING</span>;
  return (
    <span style={{ fontWeight: bold ? 600 : 400, color: isNegative(cell.value) ? "var(--bad-text)" : undefined }}>
      {formatMoney(cell.value, unit)}
    </span>
  );
}

/**
 * "FY | vs prior FY | FY−1 | vs FY−2 | FY−2", tinted like the Y/Y group.
 * Both comparison columns are year-on-year, so they share the Y/Y tint
 * rather than borrowing the Q/Q one, which would imply a shorter step.
 */
function AnnualTable({ annual, unit }: { annual: AnnualFigures; unit: Unit }) {
  const [fy, fy1, fy2] = annual.years;
  const r = annual.rows;

  type ARow =
    | { kind: "money"; label: string; values: (AnnualCell | null)[]; bold?: boolean }
    | { kind: "margin"; label: string; values: (number | undefined)[] };

  const rows: ARow[] = [
    { kind: "money", label: ROW_LABELS.revenue, values: r.revenue, bold: true },
    { kind: "margin", label: "Gross margin", values: annual.grossMarginPct.map((v) => (v === undefined ? undefined : Math.round(v * 10) / 10)) },
    { kind: "money", label: ROW_LABELS.researchAndDevelopment, values: r.researchAndDevelopment },
    { kind: "money", label: ROW_LABELS.sga, values: r.sga },
    { kind: "money", label: ROW_LABELS.operatingIncome, values: r.operatingIncome },
    { kind: "margin", label: "Operating margin", values: annual.operatingMarginPct.map((v) => (v === undefined ? undefined : Math.round(v * 10) / 10)) },
    { kind: "money", label: ROW_LABELS.netIncome, values: r.netIncome },
    { kind: "money", label: ROW_LABELS.freeCashFlow, values: r.freeCashFlow },
    { kind: "money", label: ROW_LABELS.cash, values: r.cash },
  ];

  const tint = "var(--yoy-tint-bg)";
  const th: React.CSSProperties = { fontWeight: 500, fontSize: 12, color: "var(--text-tertiary)", padding: "4px 8px" };

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, fontVariantNumeric: "tabular-nums", minWidth: 620 }}>
      <thead>
        <tr>
          <th></th>
          <th></th>
          <th style={{ textAlign: "center", padding: "4px 8px", background: tint, borderRadius: "8px 8px 0 0", fontWeight: 600, color: "var(--yoy-tint-text)", fontSize: 12 }}>
            vs prior FY
          </th>
          <th></th>
          <th style={{ textAlign: "center", padding: "4px 8px", background: tint, borderRadius: "8px 8px 0 0", fontWeight: 600, color: "var(--yoy-tint-text)", fontSize: 12 }}>
            vs {fy2?.label ?? "FY−2"}
          </th>
          <th></th>
        </tr>
        <tr>
          <th style={{ ...th, textAlign: "left", verticalAlign: "bottom" }}>{unit.label}, full fiscal year</th>
          <PeriodHeader label={fy?.label} periodEnd={fy?.periodEnd} strong />
          <th style={{ ...th, textAlign: "right", background: tint, verticalAlign: "bottom" }}>Change</th>
          <PeriodHeader label={fy1?.label} periodEnd={fy1?.periodEnd} />
          <th style={{ ...th, textAlign: "right", background: tint, verticalAlign: "bottom" }}>Change</th>
          <PeriodHeader label={fy2?.label} periodEnd={fy2?.periodEnd} />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const isMargin = row.kind === "margin";
          const v0 = isMargin ? row.values[0] : (row.values[0]?.value ?? undefined);
          const v1 = isMargin ? row.values[1] : (row.values[1]?.value ?? undefined);
          const v2 = isMargin ? row.values[2] : (row.values[2]?.value ?? undefined);
          const changeA = isMargin ? formatPts(marginPtsChange(v0 as number | undefined, v1 as number | undefined)) : formatChange(v0 as number | undefined, v1 as number | undefined, unit).text;
          const changeB = isMargin ? formatPts(marginPtsChange(v1 as number | undefined, v2 as number | undefined)) : formatChange(v1 as number | undefined, v2 as number | undefined, unit).text;
          return (
            <tr key={row.label} style={{ borderTop: "1px solid var(--border-subtle)" }}>
              <td style={{ padding: "8px 8px 8px 0", fontWeight: !isMargin && row.bold ? 600 : 400, minWidth: 170 }}>{row.label}</td>
              <td style={{ padding: 8, textAlign: "right" }}>
                {isMargin ? <MarginCell value={row.values[0]} bold /> : annualCellNode(row.values[0], unit, row.bold)}
              </td>
              <td style={{ padding: 8, textAlign: "right", background: "#FBF8F3" }}><ChangeText text={changeA} /></td>
              <td style={{ padding: 8, textAlign: "right", color: "var(--text-secondary)" }}>
                {isMargin ? <MarginCell value={row.values[1]} /> : annualCellNode(row.values[1], unit)}
              </td>
              <td style={{ padding: 8, textAlign: "right", background: "#FBF8F3" }}><ChangeText text={changeB} /></td>
              <td style={{ padding: 8, textAlign: "right", color: "var(--text-secondary)" }}>
                {isMargin ? <MarginCell value={row.values[2]} /> : annualCellNode(row.values[2], unit)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
