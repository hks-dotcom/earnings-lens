// Tests for the Why bullets (rules 17.4) and the Financial health summary
// bullets (rules 17.5), lib/verdict/why.ts. No network.
//
// Every warning phrase, every CoreThread direction (each UNKNOWN reason
// included), NexCore caution / no caution / not measurable, every verdict
// line for both sellers, Amazon's exact bullets, and the health summary
// order (Critical filing, then warnings, then the computed facts) with a
// missing fact dropped. Cases come from the frozen fixtures where one
// exists, otherwise from a frozen record with one input changed.
//
// Usage: npx tsx scripts/test-verdict-why.ts

import * as fs from "fs";
import * as path from "path";
import { runVerdict } from "@/lib/verdict/engine";
import { coreThreadBullet, healthBullet, healthSummaryBullets, nexCoreBullet, warningPhrase, WHAT_IT_MEANS, whyBullets } from "@/lib/verdict/why";
import type { FlagName, VerdictInputs, VerdictResult } from "@/lib/verdict/types";
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
const SET: Record<string, string> = { t: "today", d: "distress", y: "year-back" };
/** "t:AMZN" -> the frozen record's inputs. */
const inputs = (key: string): VerdictInputs => {
  const [s, t] = key.split(":");
  const rec = records.find((r) => r.set === SET[s] && r.ticker.startsWith(t));
  if (!rec) throw new Error(`no fixture ${key}`);
  return frozenToInputs(rec);
};
const run = (key: string, edit?: (x: VerdictInputs) => void): VerdictResult => {
  const x = inputs(key);
  edit?.(x);
  return runVerdict(x);
};
const phrase = (f: FlagName, r: VerdictResult) => [r.layer1.fired.includes(f), warningPhrase(f, r)];

console.log("=== Amazon (frozen AMZN, rules 17.4 / 17.5) ===");
{
  const r = run("t:AMZN");
  check("AMZN CoreThread, three bullets", whyBullets(r, "CoreThread"), [
    "Financial health Resilient: no warning thresholds triggered · capital spending above operating cash flow",
    "R&D not separately disclosed",
    "Supports engineering work on standard terms",
  ]);
  check("AMZN NexCore, three bullets", whyBullets(r, "NexCore"), [
    "Financial health Resilient: no warning thresholds triggered · capital spending above operating cash flow",
    "Cutting-back warning not triggered: sales +19.6% year over year, operating margin +2.3 points",
    "Supports subscription and usage commitments on standard terms",
  ]);
  check("AMZN health summary", healthSummaryBullets(r), [
    "Operating cash flow $161.4B over the last 12 months (+33.2% on the prior 12)",
    "Free cash flow −$11.6B over the last 12 months (Earnings Lens basis)",
    "Net debt $9.6B (net cash $37.3B a year ago)",
  ]);
}

