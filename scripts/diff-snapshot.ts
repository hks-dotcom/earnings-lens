// Re-pulls a ticker fresh from EDGAR and diffs it against its stored
// snapshots/<TICKER>.json, cell by cell. Quarters are matched by accession
// number (not array position), so a new filing shifting the 5-quarter
// window doesn't produce spurious diffs for the quarters that still
// overlap -- it's reported separately as "new quarter" / "dropped quarter".
//
// Usage: npx tsx scripts/diff-snapshot.ts NVDA MSFT WMT UFPT NAII AMZN GOOGL

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveTicker } from "@/lib/edgar/tickers";
import { getSubmissions, periodicFilings } from "@/lib/edgar/submissions";
import { getCompanyFacts } from "@/lib/edgar/companyFacts";
import { buildKeyFinancials } from "@/lib/xbrl/keyFinancials";
import { buildAnnualFigures } from "@/lib/present/annualFigures";
import {
  ANNUAL_ROW_NAMES,
  AnnualSnapshotCell,
  buildSnapshot,
  ROW_NAMES,
  Snapshot,
  SnapshotCell,
} from "@/scripts/lib/snapshotTypes";

const SNAPSHOT_DIR = join(process.cwd(), "snapshots");

function cellsEqual(a: SnapshotCell | null, b: SnapshotCell | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.value === b.value && a.concept === b.concept && a.method === b.method && a.derived === b.derived;
}

function describeCell(c: SnapshotCell | null): string {
  if (!c) return "MISSING";
  return `${c.value.toLocaleString()} (tag=${c.concept}, method=${c.method}, derived=${c.derived})`;
}

function annualCellsEqual(a: AnnualSnapshotCell | null, b: AnnualSnapshotCell | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.value === b.value && a.concept === b.concept;
}

function describeAnnualCell(c: AnnualSnapshotCell | null): string {
  return c ? `${c.value.toLocaleString()} (tag=${c.concept})` : "MISSING";
}

/**
 * Annual years are matched by fiscal-year END DATE, not array position:
 * a new 10-K shifts the three-year window, and the two years that still
 * overlap must not diff just because they moved along by one.
 */
function diffAnnual(oldSnap: Snapshot, freshSnap: Snapshot): { changed: number; checked: number } {
  const oldA = oldSnap.annual;
  const freshA = freshSnap.annual;
  if (!oldA && !freshA) return { changed: 0, checked: 0 };
  if (!oldA || !freshA) {
    console.log(`  [CHANGED] annual figures ${oldA ? "disappeared" : "appeared"}`);
    return { changed: 1, checked: 1 };
  }

  const oldByEnd = new Map(oldA.years.map((y, i) => [y.periodEnd, i]));
  const freshByEnd = new Map(freshA.years.map((y, i) => [y.periodEnd, i]));

  const newYears = freshA.years.filter((y) => !oldByEnd.has(y.periodEnd));
  const droppedYears = oldA.years.filter((y) => !freshByEnd.has(y.periodEnd));
  if (newYears.length) console.log(`  New fiscal year(s): ${newYears.map((y) => `${y.label} (${y.periodEnd})`).join(", ")}`);
  if (droppedYears.length) console.log(`  Fiscal year(s) dropped: ${droppedYears.map((y) => `${y.label} (${y.periodEnd})`).join(", ")}`);

  let changed = 0;
  let checked = 0;
  for (const rowName of ANNUAL_ROW_NAMES) {
    for (const [end, oldIdx] of oldByEnd) {
      const freshIdx = freshByEnd.get(end);
      if (freshIdx === undefined) continue;
      const a = oldA.rows[rowName][oldIdx];
      const b = freshA.rows[rowName][freshIdx];
      checked++;
      if (!annualCellsEqual(a, b)) {
        changed++;
        console.log(`  [CHANGED] annual ${rowName} @ ${oldA.years[oldIdx].label} (${end}):`);
        console.log(`      was: ${describeAnnualCell(a)}`);
        console.log(`      now: ${describeAnnualCell(b)}`);
      }
    }
  }
  return { changed, checked };
}

