"use client";

import { useEffect, useState, useCallback } from "react";
import { PageData } from "@/lib/present/buildPageData";
import { Lens } from "@/lib/rules/dealStructure";
import { nullsToUndefined } from "@/lib/present/sanitizeJson";
import { TickerHeader } from "@/components/TickerHeader";
import { FinancialsPanel, PanelTab } from "@/components/FinancialsPanel";
import { HealthTiles } from "@/components/HealthTiles";
import { LensBoard } from "@/components/LensBoard";

export default function Home() {
  const [tickerInput, setTickerInput] = useState("NVDA");
  const [lens, setLens] = useState<Lens>("Services");
  const [page, setPage] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<PanelTab>("kf");

  // A finding's statement tag opens that tab and brings the panel into view.
  const openTab = useCallback((t: PanelTab) => {
    setTab(t);
    document.getElementById("financials")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

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
        setPage(nullsToUndefined(data) as PageData);
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
          setPage(nullsToUndefined(data) as PageData);
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

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-page)" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "24px 16px 64px", display: "flex", flexDirection: "column", gap: 20 }}>
        <div
          style={{
            background: "#F6F4EF",
            border: "1px solid var(--border-card)",
            borderRadius: 12,
            padding: "24px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
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
            <>
              <FinancialsPanel key={page.ticker} page={page} tab={tab} onTabChange={setTab} />
              <HealthTiles health={page.health} segments={page.segments} redFlags={page.lenses.Services.redFlags} kf={page.keyFinancials} />
              <LensBoard page={page} lensName={lens} onOpenTab={openTab} />
            </>
          )}
        </div>

        <div style={{ fontSize: 12, color: "var(--text-tertiary)", textAlign: "center" }}>
          Earnings Lens &mdash; a self-serve counterparty assessment from SEC EDGAR filings. Not investment advice.
        </div>
      </div>
    </div>
  );
}
