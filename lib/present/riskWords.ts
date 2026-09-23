import { LadderRung } from "@/lib/rules/ladder";

/**
 * The risk rung as a reader sees it: low, medium or high.
 *
 * Display wording only. The rules keep their own names for the rungs --
 * Strong, Neutral, Weak -- in the ladder, the matrix, the rules snapshots
 * and every internal rule string; nothing here changes a rung or a rule.
 * "Strong" described the counterparty and "risk: Strong" read backwards;
 * low / medium / high says what the axis measures.
 */
export const RISK_WORD: Record<LadderRung, "low" | "medium" | "high"> = {
  Strong: "low",
  Neutral: "medium",
  Weak: "high",
};

export function riskWord(rung: LadderRung): "low" | "medium" | "high" {
  return RISK_WORD[rung];
}
