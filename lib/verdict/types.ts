/**
 * Types for the S5 verdict engine (Earnings_Lens_Verdict_Rules_S5.md).
 *
 * Money is whole USD as filed; percentages are in percent (−15 means
 * −15%); a missing value is null and is never read as zero.
 */
import type { T3 } from "@/lib/verdict/logic";

// ------------------------------------------------------------------ inputs

/** Quarterly R&D status (rules 5.1 and 11 R6). */
export type RdStatus = "quarterly" | "annual only" | "not filed in the window" | "not filed";

export type CriticalItem = "1.03" | "2.04" | "4.02";

export interface CriticalFiling {
  item: CriticalItem;
  filingDate: string;
  accessionNumber: string | null;
}

export interface RestructuringFiling {
  filingDate: string;
  accessionNumber: string | null;
}

/** The five filing-status cases of rules section 14 D2. */
export type FilingCase = "overdue" | "filed-within-extension" | "extension-open" | "filed-late" | "on-time";

/**
 * The most recent required periodic report, classified as of the
 * assessment date (lib/verdict/filingStatus.ts classifyRequiredReport).
 * Detail fields are null when not known.
 */
export type FilingObservation =
  | { measurable: false; reason: string }
  | {
      measurable: true;
      case: FilingCase;
      form: string | null;
      periodEnd: string | null;
      /** The original deadline, rolled forward to a business day. */
      deadline: string | null;
      /** The 12b-25 extended deadline, when a valid 12b-25 was filed. */
      extendedDeadline: string | null;
      /** Filing date of the report, when filed on or before the assessment date. */
      filedOn: string | null;
    };

export interface StaleObservation {
  /** A newer periodic filing exists that has not been incorporated (rules section 8). */
  stale: boolean;
  /** The filing period actually assessed, e.g. "Q2 FY26". */
  assessedPeriodLabel: string | null;
  newerFiling: { form: string; periodEnd: string; filingDate: string } | null;
}

/** Shown under "Other ratios"; never used in the verdict (rules section 10). */
export interface OtherRatios {
  altmanZ: number | null;
  dso: number | null;
  dpo: number | null;
  debtToEquity: number | null;
}

/** Figures behind the explanations that the flags themselves do not need. */
export interface SupportingFigures {
  liquidityNow: number | null;
  totalDebtNow: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  /** How liquidity was read, e.g. "includes restricted cash not separately disclosed" (rules 11 R4). */
  liquidityNotes: string[];
}

export interface VerdictInputs {
  ticker: string;
  /** Today for a live read; the vantage date for an as-of read. */
  assessmentDate: string;
  /** The latest quarter assessed (q0), e.g. "Q2 FY26". */
  periodLabel: string | null;
  periodEnd: string | null;
  sic: number | null;

  /** Revenue Y/Y in %, [q0, q1]. */
  revenueYoYPct: [number | null, number | null];
  /** Operating margin (q0) minus the same quarter a year earlier, in points. */
  operatingMarginChangePts: number | null;

  /** R&D Y/Y in %, [q0, q1], from the tag chosen under 11 R6. */
  rdYoYPct: [number | null, number | null];
  rdStatus: RdStatus;
  rdTag: string | null;

  /** 12-month operating cash flow: q0–q3 and q4–q7. */
  ocf12m: { now: number | null; yearAgo: number | null };
  /** 12-month free cash flow (OCF − purchases of PP&E), same windows. */
  fcf12m: { now: number | null; yearAgo: number | null };
  /** 12-month revenue, q0–q3. */
  revenue12m: number | null;
  /** Current assets ÷ current liabilities at q0. */
  currentRatio: number | null;
  /** Net debt (total debt − liquidity) at q0 and one year earlier. */
  netDebt: { now: number | null; yearAgo: number | null };
  /** The app's runway rule in whole quarters; null when unknown (latest-quarter OCF not negative, or not computable). */
  runwayQuarters: number | null;

  criticalFilings: CriticalFiling[];
  restructuringFilings: RestructuringFiling[];
  filing: FilingObservation;
  stale: StaleObservation;

  dataQuality: {
    /** 11 R3: finance-arm debt and cash could not be put on one scope. */
    financeArmDebtNotSeparable: boolean;
    /** 11 R4: restricted cash could not be separated from the face cash line. */
    restrictedCashNotSeparated: boolean;
  };

  otherRatios: OtherRatios;
  supporting: SupportingFigures;
}

// ------------------------------------------------------------------ results

export type FlagName =
  | "SEVERE BURN"
  | "CAUTION BURN"
  | "PERSISTENT BURN, RUNWAY UNKNOWN"
  | "INVESTMENT CASH PRESSURE"
  | "WEAK LIQUIDITY"
  | "OPERATING DETERIORATION"
  | "LEVERAGE"
  | "FUNDING SUBSTITUTION"
  | "LOW-CASH DEBT"
  | "MISSED FILING";

export type AreaId = "cash-generation" | "near-term-liquidity" | "operating-performance" | "funding-and-leverage" | "filing-status";

export type HealthState = "Critical" | "Fragile" | "Watch" | "Resilient";

export type Verdict = "Limit exposure" | "Monitor" | "Pursue with guardrails" | "Pursue";

export type Seller = "CoreThread" | "NexCore";

