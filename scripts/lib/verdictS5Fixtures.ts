// Adapters for the frozen S5 fixtures (tests/fixtures/verdict-s5/, built by
// scripts/build-verdict-s5-fixtures.ts).
//
// frozenToInputs: the S4 `.x` object -> VerdictInputs.
//   ticker, sic, revYoY, marginChangePts0, rdYoY, rdStatus, rdTag,
//   ocfTTM, fcfTTM, revTTM0, currentRatio0, netDebt, runwayQuarters  -> the matching fields, unchanged
//   critical  "Critical: … (8-K <item> <date>)"                       -> criticalFilings {item, filingDate}
//   restructuring205 [dates]                                          -> restructuringFilings {filingDate}
//   missedFiling null                                                 -> filing not measurable, reason = missedFilingWhy
//   missedFiling true                                                 -> filing case "overdue" (form, period, deadline
//                                                                        parsed from missedFilingWhy when it has them)
//   missedFiling false                                                -> filing case "on-time", details null. The frozen
//       inputs record only the flag value, not which D2 case applied. The four non-overdue D2 cases have the same flag
//       (false), the same card severity (Clear) and the same evidence effect (unchanged), so no compared field can
//       depend on which of them is used.
//   stale                                                             -> stale.stale (no period label in the frozen data)
//   financeArm && !financeArmSeparable                                -> dataQuality.financeArmDebtNotSeparable
//   restrictedNotSeparated                                            -> dataQuality.restrictedCashNotSeparated
//   (no frozen value)                                                 -> periodLabel, periodEnd, otherRatios, supporting: null
//
// parseExpectedDirection: the REVISED CoreThread direction string -> the rules' representation.
//   "EXPANDING" | "FLAT"                         -> that direction, mixed false
//   "UNKNOWN (R&D <reason>)"                     -> UNKNOWN, rdUnknownReason <reason>
//   "CAUTION (<legs>)"                           -> CAUTION, mixed false
//   "CAUTION · MIXED (EXPANDING R&D a%/b%; <legs>)" -> CAUTION, mixed true
//   legs: "R&D a%/b%" (R&D caution), "8-K 2.05 d1, d2…" (restructuring, dates in order), "OPERATING DETERIORATION".
import type { CriticalItem, FilingObservation, RdStatus, VerdictInputs } from "@/lib/verdict/types";

export interface FrozenX {
  ticker: string;
  sic: number | null;
  revYoY: [number | null, number | null];
  marginChangePts0: number | null;
  rdYoY: [number | null, number | null];
  rdStatus: string;
  rdTag: string | null;
  rdQuarters: number;
  ocfTTM: [number | null, number | null];
  fcfTTM: [number | null, number | null];
  capexTTM: [number | null, number | null];
  revTTM0: number | null;
  currentRatio0: number | null;
  netDebt: [number | null, number | null];
  runwayQuarters: number | null;
  runwayCase: string;
  critical: string[];
  missedFiling: boolean | null;
  missedFilingWhy: string;
  restructuring205: string[];
  stale: boolean;
  financeArm: boolean;
  financeArmSeparable: boolean;
  restrictedNotSeparated: boolean;
}

export interface ExpectedBlock {
  state: string;
  deciding: string;
  fired: string[];
  unmeasurable: string[];
  flags: Record<string, boolean | null>;
  ct: { direction: string; caution: boolean; verdict: string; conf: string };
  nc: { direction: string; caution: boolean; verdict: string; conf: string };
}

export interface FixtureRecord {
  set: "today" | "distress" | "year-back";
  ticker: string;
  cik: string;
  vantage: string | null;
  assessmentDate: string;
  source: string;
  x: FrozenX;
  expected: ExpectedBlock;
}

const CRITICAL = /\(8-K (1\.03|2\.04|4\.02) (\d{4}-\d{2}-\d{2})\)/;
const OVERDUE = /^(10-[QK]) for (\d{4}-\d{2}-\d{2}) due (\d{4}-\d{2}-\d{2}), not filed/;

