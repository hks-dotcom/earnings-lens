/**
 * Verdict matrix (rules section 6): health state × seller condition.
 * A MIXED CoreThread condition reaches the matrix as caution.
 */
import type { HealthState, Seller, Verdict } from "@/lib/verdict/types";

export function verdictFor(state: HealthState, sellerCaution: boolean, seller: Seller): Verdict {
  switch (state) {
    case "Critical":
      return "Limit exposure";
    case "Fragile":
      return seller === "CoreThread" ? "Limit exposure" : "Monitor";
    case "Watch":
      return sellerCaution && seller === "CoreThread" ? "Monitor" : "Pursue with guardrails";
    case "Resilient":
      return sellerCaution ? "Pursue with guardrails" : "Pursue";
  }
}
