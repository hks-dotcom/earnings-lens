"use client";

import { useEffect, useState } from "react";
import { PageData } from "@/lib/present/buildPageData";
import { KeyFinancialsTable } from "@/components/KeyFinancialsTable";
import { ScrollHint } from "@/components/ScrollHint";
import { chooseUnit, formatMoney, formatPeriodEnd, Unit } from "@/lib/present/format";
import { fiscalYearInfo } from "@/lib/present/fiscalYear";
import { isValue, StatementColumn, StatementRow, Statements, StatementValue } from "@/lib/xbrl/statements";
import {
  cellTitle,
  changeText,
  derivedMark,
  displayValue,
  isRed,
  RECAST_MARK,
  recastText,
  statementFootnote,
  StatementTab,
} from "@/lib/present/statementDisplay";

/**
 * The financials panel: Key financials and the three statements, sharing
 * one Quarterly / Annual toggle.
 *
 * The statements load after the board, in the background, from the moment
 * the page has a company. When a filing hasn't been read before, the panel
 * reads it one request at a time and says so ("Reading filing 3 of 8");
 * the board above never waits for any of it.
 */

export type PanelTab = "kf" | StatementTab;

const TABS: { key: PanelTab; label: string }[] = [
  { key: "kf", label: "Key financials" },
  { key: "income", label: "Income statement" },
  { key: "balance", label: "Balance sheet" },
  { key: "cashFlow", label: "Cash flow" },
];

type LoadState =
  | { status: "loading" }
  | { status: "reading"; n: number; m: number }
  | { status: "ready"; statements: Statements }
  | { status: "error"; message: string };

function useStatements(ticker: string): LoadState {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    const base = `/api/statements/${encodeURIComponent(ticker)}`;
    async function load() {
      setState({ status: "loading" });
      try {
        let res = await fetch(base);
        let body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Statements failed.");
        if (body.status === "needs") {
          const toRead = (body.filings as { accessionNumber: string; stored: boolean }[]).filter((f) => !f.stored);
          // One filing per request, one after another: each request stays
          // short, and EDGAR sees one reader at a time.
          for (let i = 0; i < toRead.length; i++) {
            if (cancelled) return;
            setState({ status: "reading", n: i + 1, m: toRead.length });
            const r = await fetch(`${base}/filings/${encodeURIComponent(toRead[i].accessionNumber)}`, { method: "POST" });
            if (!r.ok) throw new Error((await r.json()).error ?? "Reading a filing failed.");
          }
          res = await fetch(base);
          body = await res.json();
          if (!res.ok || body.status !== "ready") throw new Error(body.error ?? "Statements failed.");
        }
        if (!cancelled) setState({ status: "ready", statements: body.statements as Statements });
      } catch (err) {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : "Statements failed." });
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [ticker]);
  return state;
}

function PeriodHead({ col }: { col: StatementColumn }) {
  return (
    <th className="st-head">
      {col.label}
      <span>{formatPeriodEnd(col.periodEnd)}</span>
    </th>
  );
}

function StatementTable({ s, tab, annual, unit }: { s: Statements; tab: StatementTab; annual: boolean; unit: Unit }) {
  const cols = annual ? s.years : s.quarters;
  const rows = s[tab].filter((r) => !r.hidden);
  return (
    <ScrollHint cue={annual ? "scroll for earlier years" : "scroll for earlier quarters"}>
      <table className="st-table">
        <thead>
          <tr>
            <th className="st-head st-label">{unit.label}</th>
            {cols.map((c) => (
              <PeriodHead key={c.accessionNumber + c.label} col={c} />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Row key={r.key} r={r} cols={cols} annual={annual} unit={unit} />
          ))}
        </tbody>
      </table>
    </ScrollHint>
  );
}

/**
 * The cell's marks. A recast cell's mark opens its own note on hover, focus
 * or tap -- the one provenance line a reader needs to see, not only find in
 * the native tooltip -- so it can be read and screenshotted like the "i" tips.
 */
