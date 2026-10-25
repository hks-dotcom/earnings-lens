"use client";

import { PageData } from "@/lib/present/buildPageData";
import { AreaCard, HEALTH_STEPS, money, moneyUnrounded, NOT_AVAILABLE } from "@/lib/present/verdictPage";
import { formatPeriodEnd } from "@/lib/present/format";
import { NOT_FULLY_MEASURABLE } from "@/lib/verdict/display";
import { InfoTip, TipSection } from "@/components/InfoTip";
import { StepBar } from "@/components/StepBar";

/** The ⓘ sections for one area card, in plain words (rules 4.3, 16, 17.2, 17.6). */
function areaTip(a: AreaCard): TipSection[] {
  return [
    { heading: "Formula", bullets: a.tip.formula },
    { heading: "This quarter", bullets: a.tip.thisQuarter },
    { heading: "Critical filing", bullets: a.tip.critical },
    { heading: "Could not run", bullets: a.tip.couldNotRun },
    { heading: "Warning when", bullets: a.tip.warningWhen },
  ];
}

function Card({ a, side }: { a: AreaCard; side: "left" | "right" }) {
  return (
    <div className="hcard">
      <div className="hcard-head">
        <span>{a.title}</span>
        <InfoTip label={a.title} sections={areaTip(a)} side={side} />
      </div>
      <StepBar steps={a.scale} current={a.level} height={5} fontSize={11} gap={2} maxWidth={200} />
      {a.notFullyMeasurable && <span className="nfm-tag">{NOT_FULLY_MEASURABLE}</span>}
      <div className="hcard-value">{a.value}</div>
      {a.valueNote && <span className="hcard-note">{a.valueNote}</span>}
      <ul className="hcard-pts">
        {a.bullets.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Liquidity vs debt for the latest quarter, from the figures the verdict
 * used (rules 2: liquidity, total debt and net debt on one scope). The
 * filing's own captions are added when the strip's balance-sheet read
 * gives the same totals.
 */
function LiquidityStrip({ page }: { page: PageData }) {
  const l = page.verdict.liquidity;
  const strip = page.liquidity.latest;
  const values = [l.liquidity, l.debt].filter((v): v is number => v !== null);
  const max = values.length ? Math.max(...values) : 0;
  const width = (v: number | null) => (v === null || max <= 0 ? 0 : Math.max(0, (v / max) * 100));
  // V24's capitals for the strip header; zero is neither net debt nor net cash (rules 17.6).
  const net = (v: number | null) => (v === null ? `Net debt — ${NOT_AVAILABLE}` : v < 0 ? `Net Cash ${money(-v)}` : v > 0 ? `Net Debt ${money(v)}` : "Net debt of zero");
  const same = (a: number | undefined, b: number | null) => a !== undefined && b !== null && Math.abs(a - b) < 0.5;
  const notes: string[] = [];
  if (same(strip.liquidity, l.liquidity)) {
    const parts = [...strip.cashLines, ...strip.investmentLines].filter((x) => x.value !== 0).map((x) => `${x.caption} ${money(x.value)}`);
    if (parts.length) notes.push(parts.join(" + "));
  }
  notes.push(...l.notes.map((n) => n[0].toUpperCase() + n.slice(1)));
  if (l.netDebt !== null && l.netDebt !== 0) notes.push(`${l.netDebt < 0 ? "Net cash" : "Net debt"} ${moneyUnrounded(Math.abs(l.netDebt))} before rounding`);
  return (
    <div className="hstrip">
      <div className="hstrip-head">
        <span style={{ color: "var(--text-secondary)" }}>
          Liquidity vs debt · {page.verdict.periodLabel} · {formatPeriodEnd(page.header.periodEndDate)}
        </span>
        <span>
          <strong>{net(l.netDebt)}</strong>
          {l.netDebtYearAgo !== null && <> · {net(l.netDebtYearAgo)} a year ago</>}
        </span>
      </div>
      <div className="hstrip-bars">
        <span>Cash and short-term investments</span>
        <div className="hstrip-track">
          <div style={{ width: `${width(l.liquidity)}%`, background: "#1f6f5c" }} />
        </div>
        <span className="font-mono hstrip-amt">{money(l.liquidity)}</span>
        <span>Debt</span>
        <div className="hstrip-track">
          <div style={{ width: `${width(l.debt)}%`, background: "#5b6770" }} />
        </div>
        <span className="font-mono hstrip-amt">{money(l.debt)}</span>
      </div>
      <ul className="hstrip-notes">
        {notes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Financial health (mock V24, rules 4.3, 10, 16, 17.2, 17.5): the state
 * bar, the subtitle, the summary bullets, the five area cards, the
 * liquidity strip and the other ratios. Shared by both sellers.
 */
export function HealthSection({ page }: { page: PageData }) {
  const v = page.verdict;
  return (
    <section id="health" className="v5-section hsec">
      <div className="hsec-head">
        <span className="v5-k">FINANCIAL HEALTH</span>
        <div className="hsec-scale">
          <StepBar steps={HEALTH_STEPS} current={v.state} height={8} fontSize={13} ariaLabel={`Health: ${v.state}, on a scale of ${HEALTH_STEPS.join(", ")}`} />
        </div>
        <span className="hsec-sub">{v.subtitle}</span>
      </div>
      <ul className="hsec-summary">
        {v.summary.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>
      <div className="hcards">
        {v.areas.map((a, i) => (
          <Card key={a.area} a={a} side={i < 3 ? "left" : "right"} />
        ))}
      </div>
      <LiquidityStrip page={page} />
      <div className="hratios-wrap">
        <div className="v5-k" style={{ letterSpacing: "0.06em" }}>
          OTHER RATIOS
        </div>
        <div className="hratios">
          {v.ratios.map((k, i) => (
            <div key={k.key} className="hratio">
              <div className="hratio-head">
                <span>{k.label}</span>
                <InfoTip
                  label={k.label}
                  side={i < 3 ? "left" : "right"}
                  top={34}
                  sections={[
                    { heading: "Formula", bullets: [k.formula.replace(/\.$/, "")] },
                    { heading: "What it means", bullets: k.means.split(" · ") },
                  ]}
                  foot={k.foot}
                />
              </div>
              <span className="hratio-v">{k.value}</span>
              {k.key === "debtToEquity" && k.valueNote && !page.keyFinancials.debtTagFiledInLookback ? (
                <span className="hratio-b">debt not tagged in filings</span>
              ) : (
                k.valueNote && <span className="hratio-b">{k.valueNote}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
