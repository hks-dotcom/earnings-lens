// Pipeline test for the S5 verdict input builder (report only; network; not
// part of "check"). For each of the 90 regression records it builds the
// engine's inputs from EDGAR as of the record's date with
// lib/verdict/inputs.ts, compares them field by field with the frozen
// fixture inputs (tests/fixtures/verdict-s5/), runs the engine on them and
// compares the outcome with the fixture's expected block.
//
// Read-only: it refuses to start with DATABASE_URL set, removes any Claude
// key, turns the Claude layer off and blocks Anthropic and Neon hosts. EDGAR
// goes through the app's own throttled http layer; responses can be kept on
// disk so a rerun does not fetch again.
//
// Environment:
//   VERDICT_PIPELINE_OUT    output folder (required; outside the repo)
//   VERDICT_PIPELINE_CACHE  folder for cached EDGAR responses (read and write)
//   VERDICT_PIPELINE_SEED   ":"-separated folders of cached responses to read first (never written)
//   VERDICT_PIPELINE_SEED_EXTRACTS / VERDICT_PIPELINE_SEED_TEXT
//                           folders of <accession>.json statement extracts / 8-K texts to read first (never written)
//
// Usage: tsx scripts/verdict-s5-pipeline.ts --today <collection date> [--set today|distress|year-back] [TICKER ...]

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

if (process.env.DATABASE_URL) {
  console.error("REFUSING TO START: DATABASE_URL is set.");
  process.exit(1);
}
delete process.env.ANTHROPIC_API_KEY;
process.env.CLAUDE_ENABLED = "false";

const OUT = process.env.VERDICT_PIPELINE_OUT;
if (!OUT) {
  console.error("Set VERDICT_PIPELINE_OUT to an output folder.");
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });
const CACHE = process.env.VERDICT_PIPELINE_CACHE;
if (CACHE) fs.mkdirSync(CACHE, { recursive: true });
const SEEDS = (process.env.VERDICT_PIPELINE_SEED ?? "").split(":").filter(Boolean);
const SEED_EXTRACTS = process.env.VERDICT_PIPELINE_SEED_EXTRACTS;
const SEED_TEXT = process.env.VERDICT_PIPELINE_SEED_TEXT;
const NETLOG = path.join(OUT, "network-log.txt");
const net = { network: 0, cacheHits: 0, byHost: {} as Record<string, number> };

const realFetch = globalThis.fetch;
const CACHEABLE = [
  /^https:\/\/data\.sec\.gov\/submissions\//,
  /^https:\/\/data\.sec\.gov\/api\/xbrl\/companyfacts\//,
  /^https:\/\/www\.sec\.gov\/files\/company_tickers\.json$/,
  /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\//,
];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (/anthropic/i.test(url)) throw new Error("Claude/Anthropic calls are disabled in the pipeline test");
  if (/neon\.tech|neon\.database/i.test(url)) throw new Error("Neon calls are disabled in the pipeline test");
  const cacheable = CACHEABLE.some((re) => re.test(url));
  const key = crypto.createHash("sha1").update(url).digest("hex") + ".json";
  if (cacheable) {
    for (const dir of [...(CACHE ? [CACHE] : []), ...SEEDS]) {
      const file = path.join(dir, key);
      if (fs.existsSync(file)) {
        net.cacheHits++;
        return new Response(fs.readFileSync(file), { status: 200 });
      }
    }
  }
  net.network++;
  const host = new URL(url).host;
  net.byHost[host] = (net.byHost[host] ?? 0) + 1;
  fs.appendFileSync(NETLOG, `${new Date().toISOString()} ${url}\n`);
  const res = await realFetch(input, init);
  if (cacheable && CACHE && res.ok) {
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(path.join(CACHE, key), buf);
    return new Response(buf, { status: res.status, headers: res.headers });
  }
  return res;
}) as typeof fetch;

