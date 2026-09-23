"use client";

import { useRef } from "react";
import { PageData } from "@/lib/present/buildPageData";
import { VerdictMatrix } from "@/components/VerdictMatrix";
import { SummaryCard } from "@/components/SummaryCard";
import { WhyThisVerdict } from "@/components/WhyThisVerdict";
import { StandOutList } from "@/components/StandOutList";
import { BoardActions } from "@/components/BoardActions";
import { Footer } from "@/components/Footer";
import { buildStandOut } from "@/lib/present/standOut";
import { buildSummary } from "@/lib/present/summary";
import { heroSubline, whyThisVerdict } from "@/lib/present/verdictReasons";
import { formatPeriodEnd } from "@/lib/present/format";
import { Lens } from "@/lib/rules/dealStructure";
import { LENS_NAME } from "@/lib/present/lensNames";
import { fiscalYearInfo } from "@/lib/present/fiscalYear";
import type { PanelTab } from "@/components/FinancialsPanel";

/**
 * The lens section, top to bottom: identity line; title and lens question;
 * the verdict hero; the matrix beside the Summary and "Why this verdict";
 * "What stands out", whose findings close with the filing's own
 * explanation where there is one; the two buttons; the footnotes.
 *
 * The opportunity and risk signal cards are gone, and so is the
 * deal-structure table: the signals are still computed and still drive the
 * matrix, the ladder and "What stands out", but shown separately they
 * repeated the key financials a reader had just scrolled past. Payment
 * terms are the last "What stands out" item; credit exposure and the
 * product-focus handover live in the Copy brief, where the deal desk and
 * GTM actually use them.
 */
export function LensBoard({
  page,
  lensName,
  onOpenTab,
}: {
  page: PageData;
  lensName: Lens;
  onOpenTab?: (tab: PanelTab) => void;
}) {
  const lens = page.lenses[lensName];
  const color = lensName === "Services" ? "#1F6F5C" : "#3B4BA8";
  const question =
    lensName === "Services"
      ? "Can we safely do business with them, and on what structure?"
      : "Can they become a durable, expanding customer?";

  // One evaluation of "What stands out" per board: the Summary quotes the
  // item it singles out, so the two must be looking at the same list.
  const standOut = buildStandOut(lens, page.keyFinancials, page.health, page.flows, page.ticker);
  const summary = buildSummary(lens, page.keyFinancials, page.health, standOut);
  const fy = fiscalYearInfo(page.keyFinancials);

  // "Download image" captures this element: header through footer, so the
  // period, the source line and the declared values are always in the
  // picture with the verdict.
  const boardRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={boardRef}
      data-lens-board
      style={{ display: "flex", flexDirection: "column", gap: 20, padding: "22px 16px", border: `2px solid ${color}`, borderRadius: 14, background: "#FFFFFF" }}
    >
      {/*
        The board's own identity line. The page header above already says
        all of this, but the header is not in the downloaded image -- and
        a verdict picture with no company or period on it is the thing the
        image feature exists to prevent.
      */}
      <div style={{ fontSize: 12, color: "var(--text-tertiary)", letterSpacing: "0.02em" }}>
        {page.companyName} ({page.ticker}) &middot; {fy ? <>fiscal year {fy.short} &middot; </> : null}quarter ended {formatPeriodEnd(page.header.periodEndDate)} (
        {page.header.fiscalQuarterLabel}) &middot; {LENS_NAME[lensName]} lens
      </div>

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div className="font-serif" style={{ fontSize: 24, fontWeight: 600 }}>
          What this means for {LENS_NAME[lensName]}
        </div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", fontStyle: "italic" }}>{question}</div>
      </div>

      {/*
        The verdict, first and largest: the quadrant, then the two axes and
        the terms in one line. The Summary below starts after the verdict
        because this already says it.
      */}
      <div className="verdict-hero font-serif" style={{ color }}>
        <span style={{ color: "var(--text-primary)" }}>Verdict:</span> {lens.quadrant}
        <div className="verdict-hero-sub">{heroSubline(lens)}</div>
      </div>

      <div className="lens-top">
        <div>
          <VerdictMatrix
            ticker={page.ticker}
            lens={lensName}
            opportunityHigh={lens.opportunity.high}
            riskHigh={lens.risk.high}
            rung={lens.ladder.rung}
            quadrant={lens.quadrant}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <SummaryCard summary={summary} />
          <WhyThisVerdict why={whyThisVerdict(lens, page.keyFinancials)} />
        </div>
      </div>

      <StandOutList items={standOut} explained={page.explained} onOpenTab={onOpenTab} />

      <BoardActions page={page} lens={lens} boardRef={boardRef} />
      <Footer page={page} />
    </div>
  );
}
