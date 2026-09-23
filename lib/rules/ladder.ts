import {
  ALTMAN_ZONES,
  PAYMENT_TERMS_BASELINE_DAYS,
  PAYMENT_TERMS_CEILING_DAYS,
  RUNWAY_NEUTRAL_CAP_QUARTERS,
  RUNWAY_WEAK_BELOW_QUARTERS,
} from "@/lib/rules/declaredValues";
import { PaymentBehaviorSignal } from "@/lib/rules/signals";
import { RedFlagsResult } from "@/lib/rules/redFlags";
import { CashPosition, runwaySubject } from "@/lib/rules/runway";
import { AltmanZoneResult, ALTMAN_CAP_NOTE } from "@/lib/metrics/health";

export type LadderRung = "Strong" | "Neutral" | "Weak";

export interface LadderResult {
  rung: LadderRung;
  /** Which specific rule decided the rung -- for transparency, not just the label. */
  rule: string;
  net30: true; // baseline is always available, even at Weak (with escalation)
  net45: boolean;
  net60: false; // never approved, per the declared ceiling
  escalateBeforeSigning: boolean;
}

/**
 * The ladder separates "can they pay?" (Z'' + red flags) from "will they
 * pay on time?" (DPO Y/Y trend). The one exception the spec calls out: a
 * grey-zone balance sheet combined with rising DPO is treated as Weak
 * (classic early liquidity-stress pattern), even though neither alone
 * would be.
 *
 * Runway is the third "can they pay?" input, and it is applied last, over
 * the top of whatever the balance-sheet rules decided: a company can score
 * safe on Z'' and still be spending its cash faster than it can replace
 * it, which is a question about the next two years rather than about this
 * quarter's balance sheet. It can only ever move the rung down.
 */
export function computeLadder(
  zone: AltmanZoneResult,
  redFlags: RedFlagsResult,
  paymentBehavior: PaymentBehaviorSignal,
  cashPosition: CashPosition
): LadderResult {
  return applyRunway(balanceSheetLadder(zone, redFlags, paymentBehavior), cashPosition);
}

/**
 * The runway cap: runway under 8 quarters caps the rung at Neutral, under
 * 4 sets it to Weak.
 *
 * Only the BURN case reaches this. A company whose operations throw off
 * cash and whose capital spending exceeds it is not running out of
 * anything, and capping its terms on a "runway" computed from a number it
 * chose to spend would penalise investment. Heavy investment gets a watch
 * item and no more.
 *
 * Only ever downward: a long runway never promotes a company the balance
 * sheet or the filing list put on a lower rung.
 */
function applyRunway(base: LadderResult, cashPosition: CashPosition): LadderResult {
  if (cashPosition.case !== "burn") return base;
  const quarters = cashPosition.quarters;
  if (quarters === undefined) return base;

  if (quarters < RUNWAY_WEAK_BELOW_QUARTERS) {
    if (base.rung === "Weak") return base;
    return weak(
      `${runwaySubject(cashPosition)} about ${quarters} quarter${quarters === 1 ? "" : "s"} of the current burn, under the ${RUNWAY_WEAK_BELOW_QUARTERS}-quarter runway floor.`
    );
  }
  if (quarters < RUNWAY_NEUTRAL_CAP_QUARTERS && base.rung === "Strong") {
    return neutral(
      `${base.rule} Capped at Neutral: ${runwaySubject(cashPosition).toLowerCase()} about ${quarters} quarters of the current burn, under the ${RUNWAY_NEUTRAL_CAP_QUARTERS}-quarter runway threshold.`
    );
  }
  return base;
}