console.log("\n=== Bullet 1: health ===");
check("Resilient, free cash flow positive", healthBullet(run("t:MSFT")), "Financial health Resilient: no warning thresholds triggered");
check("SEVERE BURN (BTAIQ)", phrase("SEVERE BURN", run("d:BTAIQ")), [true, "operating cash flow negative for two 12-month periods, under 12 months of cash"]);
{
  // BTAIQ with a 4-quarter runway: 12 months, CAUTION BURN instead of SEVERE.
  const r = run("d:BTAIQ", (x) => (x.runwayQuarters = 4));
  check("CAUTION BURN (BTAIQ, runway 12 months)", phrase("CAUTION BURN", r), [true, "operating cash flow negative for two 12-month periods, 12–24 months of cash"]);
}
check("PERSISTENT BURN, RUNWAY UNKNOWN (GNLN)", phrase("PERSISTENT BURN, RUNWAY UNKNOWN", run("d:GNLN")), [true, "operating cash flow negative for two 12-month periods; runway cannot be measured"]);
check("INVESTMENT CASH PRESSURE, net debt rose (LESLQ)", phrase("INVESTMENT CASH PRESSURE", run("d:LESLQ")), [true, "free cash flow negative for two 12-month periods while net debt rose"]);
check("INVESTMENT CASH PRESSURE, operating cash flow fell (SGMOQ)", phrase("INVESTMENT CASH PRESSURE", run("d:SGMOQ")), [true, "free cash flow negative for two 12-month periods while operating cash flow fell"]);
check("INVESTMENT CASH PRESSURE, both legs, net cash on both dates (RIVN): net cash fell", phrase("INVESTMENT CASH PRESSURE", run("t:RIVN")), [true, "free cash flow negative for two 12-month periods while operating cash flow fell and net cash fell"]);
check("INVESTMENT CASH PRESSURE, net debt on both dates (ECHO): net debt rose", phrase("INVESTMENT CASH PRESSURE", run("d:ECHO")), [true, "free cash flow negative for two 12-month periods while operating cash flow fell and net debt rose"]);
check(
  "INVESTMENT CASH PRESSURE, crossing zero: moved from net cash to net debt",
  phrase("INVESTMENT CASH PRESSURE", run("d:LESLQ", (x) => (x.netDebt = { now: 50_000_000, yearAgo: -20_000_000 }))),
  [true, "free cash flow negative for two 12-month periods while it moved from net cash $20.0M to net debt $50.0M"]
);
check("WEAK LIQUIDITY (BTAIQ)", phrase("WEAK LIQUIDITY", run("d:BTAIQ")), [true, "current ratio 0.2x with negative operating cash flow"]);
check("OPERATING DETERIORATION (SNBRQ)", phrase("OPERATING DETERIORATION", run("d:SNBRQ")), [true, "sales −18.9% and operating margin −12.1 points on a year ago"]);
check("LEVERAGE (BA today, 7.11×)", phrase("LEVERAGE", run("t:BA")), [true, "net debt 7.11× operating cash flow, above 4×"]);
check("LOW-CASH DEBT (LESLQ)", phrase("LOW-CASH DEBT", run("d:LESLQ")), [true, "operating cash flow 0.9% of sales with net debt at 62.5% of sales"]);
check("FUNDING SUBSTITUTION, crossing zero (NAII: net cash $1.5M to net debt $11.3M)", phrase("FUNDING SUBSTITUTION", run("t:NAII")), [true, "moved from net cash $1.5M to net debt $11.3M while operating cash flow fell"]);
check("FUNDING SUBSTITUTION, net debt on both dates (XRX year back)", phrase("FUNDING SUBSTITUTION", run("y:XRX")), [true, "net debt up $675.0M while operating cash flow fell"]);
check("FUNDING SUBSTITUTION, net cash on both dates (RIVN): net cash down", phrase("FUNDING SUBSTITUTION", run("t:RIVN")), [true, "net cash down $2.2B while operating cash flow fell"]);
check("MISSED FILING (TWINLAB)", phrase("MISSED FILING", run("d:TWINLAB")), [true, "10-K for Dec 31, 2024 overdue since Mar 31, 2025"]);
check("Watch: one area (BA today)", healthBullet(run("t:BA")), "Financial health Watch: net debt 7.11× operating cash flow, above 4×");
check("Watch: two warnings in one area, joined (XRX year back)", healthBullet(run("y:XRX")), "Financial health Watch: net debt 9.52× operating cash flow, above 4× · net debt up $675.0M while operating cash flow fell");
check("Fragile: warnings in rules order (LESLQ)", healthBullet(run("d:LESLQ")), "Financial health Fragile: free cash flow negative for two 12-month periods while net debt rose · operating cash flow 0.9% of sales with net debt at 62.5% of sales");
{
  const crit = (item: "1.03" | "2.04" | "4.02") => run("t:AMZN", (x) => (x.criticalFilings = [{ item, filingDate: "2026-06-01", accessionNumber: null }]));
  check("Critical 1.03", healthBullet(crit("1.03")), "Critical filing: 8-K 1.03 on Jun 1, 2026 (bankruptcy)");
  check("Critical 2.04", healthBullet(crit("2.04")), "Critical filing: 8-K 2.04 on Jun 1, 2026 (debt acceleration)");
  check("Critical 4.02", healthBullet(crit("4.02")), "Critical filing: 8-K 4.02 on Jun 1, 2026 (reporting reliability, not necessarily insolvency)");
}
check("Critical with several filings (ECHO), one per filing", healthBullet(run("d:ECHO")), [
  "Critical filing: 8-K 2.04 on Jun 27, 2025 (debt acceleration)",
  "Critical filing: 8-K 2.04 on Jun 2, 2025 (debt acceleration)",
  "Critical filing: 8-K 2.04 on May 30, 2025 (debt acceleration)",
].join(" · "));