import { edgarCache } from "@/lib/cache";
import { edgarFetchJson } from "@/lib/edgar/http";
import { getSubmissions, CompanySubmissions, FilingEntry } from "@/lib/edgar/submissions";
import { getCompanyFacts } from "@/lib/edgar/companyFacts";
import { getFilingInstance, FilingInstance } from "@/lib/edgar/xbrlInstance";
import { extractFilingStatement, FilingStatementExtract, STATEMENT_EXTRACT_VERSION } from "@/lib/xbrl/statementExtract";
import { wholeFilingDocs } from "@/lib/claude/sources";
import { addCalendarDays } from "@/lib/verdict/repairs/businessDays";
import { buildVerdictInputs, InputLoaders } from "@/lib/verdict/inputs";
import { runVerdict } from "@/lib/verdict/engine";
import type { VerdictInputs, VerdictResult } from "@/lib/verdict/types";
import { FixtureRecord, frozenToInputs, parseExpectedDirection } from "./lib/verdictS5Fixtures";

// ------------------------------------------------------------------ loaders

function seeded<T>(dir: string | undefined, accn: string): T | undefined {
  if (!dir) return undefined;
  const file = path.join(dir, `${accn}.json`);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as T) : undefined;
}

function loaders(cik: string): InputLoaders & { release: () => void } {
  const extracts = new Map<string, Promise<FilingStatementExtract>>();
  const instances = new Map<string, Promise<FilingInstance>>();
  return {
    // The app's in-memory cache keeps parsed instances for an hour; one record's are dropped when it is done.
    release: () => {
      for (const accn of instances.keys()) edgarCache.delete(`instance:${cik}:${accn}`);
    },
    extract: (f: FilingEntry) => {
      if (!extracts.has(f.accessionNumber)) {
        const seed = seeded<FilingStatementExtract>(SEED_EXTRACTS, f.accessionNumber);
        extracts.set(f.accessionNumber, seed && seed.version === STATEMENT_EXTRACT_VERSION ? Promise.resolve(seed) : extractFilingStatement(cik, f));
      }
      return extracts.get(f.accessionNumber)!;
    },
    instance: (f: FilingEntry) => {
      if (!instances.has(f.accessionNumber)) instances.set(f.accessionNumber, getFilingInstance(cik, f.accessionNumber, f.primaryDocument));
      return instances.get(f.accessionNumber)!;
    },
    eightKText: async (f: FilingEntry) => {
      const seed = seeded<{ part: string; text: string }[]>(SEED_TEXT, f.accessionNumber);
      if (seed) return seed;
      return (await wholeFilingDocs(cik, f)).map((d) => ({ part: d.part, text: d.text }));
    },
  };
}

interface RawBlock {
  accessionNumber: string[];
  filingDate: string[];
  reportDate: string[];
  acceptanceDateTime?: string[];
  form: string[];
  items?: string[];
  primaryDocument?: string[];
  primaryDocDescription?: string[];
  isXBRL?: number[];
}

/** The app's getSubmissions, plus older pages of the same endpoint when it does not reach `needFrom`. */
async function submissionsReaching(cik: string, needFrom: string): Promise<CompanySubmissions> {
  const s = await getSubmissions(cik);
  if ((s.filings[s.filings.length - 1]?.filingDate ?? "9999") <= needFrom) return s;
  const raw = await edgarFetchJson<{ filings: { files?: { name: string }[] } }>(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`);
  const have = new Set(s.filings.map((f) => f.accessionNumber));
  const filings = [...s.filings];
  for (const file of raw.filings.files ?? []) {
    if ((filings[filings.length - 1]?.filingDate ?? "9999") <= needFrom) break;
    const b = await edgarFetchJson<RawBlock>(`https://data.sec.gov/submissions/${file.name}`);
    for (let i = 0; i < b.accessionNumber.length; i++) {
      if (have.has(b.accessionNumber[i])) continue;
      filings.push({
        accessionNumber: b.accessionNumber[i],
        filingDate: b.filingDate[i],
        reportDate: b.reportDate[i] ?? "",
        acceptanceDateTime: b.acceptanceDateTime?.[i] ?? "",
        form: b.form[i],
        items: b.items?.[i] ?? "",
        primaryDocument: b.primaryDocument?.[i] ?? "",
        primaryDocDescription: b.primaryDocDescription?.[i] ?? "",
        isXBRL: Boolean(b.isXBRL?.[i]),
      });
    }
    filings.sort((a, b) => (a.filingDate < b.filingDate ? 1 : -1));
  }
  return { ...s, filings };
}

