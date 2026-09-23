import { LadderRung } from "@/lib/rules/ladder";
import { Quadrant } from "@/lib/rules/matrix";
import { riskWord } from "@/lib/present/riskWords";

const COLORS: Record<"Services" | "SaaS", string> = {
  Services: "#1F6F5C",
  SaaS: "#3B4BA8",
};

/**
 * 2x2 matrix, same shape for both lenses. The risk axis (x, right = higher
 * risk) has three dot positions -- Strong sits in the low-risk (left)
 * column; Neutral and Weak each get a distinct x within the high-risk
 * (right) column -- so companies on different rungs never overlap, per
 * spec. A Strong rung with retrenchment (risk high despite Strong) is the
 * one case that can't cleanly map to a single column position; it's shown
 * at the Neutral position within the high-risk column.
 */
export function VerdictMatrix({
  ticker,
  lens,
  opportunityHigh,
  riskHigh,
  rung,
  quadrant,
}: {
  ticker: string;
  lens: "Services" | "SaaS";
  opportunityHigh: boolean;
  riskHigh: boolean;
  rung: LadderRung;
  quadrant: Quadrant;
}) {
  const color = COLORS[lens];
  const W = 330;
  const H = 320;
  const boxSize = 138;
  const gap = 6;
  const top = 8;
  const leftX = 44;
  const rightX = leftX + boxSize + gap;

  // Dot x within its column: Strong -> left column center; Neutral/Weak -> two sub-positions within the right column.
  let dotX: number;
  if (!riskHigh) {
    dotX = leftX + boxSize / 2;
  } else {
    dotX = rung === "Weak" ? rightX + boxSize * 0.72 : rightX + boxSize * 0.28;
  }
  const dotY = opportunityHigh ? top + boxSize * 0.45 : top + boxSize + gap + boxSize * 0.45;

  const quadrantFill = (q: Quadrant) => (quadrant === q ? color : "#F1EFEA");
  const quadrantOpacity = (q: Quadrant) => (quadrant === q ? 0.14 : 1);
  const quadrantTextFill = (q: Quadrant) => (quadrant === q ? color : "#6B675F");
  const quadrantTextWeight = (q: Quadrant) => (quadrant === q ? 600 : 400);

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      // Scales down with its container and never up past its drawn size.
      // The width and height attributes stay: browsers read them as the
      // aspect ratio, which is what keeps "height: auto" from collapsing.
      style={{ display: "block", width: "100%", maxWidth: W, height: "auto" }}
      fontFamily="IBM Plex Sans, sans-serif"
      role="img"
      aria-label={`Relationship opportunity by counterparty risk; ${ticker} in ${quadrant}`}
    >
      <rect x={leftX} y={top} width={boxSize} height={boxSize} rx={8} fill={quadrantFill("Pursue")} fillOpacity={quadrantOpacity("Pursue")} />
      <text x={leftX + boxSize / 2} y={top + 22} textAnchor="middle" fontSize={12} fontWeight={quadrantTextWeight("Pursue")} fill={quadrantTextFill("Pursue")}>
        Pursue
      </text>

      <rect x={rightX} y={top} width={boxSize} height={boxSize} rx={8} fill={quadrantFill("Pursue with guardrails")} fillOpacity={quadrantOpacity("Pursue with guardrails")} />
      <text x={rightX + boxSize / 2} y={top + 22} textAnchor="middle" fontSize={12} fontWeight={quadrantTextWeight("Pursue with guardrails")} fill={quadrantTextFill("Pursue with guardrails")}>
        Pursue with guardrails
      </text>

      <rect x={leftX} y={top + boxSize + gap} width={boxSize} height={boxSize} rx={8} fill={quadrantFill("Monitor")} fillOpacity={quadrantOpacity("Monitor")} />
      <text x={leftX + boxSize / 2} y={top + boxSize + gap + 22} textAnchor="middle" fontSize={12} fontWeight={quadrantTextWeight("Monitor")} fill={quadrantTextFill("Monitor")}>
        Monitor
      </text>

      <rect x={rightX} y={top + boxSize + gap} width={boxSize} height={boxSize} rx={8} fill={quadrantFill("Limit exposure")} fillOpacity={quadrantOpacity("Limit exposure")} />
      <text x={rightX + boxSize / 2} y={top + boxSize + gap + 22} textAnchor="middle" fontSize={12} fontWeight={quadrantTextWeight("Limit exposure")} fill={quadrantTextFill("Limit exposure")}>
        Limit exposure
      </text>

      <circle cx={dotX} cy={dotY} r={11} fill={color} />
      <text x={dotX + 16} y={dotY + 4} fontSize={12} fontWeight={600} fill="#1C1B19">
        {ticker}
      </text>

      <text x={rightX - gap / 2} y={H - 8} textAnchor="middle" fontSize={12} fill="#55524C">
        Counterparty risk: {riskWord(rung)} &#8594;
      </text>
      <text x={16} y={top + boxSize + gap} textAnchor="middle" fontSize={12} fill="#55524C" transform={`rotate(-90 16 ${top + boxSize + gap})`}>
        Relationship opportunity &#8594;
      </text>
    </svg>
  );
}
