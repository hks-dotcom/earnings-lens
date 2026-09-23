import { LensResult } from "@/lib/rules/evaluateLens";

export interface RulesSnapshot {
  ticker: string;
  cik: string;
  /** The injected "now" the rules were evaluated as-of -- NOT the real current date, so this snapshot stays reproducible even as red flags age out in live runs. */
  asOf: string;
  /** No generation timestamp -- see the note in scripts/lib/snapshotTypes.ts. */
  quarterLabel: string;
  services: LensResult;
  saas: LensResult;
}

/** Fields compared field-by-field (JSON equality) between two lens results, for a readable diff. */
export const LENS_FIELDS: (keyof LensResult)[] = [
  "revenue",
  "engineeringSpend",
  "techInvestment",
  "paymentBehavior",
  "retrenchment",
  "redFlags",
  "altmanZPrime",
  "altmanZone",
  "cashPosition",
  "ladder",
  "opportunity",
  "risk",
  "quadrant",
  "dealStructure",
  "negotiationNote",
];
