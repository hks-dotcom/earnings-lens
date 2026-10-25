/**
 * Layer 2, seller condition (rules section 5): does anything in the
 * filings change the seller's exposure?
 */
import { RULES } from "@/lib/verdict/rulesConfig";
import { and3, ge, le, or3, T3 } from "@/lib/verdict/logic";
import { inLookback } from "@/lib/verdict/layer1";
import type { CoreThreadCondition, CoreThreadDirection, CoreThreadLeg, Layer1Result, NexCoreCondition, VerdictInputs } from "@/lib/verdict/types";

/** Restructuring filings (8-K 2.05) in the 12 months before the assessment date, newest first. */
export function restructuringInWindow(x: VerdictInputs): string[] {
  return x.restructuringFilings
    .filter((f) => inLookback(f.filingDate, x.assessmentDate))
    .map((f) => f.filingDate)
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

const pct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`;

/** 5.1 CoreThread (Services). */
export function coreThreadCondition(x: VerdictInputs, l1: Layer1Result): CoreThreadCondition {
  const C = RULES.coreThread;
  const [r0, r1] = x.rdYoYPct;
  const quarterly = x.rdStatus === "quarterly";
  // R&D direction is read only from quarterly R&D; otherwise both R&D tests are not measurable.
  const expanding: T3 = quarterly ? and3(ge(r0, C.rdExpandingPct), ge(r1, C.rdExpandingPct)) : null;
  const rdCaution: T3 = quarterly ? and3(le(r0, C.rdCautionPct), le(r1, C.rdCautionPct)) : null;
  const restructuring = restructuringInWindow(x);
  const hasRestructuring = restructuring.length > 0;
  const opDet = l1.flags["OPERATING DETERIORATION"];
  const caution = or3(rdCaution, hasRestructuring, opDet);

  const legs: CoreThreadLeg[] = [];
  if (rdCaution === true) legs.push({ kind: "rd-caution", rdYoYPct: [r0 as number, r1 as number] });
  if (hasRestructuring) legs.push({ kind: "restructuring", filingDates: restructuring });
  if (opDet === true) legs.push({ kind: "operating-deterioration" });

  // R&D direction is measurable when it is quarterly and the two R&D tests resolve to a reading.
  const rdMeasurable = quarterly && (expanding === true || rdCaution === true || (expanding === false && rdCaution === false));
  const rdUnknown = !rdMeasurable;
  const rdUnknownReason = rdUnknown ? (quarterly ? "not measurable" : x.rdStatus) : null;

  let direction: CoreThreadDirection;
  if (caution === true) direction = "CAUTION";
  else if (rdUnknown) direction = "UNKNOWN";
  else if (expanding === true) direction = "EXPANDING";
  else direction = "FLAT";

  const mixed = caution === true && expanding === true;
  const mixedReasons: string[] = [];
  if (mixed) {
    mixedReasons.push(`Expanding R&D ${pct(r0 as number)} / ${pct(r1 as number)}`);
    if (hasRestructuring) mixedReasons.push(`8-K 2.05 ${restructuring.join(", ")}`);
    if (opDet === true) mixedReasons.push("OPERATING DETERIORATION");
  }

  const notMeasurableTests: string[] = [];
  if (expanding === null) notMeasurableTests.push("EXPANDING");
  if (rdCaution === null) notMeasurableTests.push("R&D CAUTION");
  if (caution === null) notMeasurableTests.push("CAUTION");

  const engineeringSpend: CoreThreadCondition["engineeringSpend"] = rdUnknown
    ? "Not separately disclosed"
    : rdCaution === true
      ? "Caution"
      : expanding === true
        ? "Expanding"
        : "Flat";

  return {
    direction,
    mixed,
    mixedReasons,
    legs,
    rdUnknownReason,
    rdUnknown,
    expanding,
    rdCaution,
    caution,
    sellerCaution: caution === true,
    engineeringSpend,
    notMeasurableTests,
  };
}

/** 5.2 NexCore (SaaS). */
export function nexCoreCondition(x: VerdictInputs, l1: Layer1Result): NexCoreCondition {
  const hasRestructuring = restructuringInWindow(x).length > 0;
  const caution = and3(l1.flags["OPERATING DETERIORATION"], or3(hasRestructuring, l1.anyCashFlag));
  return {
    caution,
    sellerCaution: caution === true,
    label: caution === true ? "cutting back across the business" : null,
    notMeasurableTests: caution === null ? ["CAUTION"] : [],
  };
}
