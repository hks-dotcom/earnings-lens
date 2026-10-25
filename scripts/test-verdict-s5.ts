// Tests for the S5 verdict engine (lib/verdict/, Earnings_Lens_Verdict_Rules_S5.md).
// No network calls.
//
// 1. The 90 frozen regression fixtures (rules 12.1–12.4): exact match on
//    state, fired flags, not-measurable flags, CoreThread direction, mixed
//    indicator and legs, both verdicts and both evidence levels.
// 2. The synthetic fixtures F1–F11 (rules 12.5).
// 3. The five filing-status cases (14 D2), the as-of rule, and a MIXED
//    company getting exactly the CAUTION verdict.
// 4. Unit tests for the parts the fixtures cannot reach (logic, matrix,
//    terms, protections, potential application, evidence order, boundaries).
//
// Usage: npx tsx scripts/test-verdict-s5.ts

import * as fs from "fs";
import * as path from "path";
import { runVerdict } from "@/lib/verdict/engine";
import { and3, or3 } from "@/lib/verdict/logic";
import { verdictFor } from "@/lib/verdict/matrix";
import { paymentTerms, protections, NEXCORE_FRAGILE_CONDITION } from "@/lib/verdict/terms";
import { potentialApplication } from "@/lib/verdict/potentialApplication";
import { classifyRequiredReport, filingStatus } from "@/lib/verdict/filingStatus";
import { RULES } from "@/lib/verdict/rulesConfig";
import type { FilingObservation, HealthState, VerdictInputs, VerdictResult } from "@/lib/verdict/types";
import { FixtureRecord, frozenToInputs, parseExpectedDirection } from "./lib/verdictS5Fixtures";

let pass = 0;
let fail = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}  (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  if (ok) pass++;
  else fail++;
}

const sorted = (xs: string[]) => [...xs].sort();

