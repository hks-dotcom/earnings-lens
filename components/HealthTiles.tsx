import { ALTMAN_CAP_NOTE, FinancialHealth } from "@/lib/metrics/health";
import { SegmentRevenue } from "@/lib/xbrl/segments";
import { RedFlagsResult } from "@/lib/rules/redFlags";
import { KeyFinancials } from "@/lib/xbrl/keyFinancials";
import { Tooltip } from "@/components/Tooltip";
import { chooseUnit, dayAfter, formatMoneyInline, formatPeriodEnd, formatPeriodRange } from "@/lib/present/format";
import {
  componentsLine,
  LIQUIDITY_TIP,
  LiquidityDebt,
  liquidityAmount,
  liquidityLabel,
  netHeader,
  NO_DEBT,
} from "@/lib/present/liquidityDebt";
import { HEALTH_BENCHMARKS } from "@/lib/rules/declaredValues";

/**
 * Verbatim from the spec's "Plain-English explanations": formula first,
 * then the explanation. The formula comes first because it is the part a
 * reader can check against the table; the prose only helps once you know
 * what was divided by what.
 */
const TIPS: Record<string, { formula: string; explanation: string }> = {
  currentRatio: {
    formula: "Current assets ÷ current liabilities.",
    explanation:
      "What they'll turn into cash within a year, compared with what they have to pay within a year. 1x means just covered; above 1x means room to spare. Higher is safer.",
  },
  debtEquity: {
    formula: "Long-term debt (including the part due this year) ÷ total equity.",
    explanation:
      "How much they've borrowed for every $1 of their own money (what owners put in plus profits kept). 0.15 means 15 cents borrowed per dollar owned. Lower means less reliance on lenders.",
  },
  dso: {
    formula:
      "Days sales outstanding = receivables at quarter end ÷ quarterly revenue × days in the quarter.",
    explanation:
      "How many days of sales their customers still owe them. It shows how fast they collect, not how fast they'd pay us.",
  },
  dpo: {
    formula:
      "Days payables outstanding = payables at quarter end ÷ quarterly cost of revenue × days in the quarter.",
    explanation:
      "Their unpaid bills, measured in days of their cost of sales. If it rises year on year, they may be paying suppliers more slowly, and would likely do the same to us. Payables include bills that aren't for supplies, so compare a company with its own past, not with other companies.",
  },
  altmanZ: {
    formula:
      "6.56 × (working capital ÷ total assets) + 3.26 × (retained earnings ÷ total assets) + 6.72 × (operating income, last 12 months ÷ total assets) + 1.05 × (total equity ÷ total liabilities).",
    explanation:
      "A standard financial-strength score built from four questions: do they have short-term cash to spare; have they built up profits over the years; is the business earning from its assets right now; and how much of the company is owned outright versus owed to others. Above 2.6 is safe, below 1.1 signals distress, in between is a grey zone. It uses no share price. It flags the risk of financial distress; it doesn't judge whether the business is good.",
  },
  redFlags: {
    formula:
      "Count of these filings in the last 12 months: going-concern warning, late-filing notice, bankruptcy, debt called early, auditor change, restatement, or a missed filing deadline.",
    explanation:
      "Filings that often signal trouble with money or with the accounts. A restructuring shows under spending cuts, not here. Going concern isn't checked, because companies don't file it in a form the app can read.",
  },
};

/** "nvda:ComputeAndNetworkingSegmentMember" -> "Compute & Networking". Cosmetic only -- the raw member QName is still what's in the data. */
function prettifyMember(member: string): string {
  const withoutNamespace = member.replace(/^[a-zA-Z]+:/, "");
  const withoutSuffixes = withoutNamespace.replace(/(Segment)?Member$/, "");
  const spaced = withoutSuffixes.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.replace(/\bAnd\b/g, "&");
}