function CellMarks({ cell, unit }: { cell: StatementValue; unit: Unit }) {
  const [open, setOpen] = useState(false);
  const recast = recastText(cell, unit);
  const marks = derivedMark(cell);
  if (!recast) return <span className="st-mark">{marks}</span>;
  return (
    <>
      <span className="st-mark">{marks.replace(RECAST_MARK, "")}</span>
      <span
        className="recast-wrap"
        tabIndex={0}
        role="button"
        aria-label={recast}
        data-open={open ? "true" : "false"}
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
          if (e.key === "Escape") setOpen(false);
        }}
      >
        <span className="st-mark">{RECAST_MARK}</span>
        <span className="recast-box" role="tooltip">
          {recast}
        </span>
      </span>
    </>
  );
}

function Row({ r, cols, annual, unit }: { r: StatementRow; cols: StatementColumn[]; annual: boolean; unit: Unit }) {
  if (r.kind === "section") {
    return (
      <tr className="st-section">
        <td colSpan={cols.length + 1}>{r.label.toUpperCase()}</td>
      </tr>
    );
  }
  const cells = annual ? r.annual : r.quarterly;
  const cls = r.kind === "total" ? "st-total" : r.kind === "of" ? "st-of" : "";
  return (
    <tr className={cls}>
      <td className="st-label">{r.label}</td>
      {r.notFiled ? (
        <td className="st-notfiled" colSpan={cols.length}>
          Not filed
        </td>
      ) : (
        cells.map((c, i) => {
          const title = cellTitle(r, cols[i], c, unit);
          if (!isValue(c)) {
            return (
              <td key={i} className="st-missing" title={title}>
                MISSING
              </td>
            );
          }
          const change = i < cells.length - 1 ? changeText(c, cells[i + 1], unit) : "";
          return (
            <td key={i} title={title}>
              <span className={isRed(r, c) ? "st-neg" : undefined}>{formatMoney(displayValue(r, c), unit)}</span>
              <CellMarks cell={c} unit={unit} />
              {change && <span className="st-change">{change}</span>}
            </td>
          );
        })
      )}
    </tr>
  );
}

export function FinancialsPanel({
  page,
  tab,
  onTabChange,
}: {
  page: PageData;
  tab: PanelTab;
  onTabChange: (t: PanelTab) => void;
}) {
  const [annual, setAnnual] = useState(false);
  const statements = useStatements(page.ticker);
  const unit = chooseUnit(page.keyFinancials.revenue.values[0]?.value);
  const fy = fiscalYearInfo(page.keyFinancials);
  const latest = page.keyFinancials.quarters[0];

  return (
    <div id="financials" className="fin-panel">
      <div className="fin-coid">
        <b>
          {page.companyName} ({page.ticker})
        </b>
        <span>
          {fy ? `Fiscal year runs ${fy.startMonth} to ${fy.endMonth}, so ${fy.label} = ${fy.period} · ` : ""}
          latest quarter {latest?.label}, ended {formatPeriodEnd(latest?.periodEnd)}
        </span>
      </div>
      <div className="fin-head">
        <div className="fin-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => onTabChange(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="fin-seg" role="group" aria-label="Period">
          <button aria-pressed={!annual} onClick={() => setAnnual(false)}>
            Quarterly
          </button>
          <button aria-pressed={annual} onClick={() => setAnnual(true)}>
            Annual
          </button>
        </div>
      </div>
      <div className="fin-unit">{unit.label.toUpperCase()}</div>

      {tab === "kf" ? (
        <KeyFinancialsTable kf={page.keyFinancials} health={page.health} annual={page.annual} showAnnual={annual} />
      ) : statements.status === "ready" ? (
        <>
          <StatementTable s={statements.statements} tab={tab} annual={annual} unit={unit} />
          <p className="fin-note">{statementFootnote(statements.statements, tab, annual, unit)}</p>
        </>
      ) : (
        <p className="fin-loading" role="status">
          {statements.status === "reading"
            ? `Reading filing ${statements.n} of ${statements.m}`
            : statements.status === "error"
              ? `The statements couldn't be loaded: ${statements.message}`
              : "Loading the statements"}
        </p>
      )}
    </div>
  );
}