console.log("\n=== Bullet 2: CoreThread ===");
check("Expanding (NVDA)", coreThreadBullet(run("t:NVDA")), "Engineering spend expanding: R&D +64.4% and +58.5% on a year ago");
check("Caution, R&D (INTC)", coreThreadBullet(run("t:INTC")), "Engineering spend under pressure: R&D −8.6% / −7.3%");
check("Caution, restructuring (FDX)", coreThreadBullet(run("t:FDX")), "Engineering spend under pressure: restructuring filing Jan 29, 2026");
check("Caution, two restructuring filings (NKE)", coreThreadBullet(run("t:NKE")), "Engineering spend under pressure: restructuring filing Oct 1, 2026 · restructuring filing Mar 5, 2026");
check("Caution, sales and margin (GNLN)", coreThreadBullet(run("d:GNLN")), "Engineering spend under pressure: sales and operating margin falling together");
check("Caution, R&D and sales and margin (SNBRQ)", coreThreadBullet(run("d:SNBRQ")), "Engineering spend under pressure: R&D −50.9% / −40.9% · sales and operating margin falling together");
check("Mixed (SNAP)", coreThreadBullet(run("t:SNAP")), "Mixed signals: R&D up 22.3% / 12.8%, but restructuring filing Apr 15, 2026");
check("Flat (ORCL)", coreThreadBullet(run("t:ORCL")), "Engineering spend steady: R&D −3.6% / −1.5% on a year ago");
check("Unknown, not filed (WMT)", coreThreadBullet(run("t:WMT")), "R&D not separately disclosed");
check("Unknown, annual only (UFPT)", coreThreadBullet(run("t:UFPT")), "R&D reported annually only; quarterly trend cannot be determined");
check("Unknown, not in the window (GM)", coreThreadBullet(run("t:GM")), "No R&D reported in the last 12 quarters");
{
  const r = run("t:ORCL", (x) => (x.rdYoYPct = [6, null]));
  check("Unknown, quarterly but not measurable (ORCL with R&D +6.0% / missing)", [r.coreThread.condition.direction, r.coreThread.condition.rdUnknownReason, coreThreadBullet(r)], [
    "UNKNOWN",
    "not measurable",
    "Quarterly R&D trend cannot be determined from the available filings",
  ]);
  const f = run("t:ORCL", (x) => (x.rdYoYPct = [-3.6, null]));
  check("Flat with one quarter missing: the missing number is not filled in", [f.coreThread.condition.direction, coreThreadBullet(f)], ["FLAT", "Engineering spend steady: R&D −3.6% on a year ago"]);
}

console.log("\n=== Bullet 2: NexCore ===");
check("Caution with a cash warning (SNBRQ)", nexCoreBullet(run("d:SNBRQ")), "Cutting-back warning triggered: sales −18.9%, operating margin −12.1 points on a year ago, plus cash-generation warning");
{
  const r = run("d:SNBRQ", (x) => (x.restructuringFilings = [{ filingDate: "2026-04-01", accessionNumber: null }]));
  check("Caution with a restructuring filing and a cash warning", nexCoreBullet(r), "Cutting-back warning triggered: sales −18.9%, operating margin −12.1 points on a year ago, plus restructuring filing Apr 1, 2026 · cash-generation warning");
}
check("No caution, all inputs measurable (AMZN)", nexCoreBullet(run("t:AMZN")), "Cutting-back warning not triggered: sales +19.6% year over year, operating margin +2.3 points");
check("No caution, margin change missing (NKE): the missing number is not filled in", nexCoreBullet(run("t:NKE")), "Cutting-back warning not triggered: sales −4.3% year over year");
{
  const r = run("d:GNLN", (x) => (x.operatingMarginChangePts = null));
  check("Not measurable (GNLN with margin change missing)", [r.nexCore.condition.caution, nexCoreBullet(r)], [null, "Cutting-back warning not fully measurable: operating margin change vs the same quarter a year ago"]);
}