async function diffOne(ticker: string): Promise<{ changed: number; checked: number }> {
  const snapshotPath = join(SNAPSHOT_DIR, `${ticker.toUpperCase()}.json`);
  if (!existsSync(snapshotPath)) {
    console.log(`  ${ticker}: no snapshot at ${snapshotPath} -- run scripts/snapshot.ts first`);
    return { changed: 0, checked: 0 };
  }
  const old: Snapshot = JSON.parse(readFileSync(snapshotPath, "utf-8"));

  const record = await resolveTicker(ticker);
  if (!record) {
    console.log(`  ${ticker}: not found in SEC's ticker map`);
    return { changed: 0, checked: 0 };
  }
  const subs = await getSubmissions(record.cik);
  const facts = await getCompanyFacts(record.cik);
  const periodic = periodicFilings(subs);
  const kf = buildKeyFinancials(facts, periodic, subs.fiscalYearEnd);
  const fresh = buildSnapshot(
    record.ticker,
    record.cik,
    kf,
    buildAnnualFigures(facts, kf, periodic)
  );

  console.log(`\n=== ${ticker} ===`);

  const oldByAccn = new Map(old.quarters.map((q, i) => [q.accessionNumber, i]));
  const freshByAccn = new Map(fresh.quarters.map((q, i) => [q.accessionNumber, i]));

  const newQuarters = fresh.quarters.filter((q) => !oldByAccn.has(q.accessionNumber));
  const droppedQuarters = old.quarters.filter((q) => !freshByAccn.has(q.accessionNumber));
  if (newQuarters.length) {
    console.log(`  New quarter(s) in the window: ${newQuarters.map((q) => `${q.label} (${q.accessionNumber})`).join(", ")}`);
  }
  if (droppedQuarters.length) {
    console.log(`  Quarter(s) dropped out of the window: ${droppedQuarters.map((q) => `${q.label} (${q.accessionNumber})`).join(", ")}`);
  }

  const sharedAccns = [...oldByAccn.keys()].filter((accn) => freshByAccn.has(accn));
  let changed = 0;
  let checked = 0;
  for (const rowName of ROW_NAMES) {
    for (const accn of sharedAccns) {
      const oldIdx = oldByAccn.get(accn)!;
      const freshIdx = freshByAccn.get(accn)!;
      const oldCell = old.rows[rowName][oldIdx];
      const freshCell = fresh.rows[rowName][freshIdx];
      checked++;
      if (!cellsEqual(oldCell, freshCell)) {
        changed++;
        const label = old.quarters[oldIdx].label;
        console.log(`  [CHANGED] ${rowName} @ ${label} (${accn}):`);
        console.log(`      was: ${describeCell(oldCell)}`);
        console.log(`      now: ${describeCell(freshCell)}`);
      }
    }
  }
  console.log(`  ${checked} quarterly cells checked across ${sharedAccns.length} shared quarters, ${changed} changed.`);

  const annual = diffAnnual(old, fresh);
  const sharedYears = old.annual && fresh.annual
    ? old.annual.years.filter((y) => fresh.annual!.years.some((f) => f.periodEnd === y.periodEnd)).length
    : 0;
  console.log(`  ${annual.checked} annual cells checked across ${sharedYears} shared fiscal years, ${annual.changed} changed.`);

  return { changed: changed + annual.changed, checked: checked + annual.checked };
}

async function main() {
  const tickers = process.argv.slice(2);
  if (tickers.length === 0) {
    console.error("Usage: npx tsx scripts/diff-snapshot.ts TICKER [TICKER...]");
    process.exit(1);
  }
  let totalChanged = 0;
  for (const t of tickers) {
    const { changed } = await diffOne(t);
    totalChanged += changed;
  }
  console.log(`\n${totalChanged} total changed cell(s) across ${tickers.length} ticker(s).`);
  if (totalChanged > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
