/**
 * Payment terms and contract protections (rules section 7). Wording is
 * the rules document's, cell for cell.
 */
import type { HealthState, PaymentTerms, ProtectionLine, Seller, Verdict } from "@/lib/verdict/types";

/** 7.1: Net 45 only on request and only for Pursue; Net 60 never. */
export function paymentTerms(verdict: Verdict): PaymentTerms {
  const net45 = verdict === "Pursue" ? "on request" : "not offered";
  return {
    net30: "available",
    net45,
    net60: "not recommended",
    display: net45 === "on request" ? "Net 30 ✓ · Net 45 on request · Net 60 ✕" : "Net 30 ✓ · Net 45 ✕ · Net 60 ✕",
  };
}

type Row = Record<string, string>;

/** 7.2 CoreThread: Milestone, T&M, Support. */
const CORETHREAD: Record<Verdict, Row> = {
  Pursue: {
    Milestone: "Bill at each accepted milestone · written acceptance criteria and review period",
    "T&M": "Billed monthly in arrears · timesheets approved monthly",
    Support: "Billed in advance · defined scope and service period",
  },
  "Pursue with guardrails": {
    Milestone: "Smaller milestones with more frequent acceptance gates · explicit approval deadlines · tighter change orders · cap on unbilled work",
    "T&M": "Cap on work delivered while invoices are outstanding · no long unfunded staffing commitments",
    Support: "Billed in advance · defined scope and service period",
  },
  Monitor: {
    Milestone: "Short funded discovery phase or small prepaid milestone only · evidence of project authorization before expansion",
    "T&M": "No large dedicated team · no substantial unrecoverable effort",
    Support: "Billed in advance · defined scope and service period",
  },
  "Limit exposure": {
    Milestone: "No new material unsecured work · funds or effective security before material delivery · exceptions escalated to finance",
    "T&M": "Same",
    Support: "Same",
  },
};

/** 7.2 NexCore: Subscription, Usage, Onboarding. */
const NEXCORE: Record<Verdict, Row> = {
  Pursue: {
    Subscription: "Monthly, quarterly or annual in advance · service starts on the agreed date",
    Usage: "Metered and billed monthly · usage alerts enabled",
    Onboarding: "Fee invoiced at signing",
  },
  "Pursue with guardrails": {
    Subscription: "Shorter prepaid service periods · cash received before material service activation",
    Usage: "Usage alerts or prepaid usage credits",
    Onboarding: "Paid onboarding",
  },
  Monitor: {
    Subscription:
      "Small funded pilot or tightly scoped commitment · collected before activation · no assumed expansion or usage ramp · budget owner and deployment commitment confirmed",
    Usage: "Prepaid usage only",
    Onboarding: "Paid before work starts",
  },
  "Limit exposure": {
    Subscription: "No material service before collection or acceptable security · exceptions need explicit approval",
    Usage: "Uncovered usage restricted",
    Onboarding: "Uncovered onboarding cost restricted",
  },
};

export const CONTRACT_COMPONENTS: Record<Seller, string[]> = {
  CoreThread: ["Milestone", "T&M", "Support"],
  NexCore: ["Subscription", "Usage", "Onboarding"],
};

/** 7.2 notes, as written. */
export const PROTECTION_NOTES = [
  "An advance invoice on Net 30 is not prepaid cash; an unpaid advance invoice is not security.",
  "Billing frequency and commitment length are separate decisions (a 12-month commitment can be invoiced quarterly).",
];

/** 7.3, stated on every NexCore Fragile verdict. */
export const NEXCORE_FRAGILE_CONDITION =
  "NexCore's Monitor for a Fragile company holds only if the contract eliminates material uncovered exposure: collected before activation, prepaid usage and paid onboarding. If those cannot be met, the deal is treated as Limit exposure.";

export function protections(seller: Seller, verdict: Verdict): ProtectionLine[] {
  const row = (seller === "CoreThread" ? CORETHREAD : NEXCORE)[verdict];
  const components = CONTRACT_COMPONENTS[seller];
  return components.map((component) => {
    const text = row[component];
    // "Same" repeats the first component's cell in that row.
    const sameAs = text === "Same" ? components[0] : null;
    const resolvedText = sameAs ? row[sameAs] : text;
    return { component, text, resolvedText, sameAs, lines: resolvedText.split(" · ") };
  });
}

export function sellerCondition(seller: Seller, state: HealthState): string | null {
  return seller === "NexCore" && state === "Fragile" ? NEXCORE_FRAGILE_CONDITION : null;
}
