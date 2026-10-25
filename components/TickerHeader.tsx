"use client";

import { useSyncExternalStore } from "react";
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

const PHONE = "(max-width: 640px)";

/** True at phone width; false on the server and on wider screens. */
function usePhone(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(PHONE);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(PHONE).matches,
    () => false
  );
}

/** The period line, and the results banner and awaiting-figures note beside it. */
function PeriodLines({ page }: { page: PageData }) {
  const due = page.header.dueBy;
  return (
    <div className="hdr-sub">
      <span>
        Financials for the quarter ended <strong>{formatDate(page.header.periodEndDate)}</strong> ({page.header.fiscalQuarterLabel})
        {due && (
          <>
            {" "}
            · Next {due.form} due by{" "}
            <strong>
              {due.isEstimated ? "~" : ""}
              {formatDate(due.dueDate)}
            </strong>
          </>
        )}
      </span>
      {/* Results announced for a newer quarter than the one shown: beside the period line, never in place of it. */}
      {page.header.newResultsAnnounced && (
        <span className="hdr-note">
          New results announced <strong>{formatDate(page.header.newResultsAnnounced.date)}</strong> · full figures arrive with the{" "}
          {page.header.newResultsAnnounced.form ?? "next periodic filing"}
        </span>
      )}
      {/* A filing EDGAR lists but has not published figures for yet: the board shows the quarter before it. */}
      {page.header.awaitingFigures && (
        <span className="hdr-note hdr-muted">
          {page.header.awaitingFigures.form} for the quarter ended {formatDate(page.header.awaitingFigures.periodEnd)} filed{" "}
          {formatDate(page.header.awaitingFigures.filingDate)} · figures not yet published by EDGAR · showing the quarter before it
        </span>
      )}
    </div>
  );
}

/**
 * The sticky page header (mock V24): kicker, company name, period line,
 * search and the lens switch. At phone width the sticky bar is compact --
 * company name and lens switch only -- and the period line and search sit
 * just below it, so they scroll away but are still there.
 */
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
  const phone = usePhone();
  const search = (
    <div className="hdr-search">
      <label htmlFor="tk">Ticker or company</label>
      <CompanySearch value={tickerInput} onChange={onTickerInputChange} onSubmit={onSubmit} />
    </div>
  );
  return (
    <>
      <header className="hdr">
        <div className="hdr-left">
          <div className="hdr-kicker">EARNINGS LENS</div>
          <h1 className="hdr-name font-serif">{page ? page.companyName : "Enter a ticker"}</h1>
          {page && !phone && <PeriodLines page={page} />}
        </div>
        <div className="hdr-right">
          {!phone && search}
          <div className="lens-switch">
            {(["Services", "SaaS"] as Lens[]).map((l) => (
              <button
                key={l}
                type="button"
                data-lens={l}
                aria-pressed={lens === l}
                onClick={() => onLensChange(l)}
                style={{ background: lens === l ? (l === "Services" ? "#1F6F5C" : "#3B4BA8") : "transparent", color: lens === l ? "#FFFFFF" : "var(--text-secondary)" }}
              >
                {lensToggleLabel(l)}
              </button>
            ))}
          </div>
        </div>
      </header>
      {phone && (
        <div className="hdr-phone">
          {page && <PeriodLines page={page} />}
          {search}
        </div>
      )}
    </>
  );
}
