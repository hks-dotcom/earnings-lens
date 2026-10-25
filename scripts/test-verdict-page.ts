// Page-model tests for the S5 verdict (lib/present/verdictPage.ts), no network.
//
// For each of the 90 frozen fixture inputs (tests/fixtures/verdict-s5/):
// the page model's health state, both verdicts, both evidence levels and
// reasons, the terms line, the protections and the NexCore condition equal
// the engine's result exactly; the state, verdicts and evidence also equal
// the fixture's expected block; every protections row equals the cell in
// rules 7.2 for that seller and verdict, read from the rules document
// itself (Earnings_Lens_Verdict_Rules_S5.md), and the terms line and the
// 7.3 condition equal rules 7.1 and 7.3.
//
// Usage: npx tsx scripts/test-verdict-page.ts

import * as fs from "fs";
import * as path from "path";
import { runVerdict } from "@/lib/verdict/engine";
import { areaDisplays } from "@/lib/verdict/display";
import { verdictPage, VERDICT_STEPS } from "@/lib/present/verdictPage";
import { healthSummaryBullets, whyBullets } from "@/lib/verdict/why";
import { FLAG_ORDER } from "@/lib/verdict/layer1";
import { segmentSplit } from "@/lib/present/segmentSplit";
import { shownFindings } from "@/lib/present/standOutRows";
import type { StandOutItem } from "@/lib/present/standOut";
import type { SegmentRevenue } from "@/lib/xbrl/segments";
import type { Seller, Verdict, VerdictResult } from "@/lib/verdict/types";
import { FixtureRecord, frozenToInputs } from "./lib/verdictS5Fixtures";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, actual: unknown, expected: unknown, quiet = false) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!quiet || !ok) console.log(`[${ok ? "PASS" : "FAIL"}] ${name}  (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  if (ok) pass++;
  else {
    fail++;
    failures.push(name);
  }
  return ok;
}

// ------------------------------------------------------------------ rules 7.1–7.3 from the rules document
const RULES_DOC = fs.readFileSync(path.join(process.cwd(), "Earnings_Lens_Verdict_Rules_S5.md"), "utf8");

function section(start: string, end: string): string {
  const i = RULES_DOC.indexOf(start);
  const j = RULES_DOC.indexOf(end, i + start.length);
  if (i < 0 || j < 0) throw new Error(`rules document: section "${start}" not found`);
  return RULES_DOC.slice(i, j);
}

/** The 7.2 table for one seller: verdict -> component -> cell, with "Same" resolved to the row's first cell. */
function protectionsTable(seller: Seller): Record<string, { component: string; text: string }[]> {
  const s72 = section("### 7.2", "### 7.3");
  const block = s72.slice(s72.indexOf(`**${seller}**`)).split(/\n\*\*/)[0];
  const rows = block.split("\n").filter((l) => l.startsWith("|"));
  const head = rows[0].split("|").slice(2, -1).map((c) => c.trim());
  const out: Record<string, { component: string; text: string }[]> = {};
  for (const row of rows.slice(2)) {
    const cells = row.split("|").slice(1, -1).map((c) => c.trim());
    const verdict = cells[0];
    const values = cells.slice(1);
    out[verdict] = head.map((component, k) => ({ component, text: values[k] === "Same" ? values[0] : values[k] }));
  }
  return out;
}
const TABLE: Record<Seller, ReturnType<typeof protectionsTable>> = { CoreThread: protectionsTable("CoreThread"), NexCore: protectionsTable("NexCore") };

const s71 = section("### 7.1", "### 7.2");
const TERMS_PURSUE = s71.match(/Display: "(Net 30 ✓ · Net 45 on request · Net 60 ✕)"/)?.[1];
const TERMS_OTHER = s71.match(/Display: "(Net 30 ✓ · Net 45 ✕ · Net 60 ✕)"/)?.[1];
const s73 = section("### 7.3", "## 8.");
const CONDITION = s73
  .split("\n")
  .find((l) => l.startsWith("NexCore's Monitor"))!
  .replace(/\*\*/g, "")
  .replace(/ The page states this condition on every NexCore Fragile verdict\.$/, "");

console.log("=== Rules document read ===");
check("7.2 CoreThread has all four verdicts", Object.keys(TABLE.CoreThread), VERDICT_STEPS);
check("7.2 NexCore has all four verdicts", Object.keys(TABLE.NexCore), VERDICT_STEPS);
check("7.1 display strings found", [TERMS_PURSUE, TERMS_OTHER], ["Net 30 ✓ · Net 45 on request · Net 60 ✕", "Net 30 ✓ · Net 45 ✕ · Net 60 ✕"]);

// ------------------------------------------------------------------ the 90 records
const FIX = path.join(process.cwd(), "tests/fixtures/verdict-s5");
const records: FixtureRecord[] = ["today.json", "distress.json", "yearback.json"].flatMap((f) => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8")));

/** The fields Gate 2 compares, read off the engine result. */
function engineView(r: VerdictResult) {
  const seller = (s: VerdictResult["coreThread"] | VerdictResult["nexCore"]) => ({
    verdict: s.verdict,
    why: whyBullets(r, s.seller),
    evidence: s.evidence.level,
    evidenceReasons: s.evidence.reasons,
    terms: s.terms.display,
    protections: s.protections.map((p) => ({ component: p.component, lines: p.lines })),
    condition: s.contractCondition,
  });
  return {
    state: r.layer1.state,
    subtitle: r.layer1.subtitle,
    summary: healthSummaryBullets(r),
    coreThread: seller(r.coreThread),
    nexCore: seller(r.nexCore),
    route: r.potentialApplication.route,
    areas: areaDisplays(r).map((a) => [a.area, a.level, a.notFullyMeasurable]),
  };
}

function pageView(r: VerdictResult) {
  const m = verdictPage(r);
  const seller = (s: typeof m.coreThread) => ({
    verdict: s.verdict,
    why: s.why,
    evidence: s.evidence.level,
    evidenceReasons: s.evidence.reasons,
    terms: s.terms,
    protections: s.protections,
    condition: s.condition,
  });
  return {
    state: m.state,
    subtitle: m.subtitle,
    summary: m.summary,
    coreThread: seller(m.coreThread),
    nexCore: seller(m.nexCore),
    route: m.nexCore.discovery?.route ?? null,
    areas: m.areas.map((a) => [a.area, a.level, a.notFullyMeasurable]),
  };
}

console.log(`\n=== Page model = engine, and = rules 7.1–7.3, on ${records.length} frozen records ===`);
let recordsOk = 0;
for (const rec of records) {
  const r = runVerdict(frozenToInputs(rec));
  const name = `${rec.set} ${rec.ticker}`;
  let ok = check(`${name}: page model equals the engine result`, pageView(r), engineView(r), true);
  const m = verdictPage(r);
  ok =
    check(
      `${name}: state, verdicts and evidence equal the fixture`,
      [m.state, m.coreThread.verdict, m.nexCore.verdict, m.coreThread.evidence.level, m.nexCore.evidence.level],
      [rec.expected.state, rec.expected.ct.verdict, rec.expected.nc.verdict, rec.expected.ct.conf, rec.expected.nc.conf],
      true
    ) && ok;
  for (const s of [m.coreThread, m.nexCore]) {
    const want = TABLE[s.seller][s.verdict as Verdict];
    ok = check(`${name}: ${s.seller} ${s.verdict} protections = rules 7.2`, s.protections.map((p) => ({ component: p.component, text: p.lines.join(" · ") })), want, true) && ok;
    ok = check(`${name}: ${s.seller} terms = rules 7.1`, s.terms, s.verdict === "Pursue" ? TERMS_PURSUE : TERMS_OTHER, true) && ok;
  }
  ok = check(`${name}: NexCore condition = rules 7.3 exactly when Fragile`, m.nexCore.condition, m.state === "Fragile" ? CONDITION : null, true) && ok;
  ok = check(`${name}: CoreThread never carries the 7.3 condition`, m.coreThread.condition, null, true) && ok;
  if (ok) recordsOk++;
}
check("records with every field matching", recordsOk, records.length);

console.log("\n=== Every verdict reached, for both sellers ===");
{
  const seen = new Set<string>();
  for (const rec of records) {
    const m = verdictPage(runVerdict(frozenToInputs(rec)));
    seen.add(`CoreThread ${m.coreThread.verdict}`);
    seen.add(`NexCore ${m.nexCore.verdict}`);
  }
  check("fixtures reach CoreThread Pursue, PwG, Limit exposure and NexCore Pursue, PwG, Monitor, Limit exposure", [...seen].sort(), [
    "CoreThread Limit exposure",
    "CoreThread Pursue",
    "CoreThread Pursue with guardrails",
    "NexCore Limit exposure",
    "NexCore Monitor",
    "NexCore Pursue",
    "NexCore Pursue with guardrails",
  ]);
  // CoreThread Monitor (Watch with caution) is not in the 90; check its row on a synthetic Watch + caution.
  const fdx = frozenToInputs(records.find((x) => x.set === "today" && x.ticker === "FDX")!);
  fdx.netDebt = { now: 50_000_000_000, yearAgo: 15_077_000_000 }; // LEVERAGE: 50,000M ÷ 8,925M > 4×
  const m = verdictPage(runVerdict(fdx));
  check("synthetic Watch + CoreThread caution -> CoreThread Monitor", [m.state, m.coreThread.verdict], ["Watch", "Monitor"]);
  check("CoreThread Monitor protections = rules 7.2", m.coreThread.protections.map((p) => ({ component: p.component, text: p.lines.join(" · ") })), TABLE.CoreThread.Monitor);
}

console.log("\n=== Discovery band ===");
{
  const page = (t: string) => verdictPage(runVerdict(frozenToInputs(records.find((x) => x.set === "today" && x.ticker === t)!)));
  check("AMZN band", page("AMZN").nexCore.discovery, {
    line: "Retail and logistics operations",
    route: "Site operator",
    routes: ["Partner", "Device builder", "Site operator"],
    sic: 5961,
    caption: "Rough guide from the industry code · Industry-based · SIC 5961 · Commercial discovery, not part of the verdict",
  });
  check("NVDA route Partner", page("NVDA").nexCore.discovery?.route, "Partner");
  check("MSFT: no band", page("MSFT").nexCore.discovery, null);
}

console.log("\n=== Fix pass (rules 17.6) ===");
const today = (t: string) => records.find((x) => x.set === "today" && x.ticker === t)!;
const pageOf = (t: string) => verdictPage(runVerdict(frozenToInputs(today(t))));
{
  // Plain words on every frozen record: no flag names in capitals, no operators, never "MISSING" / "missing".
  const FLAG_RE = new RegExp(FLAG_ORDER.map((f) => f.replace(/[,]/g, ",")).join("|"));
  const OPERATOR_RE = /[<>≤≥]| AND | OR /;
  const bad: string[] = [];
  for (const rec of records) {
    const m = verdictPage(runVerdict(frozenToInputs(rec)));
    const texts = [
      ...m.areas.flatMap((a) => [a.value, ...(a.valueNote ? [a.valueNote] : []), ...a.bullets, ...a.tip.formula, ...a.tip.thisQuarter, ...a.tip.critical, ...a.tip.couldNotRun, ...a.tip.warningWhen]),
      ...m.ratios.flatMap((k) => [k.value, k.formula, k.means, k.foot]),
      m.coreThread.evidence.shown,
      m.nexCore.evidence.shown,
      ...m.summary,
      ...m.coreThread.why,
      ...m.nexCore.why,
    ];
    for (const t of texts) {
      if (FLAG_RE.test(t) || OPERATOR_RE.test(t) || /MISSING|\bmissing\b/.test(t) || /not measurable/.test(t)) bad.push(`${rec.set} ${rec.ticker}: ${t}`);
    }
  }
  check("ⓘ, cards, evidence, Why and summary: plain words on all 90 records", bad.slice(0, 5), []);
}
{
  const amzn = pageOf("AMZN");
  const cash = amzn.areas.find((a) => a.area === "cash-generation")!;
  const lev = amzn.areas.find((a) => a.area === "funding-and-leverage")!;
  check("AMZN cash ⓘ: runway not computed", cash.tip.thisQuarter.includes("Runway: only computed when quarterly operating cash flow is negative"), true);
  check("AMZN cash ⓘ: warning bullets in plain words", cash.tip.warningWhen, [
    "Severe: operating cash flow negative now and a year ago, with under 12 months of cash left",
    "Operating cash flow negative now and a year ago, with 12–24 months of cash left, or runway unknown",
    "Free cash flow negative now and a year ago, while operating cash flow falls or net debt rises",
  ]);
  check("AMZN funding ⓘ: net debt and net cash from both balances", lev.tip.thisQuarter.slice(0, 3), [
    "Now: net debt $9.6B",
    "A year ago: net cash $37.3B",
    "Change: moved from net cash $37.3B to net debt $9.6B",
  ]);
  check("AMZN funding card", [lev.value, lev.bullets.at(-1)], ["Net debt $9.6B", "Net cash $37.3B a year ago"]);
  const rivn = pageOf("RIVN").areas.find((a) => a.area === "funding-and-leverage")!;
  check("RIVN funding ⓘ: net cash on both dates", rivn.tip.thisQuarter.slice(0, 3), ["Now: net cash $866.0M", "A year ago: net cash $3.1B", "Change: net cash down $2.2B"]);
  const vz = pageOf("VZ").areas.find((a) => a.area === "cash-generation")!;
  check("VZ cash ⓘ: could not run, in plain words", vz.tip.couldNotRun, ["Investment cash test: free cash flow (last 12 months) and free cash flow (12 months before) not available"]);
  const fdx = pageOf("FDX").areas.find((a) => a.area === "filing-status")!;
  check("FDX filing ⓘ: could not run, in plain words", fdx.tip.couldNotRun, [
    "Filing deadline test: an 8-K announces a fiscal-year change (filed Sep 29, 2026 · Jul 21, 2026 · Jun 23, 2026)",
  ]);
}
{
  check("evidence in plain words (VZ CoreThread)", pageOf("VZ").coreThread.evidence.shown, "Limited · investment cash test could not run · R&D not separately disclosed · finance-arm debt not separable");
  check("evidence in plain words (FDX NexCore)", pageOf("FDX").nexCore.evidence.shown, "Limited · filing deadline test could not run");
  const gnln = verdictPage(runVerdict(frozenToInputs(records.find((x) => x.set === "distress" && x.ticker === "GNLN")!)));
  check("evidence in plain words (GNLN NexCore)", gnln.nexCore.evidence.shown, "Limited · severe cash burn test could not run · cash burn test could not run · investment cash test could not run");
}
{
  const x = frozenToInputs(today("AMZN"));
  x.ocf12m = { now: null, yearAgo: 121_137_000_000 };
  x.otherRatios.dso = null;
  const m = verdictPage(runVerdict(x));
  const cash = m.areas.find((a) => a.area === "cash-generation")!;
  check("a missing headline figure reads — with Not available", [cash.value, cash.valueNote], ["—", "Not available"]);
  const dso = m.ratios.find((k) => k.key === "dso")!;
  check("a missing ratio reads — with Not available", [dso.value, dso.valueNote], ["—", "Not available"]);
  check("a missing ⓘ value reads — Not available", cash.tip.thisQuarter[0], "Operating cash flow, last 12 months: — Not available");
}
{
  const item = (kind: StandOutItem["kind"], explainKey?: string): StandOutItem => ({ kind, tag: kind.toUpperCase(), tone: "watch", headline: "h", sentence: "s", figures: "f", rule: "r", explainKey });
  const kept = shownFindings([
    item("red-flag", "red-flag:missed-deadline:2026-10-01"),
    item("red-flag", "red-flag:late-filing-12b25:2026-05-18"),
    item("payables", "dpo-rising"),
    item("terms"),
  ]).map((i) => i.explainKey ?? i.kind);
  check("What stands out: the old missed-deadline red flag and terms item are retired; other red flags stay", kept, ["red-flag:late-filing-12b25:2026-05-18", "dpo-rising"]);
}
{
  const seg = (values: number[], periodKind: SegmentRevenue["periodKind"] = "direct"): SegmentRevenue => ({
    axis: "us-gaap:StatementBusinessSegmentsAxis",
    periodKind,
    values: values.map((v, i) => ({ member: `x:Seg${i}Member`, value: v, concept: "us-gaap:Revenues", method: "direct", periodEnd: "2026-06-30" })),
  });
  check("segments: AMZN's three sum exactly, shown", segmentSplit(seg([116_177e6, 42_197e6, 42_232e6]), 200_606e6, undefined)?.total, 200_606e6);
  check("segments: within $1M, shown", segmentSplit(seg([100e6, 50_500_000]), 151e6, undefined) !== null, true);
  check("segments: more than $1M off, hidden (VZ's shape)", segmentSplit(seg([74e6, 7e6]), 34_253e6, undefined), null);
  check("segments: $1M and one dollar off, hidden", segmentSplit(seg([100e6, 50e6]), 151_000_001, undefined), null);
  check("segments: a single segment, hidden", segmentSplit(seg([200e6]), 200e6, undefined), null);
  check("segments: annual-only reconciles to the fiscal year", [segmentSplit(seg([600e6, 400e6], "annual-only"), 250e6, 1_000e6)?.total, segmentSplit(seg([600e6, 400e6], "annual-only"), 1_000e6, undefined)], [1_000e6, null]);
  check("segments: none filed, hidden", segmentSplit(null, 1e9, undefined), null);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) console.log(`Failures:\n  ${failures.slice(0, 40).join("\n  ")}`);
process.exit(fail === 0 ? 0 : 1);