console.log("\n=== Bullet 3: every verdict line ===");
check("CoreThread lines", WHAT_IT_MEANS.CoreThread, {
  Pursue: "Supports engineering work on standard terms",
  "Pursue with guardrails": "Smaller funded milestones and capped unbilled work, per Terms",
  Monitor: "Short funded discovery or a small prepaid milestone only",
  "Limit exposure": "No new unsecured work; funds or security before delivery",
});
check("NexCore lines", WHAT_IT_MEANS.NexCore, {
  Pursue: "Supports subscription and usage commitments on standard terms",
  "Pursue with guardrails": "Cash before material activation; usage alerts or prepaid credits, per Terms",
  Monitor: "Small funded pilot only, collected before activation",
  "Limit exposure": "No material service before collection or security",
});
{
  const cases: [string, VerdictResult][] = [
    ["Pursue (AMZN)", run("t:AMZN")],
    ["Pursue with guardrails (BA today)", run("t:BA")],
    ["Fragile (RIVN)", run("t:RIVN")],
    ["Critical (ECHO)", run("d:ECHO")],
    ["Watch + CoreThread caution (FDX with net debt above 4×)", run("t:FDX", (x) => (x.netDebt = { now: 50_000_000_000, yearAgo: 15_077_000_000 }))],
  ];
  const seen = new Set<string>();
  for (const [name, r] of cases) {
    for (const seller of ["CoreThread", "NexCore"] as const) {
      const verdict = seller === "CoreThread" ? r.coreThread.verdict : r.nexCore.verdict;
      seen.add(`${seller} ${verdict}`);
      check(`${name}: ${seller} ${verdict} line`, whyBullets(r, seller)[2], WHAT_IT_MEANS[seller][verdict]);
    }
  }
  check("all eight verdict lines reached", [...seen].sort(), [
    "CoreThread Limit exposure",
    "CoreThread Monitor",
    "CoreThread Pursue",
    "CoreThread Pursue with guardrails",
    "NexCore Limit exposure",
    "NexCore Monitor",
    "NexCore Pursue",
    "NexCore Pursue with guardrails",
  ]);
}
{
  let three = 0;
  for (const rec of records) {
    const r = runVerdict(frozenToInputs(rec));
    if (whyBullets(r, "CoreThread").length === 3 && whyBullets(r, "NexCore").length === 3 && whyBullets(r, "CoreThread")[0] === whyBullets(r, "NexCore")[0]) three++;
  }
  check("every frozen record: exactly three bullets per seller, bullet 1 shared", three, records.length);
}

console.log("\n=== Health summary (rules 17.5) ===");
{
  // Critical with no Layer 1 warning: AMZN plus a 4.02 in the window.
  const r = run("t:AMZN", (x) => (x.criticalFilings = [{ item: "4.02", filingDate: "2026-06-01", accessionNumber: null }]));
  check("Critical, no warning: the Critical filing first, then the computed facts", [r.layer1.fired, healthSummaryBullets(r)], [
    [],
    [
      "Critical filing: 8-K 4.02 on Jun 1, 2026 (reporting reliability, not necessarily insolvency)",
      "Operating cash flow $161.4B over the last 12 months (+33.2% on the prior 12)",
      "Free cash flow −$11.6B over the last 12 months (Earnings Lens basis)",
      "Net debt $9.6B (net cash $37.3B a year ago)",
    ],
  ]);
}
check("Critical with warnings (ECHO): filings, then warnings, then facts", healthSummaryBullets(run("d:ECHO")), [
  "Critical filing: 8-K 2.04 on Jun 27, 2025 (debt acceleration)",
  "Critical filing: 8-K 2.04 on Jun 2, 2025 (debt acceleration)",
  "Critical filing: 8-K 2.04 on May 30, 2025 (debt acceleration)",
  "Free cash flow negative for two 12-month periods while operating cash flow fell and net debt rose",
  "Current ratio 0.3x with negative operating cash flow",
  "Net debt up $1.5B while operating cash flow fell",
  "Operating cash flow −0.5% of sales with net debt at 153.6% of sales",
  "Operating cash flow −$67.8M over the last 12 months (from $1.0B the prior 12)",
  "Free cash flow −$908.6M over the last 12 months (Earnings Lens basis)",
  "Net debt $22.7B (net debt $21.3B a year ago)",
]);
check("Warnings before facts (BA today)", healthSummaryBullets(run("t:BA")), [
  "Net debt 7.11× operating cash flow, above 4×",
  "Operating cash flow $3.6B over the last 12 months (from −$6.2B the prior 12)",
  "Free cash flow −$210.0M over the last 12 months (Earnings Lens basis)",
  "Net debt $25.9B (net debt $30.4B a year ago)",
]);
check("Missing free cash flow drops that bullet (VZ)", healthSummaryBullets(run("t:VZ")), [
  "Net debt 4.21× operating cash flow, above 4×",
  "Operating cash flow $38.8B over the last 12 months (+4.6% on the prior 12)",
  "Net debt $163.5B (net debt $142.6B a year ago)",
]);
check("Net cash on both dates (RIVN)", healthSummaryBullets(run("t:RIVN")).at(-1), "Net cash $866.0M (net cash $3.1B a year ago)");
check("Missing year-ago net debt drops the net debt bullet", healthSummaryBullets(run("t:AMZN", (x) => (x.netDebt = { now: 9_561_000_000, yearAgo: null }))), [
  "Operating cash flow $161.4B over the last 12 months (+33.2% on the prior 12)",
  "Free cash flow −$11.6B over the last 12 months (Earnings Lens basis)",
]);
check("Missing prior operating cash flow drops the operating cash flow bullet", healthSummaryBullets(run("t:AMZN", (x) => (x.ocf12m = { now: 161_403_000_000, yearAgo: null }))), [
  "Free cash flow −$11.6B over the last 12 months (Earnings Lens basis)",
  "Net debt $9.6B (net cash $37.3B a year ago)",
]);
check("$M below $1B (SNAP)", healthSummaryBullets(run("t:SNAP")), [
  "Operating cash flow $919.1M over the last 12 months (+56.7% on the prior 12)",
  "Free cash flow $705.5M over the last 12 months (Earnings Lens basis)",
  "Net debt $874.8M (net debt $682.9M a year ago)",
]);

