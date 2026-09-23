import { Summary } from "@/lib/present/summary";

/**
 * The Summary, beside the matrix at the top of the board: commentary for
 * the reader who reads one paragraph, and everything below it -- "What
 * stands out" and the explanations that close its findings -- is the same
 * story taken apart for a reader who wants to check it.
 *
 * It starts at its second part. The verdict is part one, and the hero
 * directly above already says it in larger type; the Copy brief, which has
 * no hero, keeps it.
 *
 * It is templated from the rules' output and carries no build or
 * implementation notes: a reader is told what the rules decided and why,
 * never how the page was made or which layer wrote which sentence.
 */
export function SummaryCard({ summary }: { summary: Summary }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text-tertiary)" }}>
        {summary.heading.toUpperCase()}
      </div>
      <p style={{ margin: 0, fontSize: 17, lineHeight: 1.6 }}>{summary.parts.join(" ")}</p>
    </div>
  );
}
