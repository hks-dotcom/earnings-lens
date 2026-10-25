"use client";

import { useState } from "react";
import { StandOutTone } from "@/lib/present/standOut";
import { StandOutRow } from "@/lib/present/standOutRows";

/**
 * "What stands out" (mock V24): one row per filing-backed finding, the
 * tag in the left column in its tone, the headline and the figures line
 * on the right. Findings inform and never score (rules 10).
 *
 * The verdict's own terms are not a finding any more: they are in the
 * verdict card. The filing-status item of rules 14 D2 (overdue, filed
 * within an extension, extension open, filed late) is one more row, and
 * replaces the old missed-deadline red flag.
 */
const TONE_COLOR: Record<StandOutTone, string> = {
  watch: "#8a5300",
  good: "var(--core-strong)",
  terms: "var(--nova-strong)",
  info: "var(--info-strong)",
};

type Filter = "all" | "is" | "bs" | "cf";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "is", label: "P&L" },
  { key: "bs", label: "Balance sheet" },
  { key: "cf", label: "Cash flow" },
];

export function StandOutList({ rows }: { rows: StandOutRow[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const count = (f: Filter) => (f === "all" ? rows.length : rows.filter((r) => r.statements.includes(f)).length);
  const visible = rows.filter((r) => filter === "all" || r.always || r.statements.includes(filter));
  return (
    <section className="v5-section" style={{ gap: 12 }}>
      <div className="v5-k">WHAT STANDS OUT</div>
      <div className="so-filters" role="group" aria-label="Filter findings by statement">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label} {count(f.key)}
          </button>
        ))}
        <span className="so-note">A finding can appear under more than one statement</span>
      </div>
      {visible.length === 0 && <div className="so-none">No findings</div>}
      {visible.map((r) => (
        <div key={r.key} className="so-row">
          <span className="so-tag" style={{ color: TONE_COLOR[r.tone] }}>
            {r.tag}
          </span>
          <div className="so-text">
            <strong>{r.headline}</strong>
            {r.detail && <div className="so-detail font-mono">{r.detail}</div>}
          </div>
        </div>
      ))}
    </section>
  );
}
