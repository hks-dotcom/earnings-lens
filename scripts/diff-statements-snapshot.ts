// Re-builds each ticker's statements and diffs them against
// statements-snapshots/<TICKER>.json cell by cell: value, method and
// provenance, plus row order, labels and flags. Exits non-zero on any
// change, like the other two snapshot diffs.
//
// Usage: npx tsx scripts/diff-statements-snapshot.ts NVDA MSFT ...

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadStatements } from "@/lib/xbrl/statementLoader";
import { buildStatementsSnapshot, StatementsSnapshot } from "@/scripts/lib/statementsSnapshot";

const DIR = join(process.cwd(), "statements-snapshots");

async function diffOne(t: string): Promise<number> {
  const path = join(DIR, `${t}.json`);
  if (!existsSync(path)) {
    console.log(`=== ${t} ===\n  no baseline at ${path}`);
    return 1;
  }
  const old = JSON.parse(readFileSync(path, "utf8")) as StatementsSnapshot;
  const { ticker, statements } = await loadStatements(t);
  const fresh = JSON.parse(JSON.stringify(buildStatementsSnapshot(ticker, statements))) as StatementsSnapshot;
  console.log(`=== ${ticker} ===`);
  let changed = 0;
  let checked = 0;
  const report = (what: string, was: unknown, now: unknown) => {
    changed++;
    console.log(`  [CHANGED] ${what}:\n      was: ${JSON.stringify(was)}\n      now: ${JSON.stringify(now)}`);
  };
  for (const key of ["quarters", "years", "acquisitionsCaption", "joins"] as const) {
    if (JSON.stringify(old[key]) !== JSON.stringify(fresh[key])) report(key, old[key], fresh[key]);
  }
  for (const tab of ["income", "balance", "cashFlow"] as const) {
    const oldKeys = old.tabs[tab].map((r) => r.key);
    const freshKeys = fresh.tabs[tab].map((r) => r.key);
    if (JSON.stringify(oldKeys) !== JSON.stringify(freshKeys)) report(`${tab} row order`, oldKeys, freshKeys);
    for (const row of fresh.tabs[tab]) {
      const was = old.tabs[tab].find((r) => r.key === row.key);
      if (!was) continue;
      for (const field of ["label", "kind", "concept", "flags"] as const) {
        if (JSON.stringify(was[field]) !== JSON.stringify(row[field])) report(`${tab}.${row.key}.${field}`, was[field], row[field]);
      }
      row.cells.forEach((c, i) => {
        checked++;
        if (JSON.stringify(was.cells[i] ?? null) !== JSON.stringify(c ?? null)) {
          const col = i < fresh.quarters.length ? fresh.quarters[i]?.label : fresh.years[i - fresh.quarters.length]?.label;
          report(`${tab}.${row.key} @ ${col}`, was.cells[i], c);
        }
      });
    }
  }
  console.log(`  ${checked} cells checked, ${changed} changed.`);
  return changed;
}

async function main() {
  let total = 0;
  for (const t of process.argv.slice(2)) total += await diffOne(t.toUpperCase());
  console.log(`\n${total} total change(s) across ${process.argv.length - 2} ticker(s).`);
  if (total > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
