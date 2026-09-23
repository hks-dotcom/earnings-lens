import { LensResult } from "@/lib/rules/evaluateLens";
import { PAYMENT_TERMS_BASELINE_DAYS, PAYMENT_TERMS_CEILING_DAYS } from "@/lib/rules/declaredValues";

/**
 * The terms sentence: the Summary's last part, and the headline of the
 * "What stands out" terms item ("the terms sentence from the Summary").
 *
 * It lives in its own module because both of those read it and neither
 * owns it -- two copies of a sentence that has to be identical in two
 * places is one copy too many.
 *
 * It always opens at the Net 30 baseline, never at the ceiling. Net 45 is
 * the most a Strong counterparty can be given, not the position to start
 * from, and a summary that says "Offer Net 45" has conceded the ceiling
 * before anyone has asked for it.
 */
export function termsSentence(lens: LensResult): string {
  const escalate = lens.ladder.escalateBeforeSigning ? " Escalate before signing." : "";
  const offer =
    lens.ladder.rung === "Strong"
      ? `Offer Net ${PAYMENT_TERMS_BASELINE_DAYS}; go to Net ${PAYMENT_TERMS_CEILING_DAYS} only if pushed.`
      : `Offer Net ${PAYMENT_TERMS_BASELINE_DAYS} and hold it; expect pressure for longer terms.`;
  return `${offer}${escalate}`;
}
