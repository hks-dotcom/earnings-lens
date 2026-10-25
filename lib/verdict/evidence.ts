/**
 * Evidence confidence (rules section 8): a separate statement shown under
 * the verdict, never another risk score. First match wins: Exception,
 * Limited, Adequate.
 */
import { criticalInWindow } from "@/lib/verdict/layer1";
import type { EvidenceResult, Layer1Result, Seller, VerdictInputs } from "@/lib/verdict/types";

export function evidence(
  seller: Seller,
  x: VerdictInputs,
  l1: Layer1Result,
  sellerNotMeasurable: string[],
  rdUnknown: boolean
): EvidenceResult {
  const staleQualification: EvidenceResult["staleQualification"] = x.stale.stale
    ? {
        assessedOn: x.stale.assessedPeriodLabel ? `Assessed on ${x.stale.assessedPeriodLabel} filing` : null,
        newerFiling: x.stale.newerFiling,
        reviewQualification: true,
        fullyCurrent: false,
      }
    : null;

  const exception: string[] = [];
  if (criticalInWindow(x).some((c) => c.item === "4.02")) exception.push("Critical filing 8-K 4.02");
  if (l1.flags["MISSED FILING"] === true) exception.push("missed filing");
  if (x.stale.stale) exception.push("stale period");
  if (exception.length) return { level: "Exception", reasons: exception, staleQualification };

  const limited: string[] = [];
  for (const f of l1.notMeasurable) limited.push(`not measurable: ${f}`);
  for (const t of sellerNotMeasurable) limited.push(`not measurable: ${seller} ${t}`);
  if (seller === "CoreThread" && rdUnknown) limited.push("R&D unknown");
  if (x.dataQuality.financeArmDebtNotSeparable) limited.push("finance-arm debt not separable");
  if (x.dataQuality.restrictedCashNotSeparated) limited.push("restricted cash not separated");
  if (limited.length) return { level: "Limited", reasons: limited, staleQualification };

  return { level: "Adequate", reasons: [], staleQualification };
}