console.log("\n=== Rules 17.6: operating cash flow change in dollars ===");
{
  const ocfLine = (now: number, yearAgo: number) =>
    healthSummaryBullets(run("t:AMZN", (x) => (x.ocf12m = { now, yearAgo }))).find((b) => b.startsWith("Operating cash flow"));
  check("opposite signs, prior positive (RIVN)", healthSummaryBullets(run("t:RIVN")).find((b) => b.startsWith("Operating cash flow")), "Operating cash flow −$1.8B over the last 12 months (from $183.0M the prior 12)");
  check("opposite signs, prior negative (BA today)", ocfLine(3_600_000_000, -6_200_000_000), "Operating cash flow $3.6B over the last 12 months (from −$6.2B the prior 12)");
  check("both negative: prior negative, dollars (BTAIQ)", healthSummaryBullets(run("d:BTAIQ")).find((b) => b.startsWith("Operating cash flow") && b.includes("prior 12"))?.includes("from −$"), true);
  check("prior zero: dollars", ocfLine(100_000_000, 0), "Operating cash flow $100.0M over the last 12 months (from $0 the prior 12)");
  check("both positive: a percentage (AMZN)", ocfLine(161_403_000_000, 121_137_000_000), "Operating cash flow $161.4B over the last 12 months (+33.2% on the prior 12)");
}

console.log("\n=== Rules 17.6: net debt and net cash from both balances ===");
{
  const fact = (now: number, yearAgo: number) => healthSummaryBullets(run("t:AMZN", (x) => (x.netDebt = { now, yearAgo }))).at(-1);
  check("both net debt", fact(25_900_000_000, 30_400_000_000), "Net debt $25.9B (net debt $30.4B a year ago)");
  check("both net cash", fact(-866_000_000, -3_100_000_000), "Net cash $866.0M (net cash $3.1B a year ago)");
  check("crossing: net cash to net debt (AMZN)", fact(9_561_000_000, -37_284_000_000), "Net debt $9.6B (net cash $37.3B a year ago)");
  check("crossing: net debt to net cash", fact(-1_000_000_000, 2_000_000_000), "Net cash $1.0B (net debt $2.0B a year ago)");
  check("a zero balance is neither", fact(0, 5_000_000), "Net debt of zero (net debt $5.0M a year ago)");
  const fs = (now: number, yearAgo: number) => warningPhrase("FUNDING SUBSTITUTION", run("t:NAII", (x) => (x.netDebt = { now, yearAgo })));
  check("movement: both net debt, up", fs(30_000_000, 10_000_000), "net debt up $20.0M while operating cash flow fell");
  check("movement: both net cash, down", fs(-10_000_000, -30_000_000), "net cash down $20.0M while operating cash flow fell");
  check("movement: crossing from net cash to net debt", fs(11_300_000, -1_500_000), "moved from net cash $1.5M to net debt $11.3M while operating cash flow fell");
  check("movement: from zero to net debt", fs(12_000_000, 0), "moved from net debt of zero to net debt $12.0M while operating cash flow fell");
  check("movement: from net cash to zero", fs(0, -12_000_000), "moved from net cash $12.0M to net debt of zero while operating cash flow fell");
  // Never a movement that contradicts the balances: a net-cash company never reads "net debt up".
  let contradictions = 0;
  for (const rec of records) {
    const r = runVerdict(frozenToInputs(rec));
    const { now, yearAgo } = r.inputs.netDebt;
    const text = [...whyBullets(r, "CoreThread"), ...healthSummaryBullets(r)].join(" | ");
    if (now !== null && yearAgo !== null && now < 0 && yearAgo < 0 && /net debt (up|down|rose)/.test(text)) contradictions++;
    if (now !== null && yearAgo !== null && now > 0 && yearAgo > 0 && /net cash (up|down|fell)/.test(text)) contradictions++;
  }
  check("no movement contradicts the balances on all 90 frozen records", contradictions, 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