export interface Layer1Result {
  flags: Record<FlagName, T3>;
  fired: FlagName[];
  notMeasurable: FlagName[];
  /** Areas with at least one fired flag, in area order. */
  areas: AreaId[];
  state: HealthState;
  deciding: string;
  /** "Same for both entities · No warning thresholds triggered", or the triggered areas. */
  subtitle: string;
  /** The Critical filings that set the state, labelled (empty unless Critical). */
  criticalReasons: string[];
  /** Any cash-generation flag (SEVERE, CAUTION, PERSISTENT BURN RUNWAY UNKNOWN, INVESTMENT CASH PRESSURE), three-valued. */
  anyCashFlag: T3;
  /** Computed values the flags used (the explanations read these). */
  values: {
    runwayMonths: number | null;
    ocfBar: number | null;
    netDebtBar: number | null;
    leverageMultiple: number | null;
    netDebtIncrease: number | null;
    increaseBar: number | null;
    substitutionRatio: number | null;
  };
}

export type CoreThreadDirection = "EXPANDING" | "FLAT" | "CAUTION" | "UNKNOWN";

export type CoreThreadLeg =
  | { kind: "rd-caution"; rdYoYPct: [number, number] }
  | { kind: "restructuring"; filingDates: string[] }
  | { kind: "operating-deterioration" };

export interface CoreThreadCondition {
  direction: CoreThreadDirection;
  /** True only when CAUTION and EXPANDING are both true (shown "Caution · Mixed"; counts as caution). */
  mixed: boolean;
  mixedReasons: string[];
  /** The CAUTION legs that fired. */
  legs: CoreThreadLeg[];
  /** Why R&D direction is unknown, when it is. */
  rdUnknownReason: string | null;
  rdUnknown: boolean;
  expanding: T3;
  rdCaution: T3;
  caution: T3;
  /** What the matrix reads: CAUTION true. */
  sellerCaution: boolean;
  /** "Engineering spend (R&D)": Expanding / Flat / Caution / Not separately disclosed. */
  engineeringSpend: "Expanding" | "Flat" | "Caution" | "Not separately disclosed";
  notMeasurableTests: string[];
}

export interface NexCoreCondition {
  caution: T3;
  sellerCaution: boolean;
  /** "cutting back across the business" when caution fires. */
  label: string | null;
  notMeasurableTests: string[];
}

export type EvidenceLevel = "Exception" | "Limited" | "Adequate";

export interface EvidenceResult {
  level: EvidenceLevel;
  reasons: string[];
  /** Present when a newer periodic filing has not been incorporated (rules section 8, stale period). */
  staleQualification: null | {
    assessedOn: string | null;
    newerFiling: { form: string; periodEnd: string; filingDate: string } | null;
    reviewQualification: true;
    fullyCurrent: false;
  };
}

export interface ProtectionLine {
  component: string;
  /** The cell exactly as written in rules 7.2 (may read "Same"). */
  text: string;
  /** The cell's wording with "Same" resolved to the component it repeats. */
  resolvedText: string;
  sameAs: string | null;
  lines: string[];
}

export interface PaymentTerms {
  net30: "available";
  net45: "on request" | "not offered";
  net60: "not recommended";
  display: string;
}

export interface SellerResult {
  seller: Seller;
  verdict: Verdict;
  terms: PaymentTerms;
  protections: ProtectionLine[];
  /** Rules 7.3, on every NexCore Fragile verdict. */
  contractCondition: string | null;
  evidence: EvidenceResult;
}

/** Rules section 9: a rough guide to the company type, from the industry code. */
export type LikelyRoute = "Partner" | "Device builder" | "Site operator";

export interface PotentialApplication {
  shown: boolean;
  line: string | null;
  /** The likely route; null whenever nothing is shown. */
  route: LikelyRoute | null;
  sic: number | null;
  display: string | null;
  source: string | null;
}

export type FilingCardText = "Overdue" | "Filed within extension" | "Extension open" | "Filed late · received" | "On time" | "Not measurable";

export interface FilingStatusResult {
  measurable: boolean;
  case: FilingCase | null;
  missedFiling: T3;
  card: { text: FilingCardText; severity: "Warning" | "Clear" | null };
  /** The What-stands-out item, or null when there is nothing to say. */
  standsOut: null | {
    kind: "Overdue filing" | "Informational" | "Filed late";
    form: string | null;
    period: string | null;
    deadline?: string | null;
    extendedDeadline?: string | null;
    filingDate?: string | null;
  };
  /** Only an overdue report changes evidence (Exception, missed filing). */
  evidenceEffect: "Exception (missed filing)" | "unchanged";
  reason: string | null;
}

export interface ExplanationInput {
  name: string;
  value: number | string | null;
  unit: "USD" | "%" | "pts" | "months" | "x" | "date" | "text";
}

export interface FlagExplanation {
  flag: FlagName;
  value: T3;
  formula: string;
  warningWhen: string;
  inputs: ExplanationInput[];
}

export interface AreaExplanation {
  area: AreaId;
  title: string;
  scale: string[];
  level: "Clear" | "Warning" | "Severe";
  notMeasurable: FlagName[];
  formula: string[];
  thisQuarter: ExplanationInput[];
  warningWhen: string[];
  flags: FlagExplanation[];
}

export interface OtherRatioExplanation {
  ratio: "altmanZ" | "dso" | "dpo" | "debtToEquity" | "currentRatio";
  label: string;
  value: number | null;
  formula: string;
  note: string;
}

export interface VerdictResult {
  ticker: string;
  assessmentDate: string;
  inputs: VerdictInputs;
  layer1: Layer1Result;
  coreThread: { condition: CoreThreadCondition } & SellerResult;
  nexCore: { condition: NexCoreCondition } & SellerResult;
  potentialApplication: PotentialApplication;
  filingStatus: FilingStatusResult;
  explanations: { areas: AreaExplanation[]; otherRatios: OtherRatioExplanation[] };
}