// ------------------------------------------------------------------ 1. regression fixtures
console.log("=== Regression fixtures (rules 12.1–12.4): 90 records ===");
const FIX = path.join(process.cwd(), "tests/fixtures/verdict-s5");
const records: FixtureRecord[] = ["today.json", "distress.json", "yearback.json"].flatMap((f) => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8")));
let recordPass = 0;
const mismatches: string[] = [];
for (const rec of records) {
  const r = runVerdict(frozenToInputs(rec));
  const e = rec.expected;
  const ed = parseExpectedDirection(e.ct.direction);
  const ct = r.coreThread.condition;
  const rdLeg = ct.legs.find((l) => l.kind === "rd-caution");
  const rsLeg = ct.legs.find((l) => l.kind === "restructuring");
  const got = {
    state: r.layer1.state,
    fired: sorted(r.layer1.fired),
    notMeasurable: sorted(r.layer1.notMeasurable),
    ctDirection: ct.direction,
    ctMixed: ct.mixed,
    ctRdUnknownReason: ct.direction === "UNKNOWN" ? ct.rdUnknownReason : null,
    ctLegs: {
      rd: rdLeg && rdLeg.kind === "rd-caution" ? rdLeg.rdYoYPct.map((v) => Number(v.toFixed(1))) : null,
      restructuring: rsLeg && rsLeg.kind === "restructuring" ? rsLeg.filingDates : [],
      operatingDeterioration: ct.legs.some((l) => l.kind === "operating-deterioration"),
    },
    ctVerdict: r.coreThread.verdict,
    ncVerdict: r.nexCore.verdict,
    ctEvidence: r.coreThread.evidence.level,
    ncEvidence: r.nexCore.evidence.level,
    ncCaution: r.nexCore.condition.sellerCaution,
  };
  const want = {
    state: e.state,
    fired: sorted(e.fired),
    notMeasurable: sorted(e.unmeasurable),
    ctDirection: ed.direction,
    ctMixed: ed.mixed,
    ctRdUnknownReason: ed.rdUnknownReason,
    ctLegs: ed.legs,
    ctVerdict: e.ct.verdict,
    ncVerdict: e.nc.verdict,
    ctEvidence: e.ct.conf,
    ncEvidence: e.nc.conf,
    ncCaution: e.nc.direction === "CAUTION",
  };
  const label = `${rec.set} ${rec.ticker}${rec.vantage ? ` (${rec.vantage})` : ""}`;
  const diffs = (Object.keys(want) as (keyof typeof want)[]).filter((k) => JSON.stringify(got[k]) !== JSON.stringify(want[k]));
  if (diffs.length === 0) {
    recordPass++;
    pass++;
    console.log(`[PASS] ${label}: ${got.state} [${got.fired.join(", ") || "—"}] CT ${got.ctDirection}${got.ctMixed ? " · MIXED" : ""} ${got.ctVerdict} / NC ${got.ncVerdict} · ${got.ctEvidence} / ${got.ncEvidence}`);
  } else {
    fail++;
    const msg = `${label}: ${diffs.map((k) => `${k} expected ${JSON.stringify(want[k])}, got ${JSON.stringify(got[k])}`).join("; ")}`;
    mismatches.push(msg);
    console.log(`[FAIL] ${msg}`);
  }
}
check("all 90 fixture records match exactly", { records: records.length, matched: recordPass }, { records: 90, matched: 90 });

// ------------------------------------------------------------------ helpers for synthetic cases
const M = 1_000_000;
const base = (): VerdictInputs => frozenToInputs(records.find((r) => r.set === "today" && r.ticker === "NVDA")!);
const withX = (patch: (x: VerdictInputs) => void) => {
  const x = base();
  patch(x);
  return x;
};
const flag = (x: VerdictInputs, f: keyof VerdictResult["layer1"]["flags"]) => runVerdict(x).layer1.flags[f];

// ------------------------------------------------------------------ 2. synthetic F1–F11
console.log("\n=== Synthetic fixtures F1–F11 (rules 12.5) ===");
const fsCase = (increase: number, ocf: number, ocfYA: number, ndYA: number) =>
  withX((x) => {
    x.ocf12m = { now: ocf * M, yearAgo: ocfYA * M };
    x.netDebt = { now: (ndYA + increase) * M, yearAgo: ndYA * M };
  });
check("F1 OCF −500M (a year ago −400M), net debt a year ago 100M, increase 1M -> FUNDING SUBSTITUTION false", flag(fsCase(1, -500, -400, 100), "FUNDING SUBSTITUTION"), false);
check("F2 increase 25M -> false", flag(fsCase(25, -500, -400, 100), "FUNDING SUBSTITUTION"), false);
check("F3 increase 50M (not more than 50M) -> false", flag(fsCase(50, -500, -400, 100), "FUNDING SUBSTITUTION"), false);
check("F4 increase 75M -> true", flag(fsCase(75, -500, -400, 100), "FUNDING SUBSTITUTION"), true);
check("F5 OCF 1,000M (a year ago 1,200M), net debt 1,500M -> 2,600M -> true", flag(fsCase(1100, 1000, 1200, 1500), "FUNDING SUBSTITUTION"), true);
check("F6 as F5 with increase 50M -> false", flag(fsCase(50, 1000, 1200, 1500), "FUNDING SUBSTITUTION"), false);
check("F7 OCF 0 (a year ago 100M), increase 1M -> true (|0| × 10% = 0)", flag(fsCase(1, 0, 100, 100), "FUNDING SUBSTITUTION"), true);
check(
  "F8 OCF now missing -> FUNDING SUBSTITUTION not measurable",
  flag(withX((x) => (x.ocf12m = { now: null, yearAgo: x.ocf12m.yearAgo })), "FUNDING SUBSTITUTION"),
  null
);
const lcd = (ocf: number, nd: number | null) =>
  withX((x) => {
    x.revenue12m = 1000 * M;
    x.ocf12m = { now: ocf * M, yearAgo: x.ocf12m.yearAgo };
    x.netDebt = { now: nd === null ? null : nd * M, yearAgo: x.netDebt.yearAgo };
  });
check("F9a revenue 1,000M, OCF 20M, net debt 101M -> LOW-CASH DEBT true", flag(lcd(20, 101), "LOW-CASH DEBT"), true);
check("F9b OCF 21M, net debt 101M -> false", flag(lcd(21, 101), "LOW-CASH DEBT"), false);
check("F9c OCF 20M, net debt 100M -> false", flag(lcd(20, 100), "LOW-CASH DEBT"), false);
check("F9d OCF −50M, net debt 500M -> true", flag(lcd(-50, 500), "LOW-CASH DEBT"), true);
check("F10 OCF clearly above 2% of revenue, net debt missing -> LOW-CASH DEBT false (false wins)", flag(lcd(300, null), "LOW-CASH DEBT"), false);
check("F11 OCF at or below 2% of revenue, net debt missing -> LOW-CASH DEBT not measurable", flag(lcd(20, null), "LOW-CASH DEBT"), null);

// ------------------------------------------------------------------ 3. filing status (D2), as-of, MIXED
console.log("\n=== Filing status: the five D2 cases ===");
const Q = { form: "10-Q" as const, periodEnd: "2026-06-30", deadline: "2026-08-10" };
const withFiling = (obs: FilingObservation) => withX((x) => (x.filing = obs));
function d2(name: string, obs: FilingObservation | null, want: { flag: boolean; card: string; severity: string; standsOut: unknown; evidence: string }) {
  if (!obs) {
    check(`${name}: classified`, obs, "a case");
    return;
  }
  const r = runVerdict(withFiling(obs));
  check(`${name}: MISSED FILING`, r.layer1.flags["MISSED FILING"], want.flag);
  check(`${name}: card`, [r.filingStatus.card.text, r.filingStatus.card.severity], [want.card, want.severity]);
  check(`${name}: What stands out`, r.filingStatus.standsOut, want.standsOut);
  check(`${name}: evidence`, [r.coreThread.evidence.level, r.nexCore.evidence.level, r.filingStatus.evidenceEffect], [
    want.evidence === "Exception" ? "Exception" : "Adequate",
    want.evidence === "Exception" ? "Exception" : "Adequate",
    want.evidence === "Exception" ? "Exception (missed filing)" : "unchanged",
  ]);
}
d2("overdue, none filed (no 12b-25)", classifyRequiredReport({ ...Q, extendedDeadline: null, filedOn: null }, "2026-08-11"), {
  flag: true,
  card: "Overdue",
  severity: "Warning",
  standsOut: { kind: "Overdue filing", form: "10-Q", period: "2026-06-30", deadline: "2026-08-10" },
  evidence: "Exception",
});
d2("overdue past the extended deadline", classifyRequiredReport({ ...Q, extendedDeadline: "2026-08-15", filedOn: null }, "2026-08-17"), {
  flag: true,
  card: "Overdue",
  severity: "Warning",
  standsOut: { kind: "Overdue filing", form: "10-Q", period: "2026-06-30", deadline: "2026-08-15" },
  evidence: "Exception",
});
d2("filed within a valid 12b-25 extension", classifyRequiredReport({ ...Q, extendedDeadline: "2026-08-15", filedOn: "2026-08-14" }, "2026-09-01"), {
  flag: false,
  card: "Filed within extension",
  severity: "Clear",
  standsOut: { kind: "Informational", form: "10-Q", period: "2026-06-30", extendedDeadline: "2026-08-15", filingDate: "2026-08-14" },
  evidence: "unchanged",
});
d2("extension still open, not yet filed", classifyRequiredReport({ ...Q, extendedDeadline: "2026-08-15", filedOn: null }, "2026-08-12"), {
  flag: false,
  card: "Extension open",
  severity: "Clear",
  standsOut: { kind: "Informational", form: "10-Q", period: "2026-06-30", extendedDeadline: "2026-08-15" },
  evidence: "unchanged",
});
d2("filed after the extended deadline (received)", classifyRequiredReport({ ...Q, extendedDeadline: "2026-08-15", filedOn: "2026-08-20" }, "2026-09-01"), {
  flag: false,
  card: "Filed late · received",
  severity: "Clear",
  standsOut: { kind: "Filed late", form: "10-Q", period: "2026-06-30", extendedDeadline: "2026-08-15", filingDate: "2026-08-20" },
  evidence: "unchanged",
});
d2("filed by the original deadline", classifyRequiredReport({ ...Q, extendedDeadline: null, filedOn: "2026-08-10" }, "2026-09-01"), {
  flag: false,
  card: "On time",
  severity: "Clear",
  standsOut: null,
  evidence: "unchanged",
});
check("filed late is never shown as On time", filingStatus(classifyRequiredReport({ ...Q, extendedDeadline: null, filedOn: "2026-08-11" }, "2026-09-01")!).card.text, "Filed late · received");
check("a report not yet due is not a required report", classifyRequiredReport({ ...Q, extendedDeadline: null, filedOn: null }, "2026-08-10"), null);
check(
  "a newer filing not yet incorporated still sets Exception (stale) on a filed-late report",
  runVerdict(
    withX((x) => {
      x.filing = classifyRequiredReport({ ...Q, extendedDeadline: "2026-08-15", filedOn: "2026-08-20" }, "2026-09-01")!;
      x.stale = { stale: true, assessedPeriodLabel: "Q1 FY26", newerFiling: { form: "10-Q", periodEnd: "2026-06-30", filingDate: "2026-08-20" } };
    })
  ).coreThread.evidence,
  {
    level: "Exception",
    reasons: ["stale period"],
    staleQualification: { assessedOn: "Assessed on Q1 FY26 filing", newerFiling: { form: "10-Q", periodEnd: "2026-06-30", filingDate: "2026-08-20" }, reviewQualification: true, fullyCurrent: false },
  }
);
check("filing status not measurable -> MISSED FILING not measurable, card Not measurable, evidence Limited", (() => {
  const r = runVerdict(withFiling({ measurable: false, reason: "fiscal-year change" }));
  return [r.layer1.flags["MISSED FILING"], r.filingStatus.card.text, r.coreThread.evidence.level, r.nexCore.evidence.level];
})(), [null, "Not measurable", "Limited", "Limited"]);

console.log("\n=== As-of: a report filed after the vantage date does not clear an earlier MISSED FILING ===");
{
  const report = { ...Q, extendedDeadline: null, filedOn: "2026-09-15" };
  const asOf = classifyRequiredReport(report, "2026-09-01");
  const later = classifyRequiredReport(report, "2026-10-01");
  check("as of 2026-09-01 (report filed 2026-09-15): overdue", asOf && asOf.measurable ? asOf.case : null, "overdue");
  check("as of 2026-09-01: filedOn not visible", asOf && asOf.measurable ? asOf.filedOn : "x", null);
  const r = runVerdict(withX((x) => ((x.assessmentDate = "2026-09-01"), (x.filing = asOf!))));
  check("as of 2026-09-01: MISSED FILING true, evidence Exception", [r.layer1.flags["MISSED FILING"], r.coreThread.evidence.level], [true, "Exception"]);
  check("as of 2026-10-01: filed late · received", later && later.measurable ? later.case : null, "filed-late");
}

console.log("\n=== A MIXED company gets exactly the CAUTION verdict ===");
{
  const mixed = (state: "Resilient" | "Watch") =>
    withX((x) => {
      x.rdYoYPct = [22.3, 12.8];
      x.restructuringFilings = [{ filingDate: "2026-04-15", accessionNumber: null }];
      if (state === "Watch") x.netDebt = { now: 700_000 * M, yearAgo: x.netDebt.yearAgo }; // LEVERAGE alone
    });
  const caution = (state: "Resilient" | "Watch") =>
    withX((x) => {
      x.rdYoYPct = [0, 0];
      x.restructuringFilings = [{ filingDate: "2026-04-15", accessionNumber: null }];
      if (state === "Watch") x.netDebt = { now: 700_000 * M, yearAgo: x.netDebt.yearAgo };
    });
  for (const s of ["Resilient", "Watch"] as const) {
    const m = runVerdict(mixed(s));
    const c = runVerdict(caution(s));
    check(`${s}: MIXED is direction CAUTION with the mixed indicator`, [m.layer1.state, m.coreThread.condition.direction, m.coreThread.condition.mixed], [s, "CAUTION", true]);
    check(`${s}: the plain CAUTION case is not mixed`, [c.layer1.state, c.coreThread.condition.direction, c.coreThread.condition.mixed], [s, "CAUTION", false]);
    check(`${s}: MIXED verdicts equal the CAUTION verdicts`, [m.coreThread.verdict, m.nexCore.verdict], [c.coreThread.verdict, c.nexCore.verdict]);
  }
  check("MIXED reasons name the expanding R&D and the restructuring", runVerdict(mixed("Resilient")).coreThread.condition.mixedReasons, ["Expanding R&D +22.3% / +12.8%", "8-K 2.05 2026-04-15"]);
}

// ------------------------------------------------------------------ 4. unit tests
console.log("\n=== Three-valued logic (rules 3) ===");
check("AND: false wins over not measurable", and3(false, null, true), false);
check("AND: not measurable when no part is false", and3(true, null), null);
check("AND: all true", and3(true, true), true);
check("OR: true wins over not measurable", or3(null, true), true);
check("OR: not measurable when no part is true", or3(false, null), null);
check("OR: all false", or3(false, false), false);

console.log("\n=== Verdict matrix (rules 6) ===");
const MATRIX: [HealthState, boolean, string, string][] = [
  ["Critical", true, "Limit exposure", "Limit exposure"],
  ["Critical", false, "Limit exposure", "Limit exposure"],
  ["Fragile", true, "Limit exposure", "Monitor"],
  ["Fragile", false, "Limit exposure", "Monitor"],
  ["Watch", true, "Monitor", "Pursue with guardrails"],
  ["Watch", false, "Pursue with guardrails", "Pursue with guardrails"],
  ["Resilient", true, "Pursue with guardrails", "Pursue with guardrails"],
  ["Resilient", false, "Pursue", "Pursue"],
];
for (const [s, c, ct, nc] of MATRIX) check(`${s}, ${c ? "caution" : "no caution"}`, [verdictFor(s, c, "CoreThread"), verdictFor(s, c, "NexCore")], [ct, nc]);

console.log("\n=== Payment terms and protections (rules 7) ===");
check("Pursue: Net 45 on request", paymentTerms("Pursue").display, "Net 30 ✓ · Net 45 on request · Net 60 ✕");
for (const v of ["Pursue with guardrails", "Monitor", "Limit exposure"] as const) check(`${v}: Net 45 not offered`, paymentTerms(v).display, "Net 30 ✓ · Net 45 ✕ · Net 60 ✕");
check("Net 60 never recommended", ["Pursue", "Pursue with guardrails", "Monitor", "Limit exposure"].every((v) => paymentTerms(v as "Pursue").net60 === "not recommended"), true);
check("CoreThread Pursue protections", protections("CoreThread", "Pursue").map((p) => p.text), [
  "Bill at each accepted milestone · written acceptance criteria and review period",
  "Billed monthly in arrears · timesheets approved monthly",
  "Billed in advance · defined scope and service period",
]);
check("CoreThread Limit exposure: T&M and Support read Same, resolved to Milestone", protections("CoreThread", "Limit exposure").map((p) => [p.text, p.sameAs, p.resolvedText]), [
  ["No new material unsecured work · funds or effective security before material delivery · exceptions escalated to finance", null, "No new material unsecured work · funds or effective security before material delivery · exceptions escalated to finance"],
  ["Same", "Milestone", "No new material unsecured work · funds or effective security before material delivery · exceptions escalated to finance"],
  ["Same", "Milestone", "No new material unsecured work · funds or effective security before material delivery · exceptions escalated to finance"],
]);
check("NexCore Monitor protections", protections("NexCore", "Monitor").map((p) => p.text), [
  "Small funded pilot or tightly scoped commitment · collected before activation · no assumed expansion or usage ramp · budget owner and deployment commitment confirmed",
  "Prepaid usage only",
  "Paid before work starts",
]);
{
  const rivn = runVerdict(frozenToInputs(records.find((r) => r.set === "today" && r.ticker === "RIVN")!));
  check("NexCore Fragile verdict carries the 7.3 condition", [rivn.layer1.state, rivn.nexCore.verdict, rivn.nexCore.contractCondition], ["Fragile", "Monitor", NEXCORE_FRAGILE_CONDITION]);
  check("CoreThread carries no 7.3 condition", rivn.coreThread.contractCondition, null);
  const nvda = runVerdict(base());
  check("a non-Fragile NexCore verdict carries no condition", nvda.nexCore.contractCondition, null);
}

console.log("\n=== Potential application (rules 9, 14 D1) ===");
check("Amazon, SIC 5961", [potentialApplication(5961).display, potentialApplication(5961).source], [
  "Potential application: Retail and logistics operations",
  "Industry-based · SIC 5961 · Commercial discovery, not part of the verdict",
]);
check("SIC 3674 -> Chip/platform integration (before the wider 3400–3999)", potentialApplication(3674).line, "Chip/platform integration");
check("SIC 3577 -> Devices and equipment", potentialApplication(3577).line, "Devices and equipment");
check("SIC 4813 -> Network and energy infrastructure", potentialApplication(4813).line, "Network and energy infrastructure");
check("SIC 4513 -> Retail and logistics operations", potentialApplication(4513).line, "Retail and logistics operations");
check("SIC 0100 -> Agriculture operations", potentialApplication(100).line, "Agriculture operations");
check("SIC 7372 -> hidden", potentialApplication(7372).shown, false);
check("no SIC -> hidden", potentialApplication(null).shown, false);
{
  const a = runVerdict(withX((x) => (x.sic = 3674)));
  const b = runVerdict(withX((x) => (x.sic = 7372)));
  check("never changes a verdict or evidence: SIC 3674 against 7372", [a.coreThread.verdict, a.nexCore.verdict, a.nexCore.evidence.level], [b.coreThread.verdict, b.nexCore.verdict, b.nexCore.evidence.level]);
}

console.log("\n=== Boundaries and operators (rules 4.1) ===");
const lev = (multiple: number) =>
  withX((x) => {
    x.revenue12m = 10_000 * M;
    x.ocf12m = { now: 1000 * M, yearAgo: 900 * M };
    x.netDebt = { now: multiple * 1000 * M, yearAgo: multiple * 1000 * M };
  });
check("LEVERAGE at exactly 4× -> false (strict)", flag(lev(4), "LEVERAGE"), false);
check("LEVERAGE above 4× -> true", flag(lev(4.01), "LEVERAGE"), true);
check(
  "LEVERAGE not measured when OCF ≤ 2% of revenue (LOW-CASH DEBT measures instead)",
  flag(withX((x) => ((x.revenue12m = 1000 * M), (x.ocf12m = { now: 20 * M, yearAgo: 30 * M }), (x.netDebt = { now: 500 * M, yearAgo: 500 * M }))), "LEVERAGE"),
  false
);
check("LEVERAGE not measurable with revenue missing and net debt positive", flag(withX((x) => ((x.revenue12m = null), (x.netDebt = { now: 500 * M, yearAgo: 500 * M }))), "LEVERAGE"), null);
check("LEVERAGE false with revenue missing and net debt ≤ 0 (false wins)", flag(withX((x) => (x.revenue12m = null)), "LEVERAGE"), false);
const burn = (runwayQuarters: number | null) =>
  withX((x) => {
    x.ocf12m = { now: -100 * M, yearAgo: -50 * M };
    x.runwayQuarters = runwayQuarters;
  });
check("runway 3 quarters (9 months) -> SEVERE BURN", flag(burn(3), "SEVERE BURN"), true);
check("runway 4 quarters (12 months) -> CAUTION BURN, not SEVERE", [flag(burn(4), "SEVERE BURN"), flag(burn(4), "CAUTION BURN")], [false, true]);
check("runway 8 quarters (24 months) -> neither", [flag(burn(8), "SEVERE BURN"), flag(burn(8), "CAUTION BURN")], [false, false]);
check("runway unknown -> PERSISTENT BURN, RUNWAY UNKNOWN; SEVERE and CAUTION not measurable", [flag(burn(null), "PERSISTENT BURN, RUNWAY UNKNOWN"), flag(burn(null), "SEVERE BURN"), flag(burn(null), "CAUTION BURN")], [true, null, null]);
check("SEVERE BURN alone -> Fragile", runVerdict(burn(3)).layer1.state, "Fragile");
check(
  "LEVERAGE + FUNDING SUBSTITUTION is one area -> Watch",
  (() => {
    const r = runVerdict(withX((x) => ((x.revenue12m = 10_000 * M), (x.ocf12m = { now: 1000 * M, yearAgo: 1200 * M }), (x.netDebt = { now: 5000 * M, yearAgo: 3000 * M }))));
    return [r.layer1.fired, r.layer1.areas, r.layer1.state];
  })(),
  [["LEVERAGE", "FUNDING SUBSTITUTION"], ["funding-and-leverage"], "Watch"]
);
check("WEAK LIQUIDITY at a current ratio of exactly 0.8 -> false", flag(withX((x) => ((x.currentRatio = 0.8), (x.ocf12m = { now: -1, yearAgo: 5 }))), "WEAK LIQUIDITY"), false);
check(
  "OPERATING DETERIORATION at exactly −15% and −3 points -> true",
  flag(withX((x) => ((x.revenueYoYPct = [-15, 0]), (x.operatingMarginChangePts = -3))), "OPERATING DETERIORATION"),
  true
);
check("R&D at exactly +5% / +5% -> EXPANDING", runVerdict(withX((x) => (x.rdYoYPct = [5, 5]))).coreThread.condition.direction, "EXPANDING");
check("R&D at exactly −5% / −5% -> CAUTION", runVerdict(withX((x) => (x.rdYoYPct = [-5, -5]))).coreThread.condition.direction, "CAUTION");
check("R&D +4.9% / +10% -> FLAT", runVerdict(withX((x) => (x.rdYoYPct = [4.9, 10]))).coreThread.condition.direction, "FLAT");
check(
  "R&D unknown and a 2.05 -> CAUTION, R&D noted unknown, CoreThread evidence Limited",
  (() => {
    const r = runVerdict(withX((x) => ((x.rdStatus = "not filed"), (x.rdYoYPct = [null, null]), (x.restructuringFilings = [{ filingDate: "2026-01-29", accessionNumber: null }]))));
    return [r.coreThread.condition.direction, r.coreThread.condition.rdUnknown, r.coreThread.evidence.level, r.nexCore.evidence.level];
  })(),
  ["CAUTION", true, "Limited", "Adequate"]
);
check(
  "a restructuring filing older than 12 months does not count",
  runVerdict(withX((x) => (x.restructuringFilings = [{ filingDate: "2025-10-24", accessionNumber: null }]))).coreThread.condition.direction,
  "EXPANDING"
);
check(
  "a restructuring filing on the window's first day counts",
  runVerdict(withX((x) => (x.restructuringFilings = [{ filingDate: "2025-10-25", accessionNumber: null }]))).coreThread.condition.direction,
  "CAUTION"
);
check(
  "a filing after the assessment date is not used",
  runVerdict(withX((x) => (x.criticalFilings = [{ item: "1.03", filingDate: "2026-10-26", accessionNumber: null }]))).layer1.state,
  "Resilient"
);
check(
  "an 8-K 4.02 -> Critical, labelled a reporting-reliability problem, evidence Exception",
  (() => {
    const r = runVerdict(withX((x) => (x.criticalFilings = [{ item: "4.02", filingDate: "2026-06-01", accessionNumber: null }])));
    return [r.layer1.state, r.layer1.criticalReasons[0].includes("reporting-reliability problem, not necessarily insolvency"), r.coreThread.evidence.level, r.coreThread.verdict, r.nexCore.verdict];
  })(),
  ["Critical", true, "Exception", "Limit exposure", "Limit exposure"]
);
check(
  "an 8-K 2.04 -> Critical, evidence not Exception",
  (() => {
    const r = runVerdict(withX((x) => (x.criticalFilings = [{ item: "2.04", filingDate: "2026-06-01", accessionNumber: null }])));
    return [r.layer1.state, r.coreThread.evidence.level];
  })(),
  ["Critical", "Adequate"]
);
check(
  "NexCore caution: OPERATING DETERIORATION with a cash flag",
  (() => {
    const r = runVerdict(
      withX((x) => ((x.revenueYoYPct = [-20, -10]), (x.operatingMarginChangePts = -5), (x.fcf12m = { now: -1, yearAgo: -1 }), (x.ocf12m = { now: 100 * M, yearAgo: 200 * M })))
    );
    return [r.nexCore.condition.sellerCaution, r.nexCore.condition.label];
  })(),
  [true, "cutting back across the business"]
);

console.log("\n=== Evidence order (rules 8) ===");
check(
  "Exception before Limited: stale with a not-measurable flag",
  runVerdict(withX((x) => ((x.stale = { stale: true, assessedPeriodLabel: null, newerFiling: null }), (x.currentRatio = null), (x.ocf12m = { now: -1, yearAgo: 1 })))).nexCore.evidence.level,
  "Exception"
);
check("finance-arm debt not separable -> Limited", runVerdict(withX((x) => (x.dataQuality.financeArmDebtNotSeparable = true))).nexCore.evidence.reasons, ["finance-arm debt not separable"]);
check("restricted cash not separated -> Limited", runVerdict(withX((x) => (x.dataQuality.restrictedCashNotSeparated = true))).coreThread.evidence.reasons, ["restricted cash not separated"]);

console.log("\n=== Explanations read the computed values and rulesConfig ===");
{
  const r = runVerdict(frozenToInputs(records.find((r) => r.set === "today" && r.ticker === "BA")!));
  const funding = r.explanations.areas.find((a) => a.area === "funding-and-leverage")!;
  const levInputs = funding.flags.find((f) => f.flag === "LEVERAGE")!.inputs;
  check("BA LEVERAGE multiple in the explanation is the one the verdict used", levInputs.find((i) => i.name.startsWith("Net debt ÷"))!.value, r.layer1.values.leverageMultiple);
  check("BA LEVERAGE multiple 7.11×", Number((r.layer1.values.leverageMultiple as number).toFixed(2)), 7.11);
  check("the formula names the configured multiple", funding.flags.find((f) => f.flag === "LEVERAGE")!.formula.includes(`> ${RULES.borrowing.leverageMultiple}×`), true);
  check("Funding and leverage card: Warning", [funding.title, funding.level], ["Funding and leverage", "Warning"]);
  check("Cash card scale adds Severe; Filing status adds Critical", [r.explanations.areas[0].scale, r.explanations.areas[4].scale], [["Clear", "Warning", "Severe"], ["Clear", "Warning", "Critical"]]);
  check("other ratios end as the rules require", r.explanations.otherRatios.map((o) => o.note), [
    "Not used in the verdict.",
    "Not used in the verdict.",
    "Not used in the verdict.",
    "Not used in the verdict.",
    "Used only in the near-term liquidity check, when 12-month operating cash flow is negative.",
  ]);
  check("Resilient subtitle", runVerdict(base()).layer1.subtitle, "Same for both entities · No warning thresholds triggered");
  check("Watch subtitle names the area", r.layer1.subtitle, "Same for both entities · Funding and leverage");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (mismatches.length) console.log(`Fixture mismatches:\n  ${mismatches.join("\n  ")}`);
process.exit(fail === 0 ? 0 : 1);
