// Gate 2, live half (report only; network; not part of "check"). For each of
// today's 41 regression companies it builds the page's verdict through the
// page's own path (lib/present/verdictSource.ts: buildVerdictInputs with the
// page's loaders, runVerdict, verdictPage) as of a fixed date, and compares
// the page model and the inputs with the Build A pipeline result.
//
// Read-only, as scripts/verdict-s5-pipeline.ts: refuses to start with
// DATABASE_URL set, turns the Claude layer off, blocks Anthropic and Neon
// hosts, and can read and keep EDGAR responses on disk.
//
// Environment: VERDICT_PIPELINE_OUT (required), VERDICT_PIPELINE_CACHE,
// VERDICT_PIPELINE_SEED, as in scripts/verdict-s5-pipeline.ts.
//
// Usage: tsx scripts/verdict-page-live.ts <YYYY-MM-DD> <pipeline.json> [TICKER ...]

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
import { getSubmissions } from "@/lib/edgar/submissions";
import { getCompanyFacts } from "@/lib/edgar/companyFacts";
import { loadFilingExtract } from "@/lib/xbrl/statementLoader";
import { companyVerdict } from "@/lib/present/verdictSource";
import type { VerdictResult } from "@/lib/verdict/types";
import type { VerdictPage } from "@/lib/present/verdictPage";

// ------------------------------------------------------------------ comparison

function same(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return a === b || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object).sort();
    const kb = Object.keys(b as object).sort();
    return same(ka, kb) && ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The page model's view in the shape of the pipeline's recorded outcome. */
function pageOutcome(r: VerdictResult, m: VerdictPage) {
  return {
    state: m.state,
    fired: [...r.layer1.fired].sort(),
    notMeasurable: [...r.layer1.notMeasurable].sort(),
    ctVerdict: m.coreThread.verdict,
    ncVerdict: m.nexCore.verdict,
    ctEvidence: m.coreThread.evidence.level,
    ncEvidence: m.nexCore.evidence.level,
    ctEvidenceReasons: m.coreThread.evidence.reasons,
    ncEvidenceReasons: m.nexCore.evidence.reasons,
  };
}

interface PipelineRecord {
  set: string;
  ticker: string;
  cik: string;
  assessmentDate: string;
  outcome: Record<string, unknown>;
  inputs: Record<string, unknown>;
}

async function main() {
  const date = process.argv[2];
  const pipelineFile = process.argv[3];
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !pipelineFile) throw new Error("usage: verdict-page-live.ts <YYYY-MM-DD> <Build A pipeline.json> [TICKER ...]");
  const only = process.argv.slice(4);
  const pipeline: PipelineRecord[] = JSON.parse(fs.readFileSync(pipelineFile, "utf8")).filter((r: PipelineRecord) => r.set === "today");
  const rows: unknown[] = [];
  let match = 0;
  for (const p of pipeline) {
    if (only.length && !only.includes(p.ticker)) continue;
    try {
      const submissions = await getSubmissions(p.cik);
      const facts = await getCompanyFacts(p.cik);
      const { result, page } = await companyVerdict({
        cik: p.cik,
        ticker: p.ticker,
        submissions,
        facts,
        assessmentDate: date,
        loadExtract: (f) => loadFilingExtract(p.cik, p.ticker, f).then((x) => x.extract),
      });
      const got = pageOutcome(result, page);
      const want = Object.fromEntries(Object.keys(got).map((k) => [k, (p.outcome as Record<string, unknown>)[k]]));
      const outcomeDiffs = Object.keys(got).filter((k) => !same((got as Record<string, unknown>)[k], want[k]));
      const inputDiffs = Object.keys(p.inputs).filter((k) => !same((result.inputs as unknown as Record<string, unknown>)[k], p.inputs[k]));
      const ok = outcomeDiffs.length === 0 && inputDiffs.length === 0;
      if (ok) match++;
      rows.push({ ticker: p.ticker, ok, outcomeDiffs: outcomeDiffs.map((k) => ({ field: k, pipeline: want[k], page: (got as Record<string, unknown>)[k] })), inputDiffs: inputDiffs.map((k) => ({ field: k, pipeline: p.inputs[k], page: (result.inputs as unknown as Record<string, unknown>)[k] })), page });
      console.log(`${p.ticker}: ${ok ? "page model = pipeline" : `DIFF outcome [${outcomeDiffs.join(", ")}] inputs [${inputDiffs.join(", ")}]`} · ${page.state} · CT ${page.coreThread.verdict} · NC ${page.nexCore.verdict}`);
    } catch (e) {
      rows.push({ ticker: p.ticker, ok: false, error: e instanceof Error ? (e.stack ?? e.message) : String(e) });
      console.log(`${p.ticker}: ERROR ${e instanceof Error ? e.message : String(e)}`);
    }
    fs.writeFileSync(path.join(OUT!, "page-live.json"), JSON.stringify(rows, null, 1));
    edgarCache.delete(`companyfacts:${p.cik.padStart(10, "0")}`);
    edgarCache.delete(`submissions:${p.cik.padStart(10, "0")}`);
  }
  fs.appendFileSync(path.join(OUT!, "net-summary.txt"), `${new Date().toISOString()} ${JSON.stringify({ args: process.argv.slice(2), ...net })}\n`);
  console.log(`${match}/${rows.length} match; network ${JSON.stringify(net)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
