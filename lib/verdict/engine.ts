/**
 * The S5 verdict engine (Earnings_Lens_Verdict_Rules_S5.md), end to end
 * for one company: Layer 1 health, each seller's condition, the matrix,
 * terms and protections, evidence, potential application, filing status
 * and the explanation data. Pure: no I/O, no clock, no page code.
 */
import { layer1 } from "@/lib/verdict/layer1";
import { coreThreadCondition, nexCoreCondition } from "@/lib/verdict/sellers";
import { verdictFor } from "@/lib/verdict/matrix";
import { paymentTerms, protections, sellerCondition } from "@/lib/verdict/terms";
import { evidence } from "@/lib/verdict/evidence";
import { potentialApplication } from "@/lib/verdict/potentialApplication";
import { filingStatus } from "@/lib/verdict/filingStatus";
import { explainAreas, explainOtherRatios } from "@/lib/verdict/explain";
import type { VerdictInputs, VerdictResult } from "@/lib/verdict/types";

export function runVerdict(x: VerdictInputs): VerdictResult {
  const fs = filingStatus(x.filing);
  const l1 = layer1(x, fs.missedFiling);
  const ct = coreThreadCondition(x, l1);
  const nc = nexCoreCondition(x, l1);
  const ctVerdict = verdictFor(l1.state, ct.sellerCaution, "CoreThread");
  const ncVerdict = verdictFor(l1.state, nc.sellerCaution, "NexCore");
  return {
    ticker: x.ticker,
    assessmentDate: x.assessmentDate,
    inputs: x,
    layer1: l1,
    coreThread: {
      seller: "CoreThread",
      condition: ct,
      verdict: ctVerdict,
      terms: paymentTerms(ctVerdict),
      protections: protections("CoreThread", ctVerdict),
      contractCondition: sellerCondition("CoreThread", l1.state),
      evidence: evidence("CoreThread", x, l1, ct.notMeasurableTests, ct.rdUnknown),
    },
    nexCore: {
      seller: "NexCore",
      condition: nc,
      verdict: ncVerdict,
      terms: paymentTerms(ncVerdict),
      protections: protections("NexCore", ncVerdict),
      contractCondition: sellerCondition("NexCore", l1.state),
      evidence: evidence("NexCore", x, l1, nc.notMeasurableTests, false),
    },
    potentialApplication: potentialApplication(x.sic),
    filingStatus: fs,
    explanations: { areas: explainAreas(x, l1, fs), otherRatios: explainOtherRatios(x) },
  };
}
