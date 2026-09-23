"use client";

import { PageData } from "@/lib/present/buildPageData";
import { CompanySearch } from "@/components/CompanySearch";
import { Lens } from "@/lib/rules/dealStructure";
import { lensToggleLabel } from "@/lib/present/lensNames";

function formatDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${d}, ${y}`;
}

export function TickerHeader({
  tickerInput,
  onTickerInputChange,
  onSubmit,
  page,
  lens,
  onLensChange,
}: {
  tickerInput: string;
  onTickerInputChange: (v: string) => void;
  /** Receives the ticker explicitly: a picked result must not depend on input state having flushed. */
  onSubmit: (ticker: string) => void;
  page: PageData | null;
  lens: Lens;
  onLensChange: (l: Lens) => void;
}) {
  const due = page?.header.dueBy;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text-tertiary)" }}>EARNINGS LENS</div>
        <h1 className="font-serif" style={{ margin: 0, fontWeight: 600, fontSize: 32, overflowWrap: "break-word" }}>
          {page ? page.companyName : "Enter a ticker"}
        </h1>
        {page && (
          <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>
            {page.header.newResultsAnnounced ? (
              <span>
                New results announced <strong style={{ color: "var(--text-primary)" }}>{formatDate(page.header.newResultsAnnounced.date)}</strong>. Full figures arrive with the 10-Q.
              </span>
            ) : (
              <span>
                Financials for the quarter ended{" "}
                <strong style={{ color: "var(--text-primary)" }}>{formatDate(page.header.periodEndDate)}</strong> ({page.header.fiscalQuarterLabel})
                {due && (
                  <>
                    {" "}&middot; Next {due.form} due by{" "}
                    <strong style={{ color: "var(--text-primary)" }}>
                      {due.isEstimated ? "~" : ""}
                      {formatDate(due.dueDate)}
                    </strong>
                  </>
                )}
              </span>
            )}
            {/*
              A filing EDGAR lists but has not published figures for yet.
              Without this line the board shows the previous quarter under
              no explanation at all, which is how a stale board passes for
              a current one.
            */}
            {page.header.awaitingFigures && (
              <div style={{ marginTop: 4, fontSize: 13, color: "var(--text-tertiary)" }}>
                A {page.header.awaitingFigures.form} for the quarter ended{" "}
                {formatDate(page.header.awaitingFigures.periodEnd)} was filed{" "}
                {formatDate(page.header.awaitingFigures.filingDate)}; EDGAR has not published its figures yet, so
                the board shows the quarter before it.
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label htmlFor="tk" style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)" }}>
            Ticker or company
          </label>
          <CompanySearch value={tickerInput} onChange={onTickerInputChange} onSubmit={onSubmit} />
        </div>
        <div style={{ display: "flex", padding: 4, gap: 4, background: "#EAE6DD", borderRadius: 10 }}>
          {(["Services", "SaaS"] as Lens[]).map((l) => (
            <button
              key={l}
              data-lens={l}
              onClick={() => onLensChange(l)}
              style={{
                height: 40,
                padding: "0 14px",
                border: 0,
                borderRadius: 7,
                background: lens === l ? (l === "Services" ? "#1F6F5C" : "#3B4BA8") : "transparent",
                color: lens === l ? "#FFFFFF" : "var(--text-secondary)",
                fontFamily: "inherit",
                fontSize: 14,
                fontWeight: lens === l ? 600 : 400,
                cursor: "pointer",
              }}
            >
              {lensToggleLabel(l)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
