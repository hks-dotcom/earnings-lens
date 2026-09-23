// Writes a JSON snapshot of a ticker's key-financials cells (value, tag,
// method, derived -- every cell, not just the number) to snapshots/. Run
// scripts/diff-snapshot.ts afterward to catch any cell that changes on a
// fresh pull, whether from a new filing, an EDGAR restatement, or a code
// change to the resolution logic.
//
// Usage: npx tsx scripts/snapshot.ts NVDA MSFT WMT UFPT NAII AMZN GOOGL

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolveTicker } from "@/lib/edgar/tickers";
import { getSubmissions, periodicFilings } from "@/lib/edgar/submissions";
import { getCompanyFacts } from "@/lib/edgar/companyFacts";
import { buildKeyFinancials } from "@/lib/xbrl/keyFinancials";
import { buildAnnualFigures } from "@/lib/present/annualFigures";
import { buildSnapshot } from "@/scripts/lib/snapshotTypes";

const SNAPSHOT_DIR = join(process.cwd(), "snapshots");

async function snapshotOne(ticker: string) {
  const record = await resolveTicker(ticker);
  if (!record) {
    console.error(`  ${ticker}: not found in SEC's ticker map, skipped`);
    return;
  }
  const subs = await getSubmissions(record.cik);
  const facts = await getCompanyFacts(record.cik);
  const periodic = periodicFilings(subs);
  const kf = buildKeyFinancials(facts, periodic, subs.fiscalYearEnd);
  const snapshot = buildSnapshot(
    record.ticker,
    record.cik,
    kf,
    buildAnnualFigures(facts, kf, periodic)
  );

  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const path = join(SNAPSHOT_DIR, `${record.ticker}.json`);
  writeFileSync(path, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(`  ${record.ticker}: wrote ${path}`);
}

async function main() {
  const tickers = process.argv.slice(2);
  if (tickers.length === 0) {
    console.error("Usage: npx tsx scripts/snapshot.ts TICKER [TICKER...]");
    process.exit(1);
  }
  console.log(`Writing snapshots for: ${tickers.join(", ")}`);
  for (const t of tickers) {
    await snapshotOne(t);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
