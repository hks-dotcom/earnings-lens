"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { PageData } from "@/lib/present/buildPageData";
import { Lens } from "@/lib/rules/dealStructure";
import { nullsToUndefined } from "@/lib/present/sanitizeJson";
import { TickerHeader } from "@/components/TickerHeader";
import { FinancialsPanel, PanelTab } from "@/components/FinancialsPanel";
import { VerdictCard } from "@/components/VerdictCard";
import { HealthSection } from "@/components/HealthSection";
import { SegmentsSection } from "@/components/SegmentsSection";
import { StandOutList } from "@/components/StandOutList";
import { shownFindings, standOutRows } from "@/lib/present/standOutRows";
import { ExplainedFromFilings } from "@/components/ExplainedFromFilings";
import { HowVerdictWorks } from "@/components/HowVerdictWorks";
import { buildStandOut } from "@/lib/present/standOut";
import { formatPeriodEnd } from "@/lib/present/format";
import { LENS_NAME } from "@/lib/present/lensNames";
import type { Seller } from "@/lib/verdict/types";

/**
 * The API's JSON as page data. Statement series use undefined for a
 * missing cell, so their nulls are turned back into undefined; the S5
 * verdict model uses null for missing throughout (as the engine does), so
 * it is kept exactly as sent.
 */
function fromJson(data: PageData): PageData {
  return { ...(nullsToUndefined(data) as PageData), verdict: data.verdict };
}

export default function Home() {
  const [tickerInput, setTickerInput] = useState("NVDA");
  const [lens, setLens] = useState<Lens>("Services");
  const [page, setPage] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<PanelTab>("kf");

  const load = useCallback(async (ticker: string) => {
    if (!ticker.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/lens/${encodeURIComponent(ticker.trim().toUpperCase())}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to load ticker.");
        setPage(null);
      } else {
        setPage(fromJson(data));
      }
    } catch {
      setError("Network error fetching ticker data.");
      setPage(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadInitial() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/lens/NVDA`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "Failed to load ticker.");
        } else {
          setPage(fromJson(data));
        }
      } catch {
        if (!cancelled) setError("Network error fetching ticker data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadInitial();
    return () => {
      cancelled = true;
    };
    // Runs once on mount only -- the ticker input's own submit uses `load` directly.
  }, []);

  const boardRef = useRef<HTMLDivElement>(null);
  const seller = LENS_NAME[lens] as Seller;
  const findings = page ? shownFindings(buildStandOut(page.signals, page.keyFinancials, page.health, page.flows, page.ticker)) : [];

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-page)" }}>
      <div className="page-wrap">
        <div className="page-panel">
          <TickerHeader
            tickerInput={tickerInput}
            onTickerInputChange={setTickerInput}
            onSubmit={(t) => load(t)}
            page={page}
            lens={lens}
            onLensChange={setLens}
          />

          {loading && <div style={{ color: "var(--text-secondary)" }}>Loading&hellip;</div>}
          {error && (
            <div style={{ color: "var(--bad-text)", background: "var(--bad-tint-bg)", borderRadius: 8, padding: "10px 14px" }}>
              {error}
            </div>
          )}

          {page && (
            <div ref={boardRef} className="board">
              {/* In the downloaded image only: the header is not in the picture, and a verdict picture with no company or period on it is what the image feature exists to prevent. */}
              <div className="board-id">
                {page.companyName} ({page.ticker}) · {page.header.fiscalQuarterLabel}, quarter ended {formatPeriodEnd(page.header.periodEndDate)} · {seller}
              </div>
              {/* The verdict board: what scripts/screenshots.mjs holds to the phone width. The statement tables below scroll sideways inside their own box, as before. */}
              <div className="board" data-lens-board>
                <VerdictCard page={page} seller={seller} boardRef={boardRef} />
                <HealthSection page={page} />
                <SegmentsSection page={page} />
                <StandOutList rows={standOutRows(findings, page.verdict.filingItem)} />
                <ExplainedFromFilings explained={page.explained} findings={findings} />
              </div>
              <FinancialsPanel key={page.ticker} page={page} tab={tab} onTabChange={setTab} />
              <HowVerdictWorks />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
