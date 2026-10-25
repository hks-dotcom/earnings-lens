import { PageData } from "@/lib/present/buildPageData";
import { MINUS } from "@/lib/present/format";
import { segmentSplit } from "@/lib/present/segmentSplit";

/** "nvda:ComputeAndNetworkingSegmentMember" -> "Compute & Networking". Cosmetic only. */
function prettifyMember(member: string): string {
  const withoutNamespace = member.replace(/^[a-zA-Z]+:/, "");
  const withoutSuffixes = withoutNamespace.replace(/(Segment)?Member$/, "");
  const spaced = withoutSuffixes.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.replace(/\bAnd\b/g, "&");
}

const COLORS = ["#3f4a5c", "#7d8899", "#b3bcc8", "#5b6770", "#9aa4b2", "#c9d0d9", "#2f3846", "#8792a3"];

/** "$116,177M", as the segment key writes it. */
const millions = (v: number) => `${v < 0 ? MINUS : ""}$${Math.round(Math.abs(v) / 1e6).toLocaleString("en-US")}M`;

/**
 * Operating segments (mock V24, rules 10, 17.6): one bar split by revenue
 * share, the key below it, and the total the shares are taken of. Never
 * used in the verdict. Hidden unless the filed amounts reconcile to total
 * revenue (lib/present/segmentSplit.ts).
 */
export function SegmentsSection({ page }: { page: PageData }) {
  const seg = page.segments;
  const kf = page.keyFinancials;
  const split = segmentSplit(seg, kf.revenue.values[0]?.value, page.annual?.rows.revenue[0]?.value ?? undefined);
  if (!seg || !split) return null;
  const total = split.total;
  const annualOnly = seg.periodKind === "annual-only";
  const rows = seg.values.map((v, i) => ({ k: prettifyMember(v.member), v: v.value, c: COLORS[i % COLORS.length] }));
  const barRows = rows.filter((r) => r.v > 0);
  const share = (v: number) => `${((v / total) * 100).toFixed(1)}%`;
  const q = kf.quarters[0];
  const period = annualOnly ? "full fiscal year, no quarterly breakout filed" : seg.periodKind === "derived-quarterly" ? `${q?.label} · derived as the fiscal-year total minus Q1 to Q3` : q?.label;
  const axis = seg.axis === "us-gaap:StatementBusinessSegmentsAxis" ? "OPERATING SEGMENTS" : "SEGMENTS (PRODUCT / MARKET)";

  return (
    <section className="v5-section">
      <div className="seg-head">
        <span className="v5-k">{axis}</span>
        <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Revenue · {period} · as filed</span>
      </div>
      <div className="seg-bar" role="img" aria-label={`Revenue split: ${rows.map((r) => `${r.k} ${share(r.v)}`).join(", ")}`}>
        {barRows.map((r, i) => (
          <div
            key={r.k}
            style={{
              width: share(r.v),
              background: r.c,
              borderRadius: barRows.length === 1 ? 4 : i === 0 ? "4px 0 0 4px" : i === barRows.length - 1 ? "0 4px 4px 0" : 0,
            }}
          />
        ))}
      </div>
      <div className="seg-key">
        {rows.map((r) => (
          <div key={r.k} className="seg-item">
            <span aria-hidden="true" style={{ background: r.c }} />
            <span>{r.k}</span>
            <span className="font-mono">{millions(r.v)}</span>
            <strong className="font-mono">{share(r.v)}</strong>
          </div>
        ))}
        <span style={{ color: "var(--text-tertiary)" }}>
          Total revenue {millions(total)}
        </span>
      </div>
    </section>
  );
}
