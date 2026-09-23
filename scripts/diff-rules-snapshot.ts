// Re-pulls a ticker fresh from EDGAR and re-evaluates the rules engine at
// the SAME as-of date as the stored rules-snapshots/<TICKER>.json, then
// diffs field by field. Because the as-of date is fixed (not "today"),
// this is a true regression check -- red flags aging out of a live
// 12-month window is expected behavior in normal use, but must NOT show
// up here, since both the snapshot and the fresh run use the same fixed
// "now".
//
// Usage: npx tsx scripts/diff-rules-snapshot.ts 2026-09-21 NVDA MSFT WMT UFPT NAII AMZN

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveTicker } from "@/lib/edgar/tickers";
import { getSubmissions, periodicFilings } from "@/lib/edgar/submissions";
import { getCompanyFacts } from "@/lib/edgar/companyFacts";
import { buildKeyFinancials } from "@/lib/xbrl/keyFinancials";
import { computeFinancialHealth } from "@/lib/metrics/health";
import { evaluateLens, LensResult } from "@/lib/rules/evaluateLens";
import { RulesSnapshot, LENS_FIELDS } from "@/scripts/lib/rulesSnapshotTypes";

const SNAPSHOT_DIR = join(process.cwd(), "rules-snapshots");

function diffLens(label: string, oldLens: LensResult, freshLens: LensResult): number {
  let changed = 0;
  for (const field of LENS_FIELDS) {
    const oldVal = JSON.stringify(oldLens[field]);
    const freshVal = JSON.stringify(freshLens[field]);
    if (oldVal !== freshVal) {
      changed++;
      console.log(`  [CHANGED] ${label}.${field}:`);
      console.log(`      was: ${oldVal}`);
      console.log(`      now: ${freshVal}`);
    }
  }
  return changed;
}

async function diffOne(ticker: string, asOf: Date): Promise<number> {
  const snapshotPath = join(SNAPSHOT_DIR, `${ticker.toUpperCase()}.json`);
  if (!existsSync(snapshotPath)) {
    console.log(`  ${ticker}: no rules snapshot at ${snapshotPath} -- run scripts/rules-snapshot.ts first`);
    return 0;
  }
  const old: RulesSnapshot = JSON.parse(readFileSync(snapshotPath, "utf-8"));
  if (old.asOf !== asOf.toISOString().slice(0, 10)) {
    console.log(
      `  ${ticker}: snapshot as-of ${old.asOf} does not match requested ${asOf.toISOString().slice(0, 10)} -- regenerate the snapshot first`
    );
    return 1;
  }

  const record = await resolveTicker(ticker);
  if (!record) {
    console.log(`  ${ticker}: not found in SEC's ticker map`);
    return 0;
  }
  const subs = await getSubmissions(record.cik);
  const facts = await getCompanyFacts(record.cik);
  const kf = buildKeyFinancials(facts, periodicFilings(subs), subs.fiscalYearEnd);
  const health = computeFinancialHealth(kf);
  const services = evaluateLens("Services", kf, health, subs, asOf);
  const saas = evaluateLens("SaaS", kf, health, subs, asOf);

  console.log(`\n=== ${ticker} (as-of ${old.asOf}) ===`);
  if (old.quarterLabel !== kf.quarters[0]?.label) {
    console.log(`  Note: latest quarter changed (was ${old.quarterLabel}, now ${kf.quarters[0]?.label}) -- a new filing landed since the snapshot.`);
  }
  const changed = diffLens("services", old.services, services) + diffLens("saas", old.saas, saas);
  console.log(`  ${LENS_FIELDS.length * 2} fields checked, ${changed} changed.`);
  return changed;
}

async function main() {
  const [asOfArg, ...tickers] = process.argv.slice(2);
  if (!asOfArg || tickers.length === 0) {
    console.error("Usage: npx tsx scripts/diff-rules-snapshot.ts YYYY-MM-DD TICKER [TICKER...]");
    process.exit(1);
  }
  const asOf = new Date(asOfArg + "T00:00:00Z");
  let total = 0;
  for (const t of tickers) {
    total += await diffOne(t, asOf);
  }
  console.log(`\n${total} total changed field(s) across ${tickers.length} ticker(s).`);
  if (total > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