function balanceSheetLadder(
  zoneResult: AltmanZoneResult,
  redFlags: RedFlagsResult,
  paymentBehavior: PaymentBehaviorSignal
): LadderResult {
  const zPrime = zoneResult.z;
  // The zone, not the raw score: a distress score on a profitable,
  // cash-generating company is read as grey, and every grey rule below
  // then applies to it unchanged.
  const zSafe = zoneResult.zone === "safe";
  const zGrey = zoneResult.zone === "grey";
  const zDistress = zoneResult.zone === "distress";
  const zMissing = zoneResult.zone === undefined;
  // Appended to whichever rule fires, so the brief and the page both say
  // why a distress score produced a grey-zone outcome.
  const capNote = zoneResult.capped ? ` ${ALTMAN_CAP_NOTE}` : "";
  const dpoRising = paymentBehavior.state === "rising";
  const hasRedFlags = redFlags.findings.length > 0;

  if (zDistress) {
    return weak(`Altman Z'' ${zPrime!.toFixed(2)} is in the distress zone (< ${ALTMAN_ZONES.distressBelow}).`);
  }
  if (hasRedFlags) {
    const kinds = [...new Set(redFlags.findings.map((f) => f.type))].join(", ");
    return weak(`Red-flag filing(s) in the last 12 months: ${kinds}.${capNote}`);
  }
  if (zGrey && dpoRising) {
    return weak(
      `Altman Z'' ${zPrime!.toFixed(2)} is grey-zone and DPO is up ${Math.round(paymentBehavior.yoyPctChange!)}% Y/Y (beyond the band) -- the grey-zone-plus-rising-DPO exception.${capNote}`
    );
  }

  if (zSafe && !dpoRising) {
    const dpoNote =
      paymentBehavior.state === "missing"
        ? "DPO unavailable, treated as not rising"
        : `DPO ${paymentBehavior.state} Y/Y (${Math.round(paymentBehavior.yoyPctChange!)}%, within/below the band)`;
    return strong(`Altman Z'' ${zPrime!.toFixed(2)} is safe (> ${ALTMAN_ZONES.safeAbove}), no red flags, and ${dpoNote}.`);
  }

  if (zSafe && dpoRising) {
    return neutral(
      `Altman Z'' ${zPrime!.toFixed(2)} is safe, but DPO is up ${Math.round(paymentBehavior.yoyPctChange!)}% Y/Y (beyond the band) -- safe balance sheet, slower payer.`
    );
  }
  if (zGrey) {
    return neutral(
      `Altman Z'' ${zPrime!.toFixed(2)} is grey-zone (not safe), and DPO is not rising beyond the band.${capNote}`
    );
  }
  if (zMissing) {
    return neutral(`Altman Z'' is unavailable for this quarter -- can't confirm "safe", so not Strong.`);
  }
  return neutral("Does not meet the Strong or Weak conditions.");
}

function strong(rule: string): LadderResult {
  return { rung: "Strong", rule, net30: true, net45: true, net60: false, escalateBeforeSigning: false };
}
function neutral(rule: string): LadderResult {
  return { rung: "Neutral", rule, net30: true, net45: false, net60: false, escalateBeforeSigning: false };
}
function weak(rule: string): LadderResult {
  return { rung: "Weak", rule, net30: true, net45: false, net60: false, escalateBeforeSigning: true };
}

export function ladderCeilingDays(rung: LadderRung): number {
  return rung === "Strong" ? PAYMENT_TERMS_CEILING_DAYS : PAYMENT_TERMS_BASELINE_DAYS;
}

/**
 * "Payables ≈ [X] days of cost of revenue, [up/down] [Y]% Y/Y. Expect
 * pressure for longer terms; our ceiling is Net [45 if Strong, 30
 * otherwise]." -- verbatim per the spec.
 */
export function negotiationNote(paymentBehavior: PaymentBehaviorSignal, rung: LadderRung): string {
  const ceiling = ladderCeilingDays(rung);
  if (paymentBehavior.dpoCurrent === undefined || paymentBehavior.yoyPctChange === undefined) {
    return `Payables day count unavailable. Expect pressure for longer terms; our ceiling is Net ${ceiling}.`;
  }
  // Days to one decimal and the change as a whole percentage, the same as
  // every other place the payables fact is printed.
  const x = paymentBehavior.dpoCurrent.toFixed(1);
  const y = Math.abs(Math.round(paymentBehavior.yoyPctChange));
  const direction = paymentBehavior.yoyPctChange >= 0 ? "up" : "down";
  return `Payables ≈ ${x} days of cost of revenue, ${direction} ${y}% Y/Y. Expect pressure for longer terms; our ceiling is Net ${ceiling}.`;
}