// ------------------------------------------------------------------ comparison

type Frozen = FixtureRecord["x"];

/** The built inputs in the frozen `.x` shape (the inverse of the fixture adapter), for field-by-field comparison. */
function asFrozen(x: VerdictInputs): Record<string, unknown> {
  return {
    sic: x.sic,
    revYoY: x.revenueYoYPct,
    marginChangePts0: x.operatingMarginChangePts,
    rdYoY: x.rdYoYPct,
    rdStatus: x.rdStatus,
    rdTag: x.rdTag,
    ocfTTM: [x.ocf12m.now, x.ocf12m.yearAgo],
    fcfTTM: [x.fcf12m.now, x.fcf12m.yearAgo],
    revTTM0: x.revenue12m,
    currentRatio0: x.currentRatio,
    netDebt: [x.netDebt.now, x.netDebt.yearAgo],
    runwayQuarters: x.runwayQuarters,
    critical: x.criticalFilings.map((c) => `${c.item} ${c.filingDate}`).sort(),
    missedFiling: x.filing.measurable ? x.filing.case === "overdue" : null,
    restructuring205: x.restructuringFilings.map((f) => f.filingDate),
    stale: x.stale.stale,
    financeArmDebtNotSeparable: x.dataQuality.financeArmDebtNotSeparable,
    restrictedNotSeparated: x.dataQuality.restrictedCashNotSeparated,
  };
}

function frozenView(x: Frozen): Record<string, unknown> {
  return {
    sic: x.sic,
    revYoY: x.revYoY,
    marginChangePts0: x.marginChangePts0,
    rdYoY: x.rdYoY,
    rdStatus: x.rdStatus,
    rdTag: x.rdTag,
    ocfTTM: x.ocfTTM,
    fcfTTM: x.fcfTTM,
    revTTM0: x.revTTM0,
    currentRatio0: x.currentRatio0,
    netDebt: x.netDebt,
    runwayQuarters: x.runwayQuarters,
    critical: x.critical.map((c) => (c.match(/\(8-K (\d\.\d\d) (\d{4}-\d{2}-\d{2})\)/) ?? []).slice(1).join(" ")).sort(),
    missedFiling: x.missedFiling,
    restructuring205: x.restructuring205,
    stale: x.stale,
    financeArmDebtNotSeparable: x.financeArm && !x.financeArmSeparable,
    restrictedNotSeparated: x.restrictedNotSeparated,
  };
}

function same(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return a === b || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => same(v, b[i]));
  return JSON.stringify(a) === JSON.stringify(b);
}

function outcome(r: VerdictResult) {
  const ct = r.coreThread.condition;
  const rd = ct.legs.find((l) => l.kind === "rd-caution");
  const rs = ct.legs.find((l) => l.kind === "restructuring");
  return {
    state: r.layer1.state,
    fired: [...r.layer1.fired].sort(),
    notMeasurable: [...r.layer1.notMeasurable].sort(),
    ctDirection: ct.direction,
    ctMixed: ct.mixed,
    ctRdUnknownReason: ct.direction === "UNKNOWN" ? ct.rdUnknownReason : null,
    ctLegs: {
      rd: rd && rd.kind === "rd-caution" ? rd.rdYoYPct.map((v) => Number(v.toFixed(1))) : null,
      restructuring: rs && rs.kind === "restructuring" ? rs.filingDates : [],
      operatingDeterioration: ct.legs.some((l) => l.kind === "operating-deterioration"),
    },
    ctVerdict: r.coreThread.verdict,
    ncVerdict: r.nexCore.verdict,
    ctEvidence: r.coreThread.evidence.level,
    ncEvidence: r.nexCore.evidence.level,
    ctEvidenceReasons: r.coreThread.evidence.reasons,
    ncEvidenceReasons: r.nexCore.evidence.reasons,
  };
}

function expectedOutcome(rec: FixtureRecord) {
  const e = rec.expected;
  const d = parseExpectedDirection(e.ct.direction);
  return {
    state: e.state,
    fired: [...e.fired].sort(),
    notMeasurable: [...e.unmeasurable].sort(),
    ctDirection: d.direction,
    ctMixed: d.mixed,
    ctRdUnknownReason: d.rdUnknownReason,
    ctLegs: d.legs,
    ctVerdict: e.ct.verdict,
    ncVerdict: e.nc.verdict,
    ctEvidence: e.ct.conf,
    ncEvidence: e.nc.conf,
  };
}

