import { LadderRung, ladderCeilingDays } from "@/lib/rules/ladder";

export type Lens = "Services" | "SaaS";

export interface DealStructureResult {
  /** Services lens only; undefined for the SaaS lens (product focus is a GTM call, not a structure recommendation). */
  contractStructure: string | undefined;
  /**
   * The exposure under the terms the ladder actually recommends, as one
   * plain sentence a reader can act on without doing the arithmetic.
   */
  creditExposure: string;
  billingAssumption: string;
}

/** Monthly billing in arrears: one billing cycle of work is always unbilled. */
const BILLING_CYCLE_DAYS = 30;

/**
 * How many months of our own work can be unpaid at once, under terms of
 * `days`.
 *
 * One cycle of delivered-but-not-yet-invoiced work, plus however long they
 * then have to pay: 1 + days/30. At Net 30 that is 2 months, at Net 45 it
 * is 2½ -- the two figures the spec declares. They are computed here rather
 * than written down so that changing the declared ceiling changes the
 * sentence on the card, instead of leaving a stale number behind.
 */
function unpaidMonthsLabel(days: number): string {
  const months = 1 + days / BILLING_CYCLE_DAYS;
  const whole = Math.floor(months);
  const frac = months - whole;
  if (frac < 0.125) return `${whole}`;
  if (frac < 0.375) return `${whole}¼`;
  if (frac < 0.625) return `${whole}½`;
  if (frac < 0.875) return `${whole}¾`;
  return `${whole + 1}`;
}

/**
 * The deal structure, keyed off the ladder's own ceiling (Net 45 only when
 * Strong) rather than a separate terms decision -- the exposure has to
 * describe whatever terms the ladder actually recommends, or the card
 * contradicts itself.
 *
 * Both exposure sentences are plain English and say the same thing twice
 * over: the amount at risk, and the mechanism that produces it. A reader
 * who has never seen the page should be able to tell from one line why a
 * services engagement carries two months of exposure and a SaaS
 * subscription carries the invoice window. No percentages, no jargon, and
 * no headline figure repeated by the sentence after it, and nothing in the
 * STANDARD column to state it a third time.
 */
export function computeDealStructure(lens: Lens, rung: LadderRung): DealStructureResult {
  const ceiling = ladderCeilingDays(rung);

  if (lens === "Services") {
    return {
      contractStructure: rung === "Strong" ? "Milestone acceptable" : "T&M monthly",
      creditExposure: `Up to about ${unpaidMonthsLabel(ceiling)} months of our work unpaid at any time: we invoice each month's work at month end, and they have ${ceiling} days to pay.`,
      billingAssumption: "monthly billing in arrears",
    };
  }

  return {
    contractStructure: undefined,
    creditExposure: `Up to ${ceiling} days of the annual fee, until the invoice is paid; nothing owed after that.`,
    billingAssumption: "annual billing in advance",
  };
}
