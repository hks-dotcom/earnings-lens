// Writes a JSON snapshot of the full rules-engine output (both lenses) for
// a ticker, evaluated as-of a fixed date -- not "today" -- so the snapshot
// stays reproducible even though red flags are a live, date-dependent
// check in normal use. Run scripts/diff-rules-snapshot.ts afterward to
// catch any field that changes on a fresh pull at the same as-of date.
//
// Usage: npx tsx scripts/rules-snapshot.ts 2026-09-21 NVDA MSFT WMT UFPT NAII AMZN

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolveTicker } from "@/lib/edgar/tickers";
import { getSubmissions, periodicFilings } from "@/lib/edgar/submissions";
import { getCompanyFacts } from "@/lib/edgar/companyFacts";
import { buildKeyFinancials } from "@/lib/xbrl/keyFinancials";
import { computeFinancialHealth } from "@/lib/metrics/health";
import { evaluateLens } from "@/lib/rules/evaluateLens";
import { RulesSnapshot } from "@/scripts/lib/rulesSnapshotTypes";

const SNAPSHOT_DIR = join(process.cwd(), "rules-snapshots");

async function snapshotOne(ticker: string, asOf: Date) {
  const record = await resolveTicker(ticker);
  if (!record) {
    console.error(`  ${ticker}: not found in SEC's ticker map, skipped`);
    return;
  }
  const subs = await getSubmissions(record.cik);
  const facts = await getCompanyFacts(record.cik);
  const kf = buildKeyFinancials(facts, periodicFilings(subs), subs.fiscalYearEnd);
  const health = computeFinancialHealth(kf);

  const services = evaluateLens("Services", kf, health, subs, asOf);
  const saas = evaluateLens("SaaS", kf, health, subs, asOf);

  const snapshot: RulesSnapshot = {
    ticker: record.ticker,
    cik: record.cik,
    asOf: asOf.toISOString().slice(0, 10),
    quarterLabel: kf.quarters[0]?.label ?? "",
    services,
    saas,
  };

  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const path = join(SNAPSHOT_DIR, `${record.ticker}.json`);
  writeFileSync(path, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(`  ${record.ticker}: wrote ${path}`);
}

async function main() {
  const [asOfArg, ...tickers] = process.argv.slice(2);
  if (!asOfArg || tickers.length === 0) {
    console.error("Usage: npx tsx scripts/rules-snapshot.ts YYYY-MM-DD TICKER [TICKER...]");
    process.exit(1);
  }
  const asOf = new Date(asOfArg + "T00:00:00Z");
  console.log(`Writing rules snapshots as-of ${asOfArg} for: ${tickers.join(", ")}`);
  for (const t of tickers) {
    await snapshotOne(t, asOf);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
