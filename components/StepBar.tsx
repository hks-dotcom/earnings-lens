/**
 * A stepped bar with the current step marked by a dot (mock V24): the
 * verdict bar, the health state bar, each health card's own bar and the
 * likely-route bar. The current step is in its full colour and bold; the
 * others are a faint tint of their own colour. With no current step, no
 * step is selected.
 */

/** Severity tones: [full, faint], as in mock V24. */
export const TONE: Record<string, [string, string]> = {
  Resilient: ["#1f6f5c", "#d3e4dd"],
  Clear: ["#1f6f5c", "#d3e4dd"],
  Pursue: ["#1f6f5c", "#d3e4dd"],
  Watch: ["#a86a00", "#efe0c2"],
  Warning: ["#a86a00", "#efe0c2"],
  "Pursue with guardrails": ["#a86a00", "#efe0c2"],
  Fragile: ["#b8461b", "#f0d5c8"],
  Monitor: ["#b8461b", "#f0d5c8"],
  Critical: ["#9b1c1c", "#ecd0d0"],
  Severe: ["#9b1c1c", "#ecd0d0"],
  "Limit exposure": ["#9b1c1c", "#ecd0d0"],
};

const ROUTE_TONE: [string, string] = ["#3b4ba8", "#d9dcef"];

export function StepBar({
  steps,
  current,
  height,
  fontSize,
  gap = 3,
  route = false,
  maxWidth,
  ariaLabel,
}: {
  steps: string[];
  current: string | null;
  height: number;
  fontSize: number;
  gap?: number;
  /** The likely-route bar: one blue for every step. */
  route?: boolean;
  maxWidth?: number | string;
  ariaLabel?: string;
}) {
  const n = steps.length;
  const r = Math.min(5, height / 2 + 1);
  return (
    <div role={ariaLabel ? "img" : undefined} aria-label={ariaLabel} style={{ display: "flex", gap, width: "100%", maxWidth }}>
      {steps.map((s, i) => {
        const on = s === current;
        const [full, faint] = route ? ROUTE_TONE : (TONE[s] ?? ["#55524c", "#ece9e2"]);
        const radius = n === 1 ? `${r}px` : i === 0 ? `${r}px 0 0 ${r}px` : i === n - 1 ? `0 ${r}px ${r}px 0` : "0";
        return (
          <div key={s} style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", gap: height >= 12 ? 6 : height >= 8 ? 4 : 3 }}>
            <div style={{ height, borderRadius: radius, background: on ? full : faint }} />
            <span
              className="step-label"
              style={{ fontSize, fontWeight: on ? 700 : 400, color: on ? full : "#8a867d" }}
            >
              {on ? "● " : ""}
              {s}
            </span>
          </div>
        );
      })}
    </div>
  );
}