// ------------------------------------------------------------------ main

const SETS: Record<string, string> = { today: "today.json", distress: "distress.json", "year-back": "yearback.json" };
const D3_SUBMISSIONS_REACH_DAYS = 2200; // older submission pages until the list reaches this far before the vantage (as the S4 year-back read did)

async function main() {
  const args = process.argv.slice(2);
  const opt = (name: string) => {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
  };
  const today = opt("--today");
  if (!today || !/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error("pass --today <the S4 collection date, YYYY-MM-DD>");
  const onlySet = opt("--set");
  const onlyTickers = args;
  const fixtures = path.join(process.cwd(), "tests/fixtures/verdict-s5");
  const results: unknown[] = [];
  const outFile = path.join(OUT!, `pipeline${onlySet ? `-${onlySet}` : ""}${onlyTickers.length ? `-${onlyTickers.join("-")}` : ""}.json`);
  for (const [set, file] of Object.entries(SETS)) {
    if (onlySet && onlySet !== set) continue;
    const records: FixtureRecord[] = JSON.parse(fs.readFileSync(path.join(fixtures, file), "utf8"));
    for (const rec of records) {
      if (onlyTickers.length && !onlyTickers.includes(rec.ticker)) continue;
      const date = set === "today" ? today : (rec.vantage as string);
      const started = Date.now();
      try {
        const submissions = set === "year-back" ? await submissionsReaching(rec.cik, addCalendarDays(date, -D3_SUBMISSIONS_REACH_DAYS)) : await getSubmissions(rec.cik);
        const facts = await getCompanyFacts(rec.cik);
        const load = loaders(rec.cik);
        const { inputs, trace } = await buildVerdictInputs({ cik: rec.cik, ticker: rec.ticker, submissions, facts, assessmentDate: date, load });
        load.release();
        const built = asFrozen(inputs);
        const frozen = frozenView(rec.x);
        const inputDiffs = Object.keys(frozen).filter((k) => !same(built[k], frozen[k])).map((k) => ({ field: k, frozen: frozen[k], built: built[k] }));
        const got = outcome(runVerdict(inputs));
        const want = expectedOutcome(rec);
        const outcomeDiffs = (Object.keys(want) as (keyof typeof want)[]).filter((k) => !same(got[k], want[k])).map((k) => ({ field: k, expected: want[k], built: got[k] }));
        const frozenRun = outcome(runVerdict(frozenToInputs(rec)));
        results.push({ set, ticker: rec.ticker, cik: rec.cik, assessmentDate: date, inputDiffs, outcomeDiffs, outcome: got, frozenOutcome: frozenRun, inputs, trace });
        console.log(
          `${set} ${rec.ticker} @${date}: ${inputDiffs.length ? `${inputDiffs.length} input diff(s) [${inputDiffs.map((d) => d.field).join(", ")}]` : "inputs match"}; ${outcomeDiffs.length ? `OUTCOME CHANGES [${outcomeDiffs.map((d) => d.field).join(", ")}]` : "outcome unchanged"} (${((Date.now() - started) / 1000).toFixed(1)}s)`
        );
      } catch (e) {
        results.push({ set, ticker: rec.ticker, cik: rec.cik, assessmentDate: date, error: e instanceof Error ? (e.stack ?? e.message) : String(e) });
        console.log(`${set} ${rec.ticker} @${date}: ERROR ${e instanceof Error ? e.message : String(e)}`);
      }
      fs.writeFileSync(outFile, JSON.stringify(results, null, 1));
      edgarCache.delete(`companyfacts:${rec.cik.padStart(10, "0")}`);
      edgarCache.delete(`submissions:${rec.cik.padStart(10, "0")}`);
    }
  }
  fs.appendFileSync(path.join(OUT!, "net-summary.txt"), `${new Date().toISOString()} ${JSON.stringify({ args: process.argv.slice(2), ...net })}\n`);
  console.log(`wrote ${outFile}; network ${JSON.stringify(net)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
