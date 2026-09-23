import { WhyThisVerdict as Why } from "@/lib/present/verdictReasons";

/**
 * "Why this verdict": one line per axis of the matrix, each with the input
 * that decided it and that input's figure. The thresholds behind them are
 * in the footnote, not here.
 */
export function WhyThisVerdict({ why }: { why: Why }) {
  return (
    <div className="why-box">
      <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text-tertiary)", marginBottom: 8 }}>
        WHY THIS VERDICT
      </div>
      {[why.risk, why.opportunity].map((line) => (
        <p key={line.label}>
          <b style={{ fontWeight: 600 }}>{line.label}</b> {line.text}
        </p>
      ))}
    </div>
  );
}