function filingFor(x: FrozenX): FilingObservation {
  if (x.missedFiling === null) return { measurable: false, reason: x.missedFilingWhy };
  if (x.missedFiling === true) {
    const m = x.missedFilingWhy.match(OVERDUE);
    return { measurable: true, case: "overdue", form: m?.[1] ?? null, periodEnd: m?.[2] ?? null, deadline: m?.[3] ?? null, extendedDeadline: null, filedOn: null };
  }
  return { measurable: true, case: "on-time", form: null, periodEnd: null, deadline: null, extendedDeadline: null, filedOn: null };
}

export function frozenToInputs(rec: FixtureRecord): VerdictInputs {
  const x = rec.x;
  return {
    ticker: rec.ticker,
    assessmentDate: rec.assessmentDate,
    periodLabel: null,
    periodEnd: null,
    sic: x.sic,
    revenueYoYPct: x.revYoY,
    operatingMarginChangePts: x.marginChangePts0,
    rdYoYPct: x.rdYoY,
    rdStatus: x.rdStatus as RdStatus,
    rdTag: x.rdTag,
    ocf12m: { now: x.ocfTTM[0], yearAgo: x.ocfTTM[1] },
    fcf12m: { now: x.fcfTTM[0], yearAgo: x.fcfTTM[1] },
    revenue12m: x.revTTM0,
    currentRatio: x.currentRatio0,
    netDebt: { now: x.netDebt[0], yearAgo: x.netDebt[1] },
    runwayQuarters: x.runwayQuarters,
    criticalFilings: x.critical.map((c) => {
      const m = c.match(CRITICAL);
      if (!m) throw new Error(`${rec.ticker}: cannot read critical filing "${c}"`);
      return { item: m[1] as CriticalItem, filingDate: m[2], accessionNumber: null };
    }),
    restructuringFilings: x.restructuring205.map((d) => ({ filingDate: d, accessionNumber: null })),
    filing: filingFor(x),
    stale: { stale: x.stale, assessedPeriodLabel: null, newerFiling: null },
    dataQuality: { financeArmDebtNotSeparable: x.financeArm && !x.financeArmSeparable, restrictedCashNotSeparated: x.restrictedNotSeparated },
    otherRatios: { altmanZ: null, dso: null, dpo: null, debtToEquity: null },
    supporting: { liquidityNow: null, totalDebtNow: null, currentAssets: null, currentLiabilities: null, liquidityNotes: [] },
  };
}

export interface ParsedDirection {
  direction: "EXPANDING" | "FLAT" | "CAUTION" | "UNKNOWN";
  mixed: boolean;
  rdUnknownReason: string | null;
  legs: { rd: [number, number] | null; restructuring: string[]; operatingDeterioration: boolean };
}

const RD = /R&D (-?\d+(?:\.\d+)?)%\/(-?\d+(?:\.\d+)?)%/;
const DATES = /\d{4}-\d{2}-\d{2}/g;

export function parseExpectedDirection(s: string): ParsedDirection {
  const none = { rd: null, restructuring: [], operatingDeterioration: false };
  if (s === "EXPANDING" || s === "FLAT") return { direction: s, mixed: false, rdUnknownReason: null, legs: none };
  const unknown = s.match(/^UNKNOWN \(R&D (.+)\)$/);
  if (unknown) return { direction: "UNKNOWN", mixed: false, rdUnknownReason: unknown[1], legs: none };
  const caution = s.match(/^CAUTION( · MIXED)? \((.+)\)$/);
  if (!caution) throw new Error(`unrecognised CoreThread direction "${s}"`);
  const mixed = !!caution[1];
  // In a MIXED string the expanding R&D comes first, before the semicolon; the caution legs follow.
  const legText = mixed ? caution[2].split("; ").slice(1).join("; ") : caution[2];
  const rd = legText.match(RD);
  const at = legText.indexOf("8-K 2.05 ");
  const restructuring = at < 0 ? [] : (legText.slice(at).split("OPERATING DETERIORATION")[0].match(DATES) ?? []);
  return {
    direction: "CAUTION",
    mixed,
    rdUnknownReason: null,
    legs: { rd: rd ? [Number(rd[1]), Number(rd[2])] : null, restructuring, operatingDeterioration: legText.includes("OPERATING DETERIORATION") },
  };
}