function Tile({
  label,
  value,
  sub,
  tooltip,
  align,
}: {
  label: string;
  value: string;
  /** The benchmark line; the red-flags tile has none. */
  sub?: string;
  tooltip: { key: keyof typeof TIPS; label: string };
  align?: "right";
}) {
  const tip = TIPS[tooltip.key];
  return (
    <div className="health-tile" style={{ display: "flex", flexDirection: "column", gap: 4, padding: "0 14px", borderLeft: "1px solid var(--border-subtle)" }}>
      <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
        {label}
        <Tooltip label={tooltip.label} formula={tip.formula} explanation={tip.explanation} align={align} />
      </div>
      <div style={{ fontSize: 20, fontWeight: 600, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div className="hsub">{sub}</div>}
    </div>
  );
}

/**
 * Segment revenue, or nothing.
 *
 * "Hidden when the company has a single reportable segment, or the only
 * segment equals total revenue: one line that repeats revenue implies a
 * breakdown that doesn't exist." A lone segment line is worse than no
 * line: it looks like a breakdown, reads like new information, and is
 * just the revenue row again under a different name.
 */
function SegmentLine({ segments, kf }: { segments: SegmentRevenue | null; kf: KeyFinancials }) {
  if (!segments || !segments.axis || segments.values.length === 0) {
    return <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Segment revenue: not filed under either axis for this period.</div>;
  }
  if (segments.values.length < 2) return null;

  const unit = chooseUnit(kf.revenue.values[0]?.value);
  const axisName =
    segments.axis === "us-gaap:StatementBusinessSegmentsAxis" ? "Operating segments" : "Segments (product/market)";

  let periodNote = "";
  if (segments.periodKind === "derived-quarterly") {
    // "Name the derived Q4 period": which quarter, over what dates, how.
    const q = kf.quarters[0];
    const range = formatPeriodRange(dayAfter(kf.quarters[1]?.periodEnd), q?.periodEnd);
    periodNote = `, ${q?.label ?? "Q4"}${range ? ` (${range})` : ""} derived as the fiscal-year total minus Q1 to Q3`;
  } else if (segments.periodKind === "annual-only") {
    periodNote = ", full fiscal year – no quarterly breakout filed";
  }

  return (
    <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
      {axisName} (as filed{periodNote}):{" "}
      {segments.values.map((s) => `${prettifyMember(s.member)} ${formatMoneyInline(s.value, unit)}`).join(" · ")}
    </div>
  );
}

/**
 * Liquidity vs debt for the latest quarter: two full-width bars on one
 * scale, the period beside the title, and last year's net figure as a
 * muted clause in the header. Teal for liquidity, slate for debt; nothing
 * red or green, because neither side is good or bad news on its own.
 */
function LiquidityStrip({ l }: { l: LiquidityDebt }) {
  const p = l.latest;
  const values = [p.liquidity, p.debt].filter((v): v is number => v !== undefined);
  const max = values.length ? Math.max(...values) : 0;
  const width = (v: number | undefined) => (v === undefined || max <= 0 ? 0 : Math.max(0, (v / max) * 100));
  const head = netHeader(l);
  return (
    <div className="liq">
      <div className="liq-head">
        <div className="liq-k">
          Liquidity vs debt
          <Tooltip label="Liquidity vs debt" text={LIQUIDITY_TIP} />
          {p.label && (
            <span className="liq-per">
              {p.label}
              {p.periodEnd && ` · ${formatPeriodEnd(p.periodEnd)}`}
            </span>
          )}
        </div>
        <div className="liq-net">
          {head.now}
          {head.yearAgo && <span>{head.yearAgo}</span>}
        </div>
      </div>
      <div className="liq-bar">
        <span className="liq-name">{liquidityLabel(p)}</span>
        <div className="liq-track">
          <div className="liq-fill liq-cash" style={{ width: `${width(p.liquidity)}%` }} />
        </div>
        <span className="liq-amt">{liquidityAmount(p.liquidity, p.unit)}</span>
      </div>
      <div className="liq-bar">
        <span className="liq-name">Debt</span>
        {p.debtState !== "none" ? (
          <>
            <div className="liq-track">
              <div className="liq-fill liq-debt" style={{ width: `${width(p.debt)}%` }} />
            </div>
            <span className="liq-amt">{liquidityAmount(p.debt, p.unit)}</span>
          </>
        ) : (
          <span className="liq-none">{NO_DEBT}</span>
        )}
      </div>
      <div className="liq-parts">{componentsLine(l)}</div>
    </div>
  );
}

export function HealthTiles({
  health,
  segments,
  redFlags,
  kf,
  liquidity,
}: {
  health: FinancialHealth;
  segments: SegmentRevenue | null;
  redFlags: RedFlagsResult;
  kf: KeyFinancials;
  liquidity?: LiquidityDebt;
}) {
  const currentRatio = health.currentRatio[0];
  const debtEquity = health.debtToEquity[0];
  const dso = health.dso[0];
  const dpo = health.dpo[0];
  const z = health.altmanZDoublePrime[0];
  const zone = health.altmanZone[0];
  const b = HEALTH_BENCHMARKS;

  // Each tile is the metric and one benchmark line. The formula is in the
  // (i); the zone and the year-ago day count are in the rules' own text
  // (the Why box, the payables finding and the terms line), not here.
  return (
    <div
      data-health-panel
      style={{ background: "var(--bg-white)", border: "1px solid var(--border-card)", borderRadius: 12, padding: "20px 22px", display: "flex", flexDirection: "column", gap: 12 }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text-tertiary)" }}>FINANCIAL HEALTH</div>
      <div className="health-tiles" style={{ marginLeft: -14 }}>
        <Tile
          label="Current ratio"
          value={currentRatio === undefined ? "MISSING" : `${currentRatio.toFixed(1)}x`}
          sub={`Benchmark: above ${b.currentRatioAbove.toFixed(1)}x`}
          tooltip={{ key: "currentRatio", label: "Current ratio" }}
        />
        {/*
          "—" when the filer has never tagged debt in the lookback; MISSING
          only when a tag exists but isn't filed for this quarter. The strip
          below says "No debt tagged" in words.
        */}
        <Tile
          label="Debt / equity"
          value={debtEquity !== undefined ? debtEquity.toFixed(2) : kf.debtTagFiledInLookback ? "MISSING" : "—"}
          sub={`Benchmark: below ${b.debtToEquityBelow.toFixed(1)}`}
          tooltip={{ key: "debtEquity", label: "Debt / equity" }}
        />
        <Tile
          label="DSO"
          value={dso === undefined ? "MISSING" : `${dso.toFixed(1)} days`}
          sub={`Benchmark: within ${b.dsoWithinDays} days`}
          tooltip={{ key: "dso", label: "DSO" }}
        />
        <Tile
          label="DPO"
          value={dpo === undefined ? "MISSING" : `${dpo.toFixed(1)} days`}
          sub={`Benchmark: within ${b.dpoWithinDays} days`}
          tooltip={{ key: "dpo", label: "DPO" }}
        />
        <Tile
          label="Altman Z''"
          value={z === undefined ? "MISSING" : z.toFixed(2)}
          sub={`Benchmark: above ${b.altmanZAbove}`}
          tooltip={{ key: "altmanZ", label: "Altman Z''" }}
          align="right"
        />
        <Tile
          label="Red flags, 12 mo"
          value={String(redFlags.findings.length)}
          tooltip={{ key: "redFlags", label: "Red flags, 12 mo" }}
          align="right"
        />
      </div>
      {zone?.capped && (
        <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{ALTMAN_CAP_NOTE}</div>
      )}
      {liquidity && <LiquidityStrip l={liquidity} />}
      <SegmentLine segments={segments} kf={kf} />
    </div>
  );
}
