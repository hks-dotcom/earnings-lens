// Tests for the Build B engine additions (lib/verdict/), no network:
//
// 1. Likely route (rules section 9): every SIC range, and nothing shown when
//    no range maps.
// 2. Display states: Filing status Critical (1.03, 2.04, 4.02 with the 4.02
//    wording) and "Not fully measurable" with the tests that could not run
//    and why (VZ's cash area and FDX's filing area in the frozen fixtures).
// 3. Neither addition changes any engine outcome on the 90 frozen records.
//
// Usage: npx tsx scripts/test-verdict-display.ts

import * as fs from "fs";
import * as path from "path";
import { runVerdict } from "@/lib/verdict/engine";
import { potentialApplication, ROUTES } from "@/lib/verdict/potentialApplication";
import { areaDisplays, NOT_FULLY_MEASURABLE } from "@/lib/verdict/display";
import type { CriticalItem, VerdictInputs } from "@/lib/verdict/types";
import { FixtureRecord, frozenToInputs } from "./lib/verdictS5Fixtures";

let pass = 0;
let fail = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}  (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  if (ok) pass++;
  else fail++;
}

const FIX = path.join(process.cwd(), "tests/fixtures/verdict-s5");
const records: FixtureRecord[] = ["today.json", "distress.json", "yearback.json"].flatMap((f) => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8")));
const today = (t: string) => records.find((r) => r.set === "today" && r.ticker === t)!;

console.log("=== Likely route (rules 9) ===");
check("route bar order", ROUTES, ["Partner", "Device builder", "Site operator"]);
for (const [sic, line, route] of [
  [3670, "Chip/platform integration", "Partner"],
  [3674, "Chip/platform integration", "Partner"],
  [3679, "Chip/platform integration", "Partner"],
  [3400, "Devices and equipment", "Device builder"],
  [3577, "Devices and equipment", "Device builder"],
  [3669, "Devices and equipment", "Device builder"],
  [3680, "Devices and equipment", "Device builder"],
  [3999, "Devices and equipment", "Device builder"],
  [4000, "Retail and logistics operations", "Site operator"],
  [4513, "Retail and logistics operations", "Site operator"],
  [4799, "Retail and logistics operations", "Site operator"],
  [5200, "Retail and logistics operations", "Site operator"],
  [5961, "Retail and logistics operations", "Site operator"],
  [5999, "Retail and logistics operations", "Site operator"],
  [4800, "Network and energy infrastructure", "Site operator"],
  [4813, "Network and energy infrastructure", "Site operator"],
  [4999, "Network and energy infrastructure", "Site operator"],
  [100, "Agriculture operations", "Site operator"],
  [999, "Agriculture operations", "Site operator"],
] as const) {
  const p = potentialApplication(sic);
  check(`SIC ${String(sic).padStart(4, "0")} -> ${line} · ${route}`, [p.shown, p.line, p.route], [true, line, route]);
}
for (const sic of [99, 1000, 3399, 5000, 5199, 6000, 7372, null]) {
  const p = potentialApplication(sic);
  check(`SIC ${sic} -> nothing shown (no line, no route)`, [p.shown, p.line, p.route, p.display, p.source], [false, null, null, null, null]);
}
check("frozen NVDA reads Partner", runVerdict(frozenToInputs(today("NVDA"))).potentialApplication.route, "Partner");
check("frozen AMZN reads Site operator", runVerdict(frozenToInputs(today("AMZN"))).potentialApplication.route, "Site operator");
check("frozen MSFT shows nothing", runVerdict(frozenToInputs(today("MSFT"))).potentialApplication.shown, false);

console.log("\n=== Filing status Critical ===");
function withCritical(item: CriticalItem, filingDate: string): VerdictInputs {
  const x = frozenToInputs(today("AMZN"));
  x.criticalFilings = [{ item, filingDate, accessionNumber: null }];
  return x;
}
const filingArea = (x: VerdictInputs) => areaDisplays(runVerdict(x)).find((a) => a.area === "filing-status")!;
{
  const a = filingArea(frozenToInputs(today("AMZN")));
  check("AMZN today: filing status Clear, no Critical filing", [a.level, a.critical, a.notFullyMeasurable], ["Clear", [], false]);
}
for (const item of ["1.03", "2.04", "4.02"] as CriticalItem[]) {
  const a = filingArea(withCritical(item, "2026-06-01"));
  check(`8-K ${item} in the window -> filing status Critical`, a.level, "Critical");
}
{
  const a = filingArea(withCritical("4.02", "2026-06-01"));
  check("4.02 carries the reporting-reliability wording", a.critical, [
    "Non-reliance on previously issued financial statements: a reporting-reliability problem, not necessarily insolvency (8-K Item 4.02, filed 2026-06-01)",
  ]);
  const r = runVerdict(withCritical("4.02", "2026-06-01"));
  check("4.02: state Critical, both Limit exposure, evidence Exception", [r.layer1.state, r.coreThread.verdict, r.nexCore.verdict, r.nexCore.evidence.level], [
    "Critical",
    "Limit exposure",
    "Limit exposure",
    "Exception",
  ]);
  check("1.03 label", filingArea(withCritical("1.03", "2026-06-01")).critical, ["Bankruptcy or receivership (8-K Item 1.03, filed 2026-06-01)"]);
  check("2.04 label", filingArea(withCritical("2.04", "2026-06-01")).critical, ["Triggering event that accelerates an obligation (8-K Item 2.04, filed 2026-06-01)"]);
  const old = filingArea(withCritical("4.02", "2025-10-01"));
  check("a 4.02 outside the 12-month window is not Critical", [old.level, old.critical], ["Clear", []]);
}
{
  const r = runVerdict(frozenToInputs(records.find((x) => x.set === "distress" && x.ticker === "ECHO")!));
  const a = areaDisplays(r).find((d) => d.area === "filing-status")!;
  check("ECHO (distress fixture): state Critical and the filing card reads Critical", [r.layer1.state, a.level], ["Critical", "Critical"]);
}

console.log("\n=== Not fully measurable ===");
check("tag wording", NOT_FULLY_MEASURABLE, "Not fully measurable");
{
  const d = areaDisplays(runVerdict(frozenToInputs(today("VZ"))));
  const cash = d.find((a) => a.area === "cash-generation")!;
  check("VZ cash area: not fully measurable, no step selected", [cash.level, cash.notFullyMeasurable], [null, true]);
  check("VZ cash area: the test that could not run and why", cash.notMeasured, [
    { flag: "INVESTMENT CASH PRESSURE", missing: ["12-month free cash flow", "12-month free cash flow a year ago"], reason: null },
  ]);
  const lev = d.find((a) => a.area === "funding-and-leverage")!;
  check("VZ funding area fired (Warning), so not tagged", [lev.level, lev.notFullyMeasurable], ["Warning", false]);
  check("VZ: only the cash area is tagged", d.filter((a) => a.notFullyMeasurable).map((a) => a.area), ["cash-generation"]);
}
{
  const r = runVerdict(frozenToInputs(today("FDX")));
  const f = areaDisplays(r).find((a) => a.area === "filing-status")!;
  check("FDX filing area: not fully measurable, no dot", [f.level, f.notFullyMeasurable], [null, true]);
  check("FDX filing area: MISSED FILING with the calendar's reason", [f.notMeasured.map((t) => t.flag), f.notMeasured[0].reason], [["MISSED FILING"], r.filingStatus.reason]);
  check("FDX reason names the fiscal-year change", /fiscal-year change/.test(f.notMeasured[0].reason ?? ""), true);
}
{
  const d = areaDisplays(runVerdict(frozenToInputs(today("AMZN"))));
  check("AMZN today: every area Clear and fully measurable", d.map((a) => [a.level, a.notFullyMeasurable]), d.map(() => ["Clear", false]));
}
{
  // An area with a fired flag is never tagged, even with another flag not measurable (BA year back: cash fired, n/m SEVERE and CAUTION BURN).
  const ba = records.find((x) => x.set === "year-back" && x.ticker === "BA")!;
  const cash = areaDisplays(runVerdict(frozenToInputs(ba))).find((a) => a.area === "cash-generation")!;
  check("BA year back: cash area fired, not tagged, n/m tests still listed", [cash.level, cash.notFullyMeasurable, cash.notMeasured.map((t) => t.flag)], [
    "Warning",
    false,
    ["SEVERE BURN", "CAUTION BURN"],
  ]);
}
{
  // Across all 90: tagged exactly when no flag fired in the area and one is not measurable.
  let ok = 0;
  for (const rec of records) {
    const r = runVerdict(frozenToInputs(rec));
    const good = areaDisplays(r).every((a) => {
      const flags = r.explanations.areas.find((e) => e.area === a.area)!.flags;
      const want = !flags.some((f) => f.value === true) && flags.some((f) => f.value === null);
      return a.notFullyMeasurable === want;
    });
    if (good) ok++;
  }
  check("tag rule holds on all 90 frozen records", ok, records.length);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
