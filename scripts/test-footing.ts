// The footing test: for every income statement column of every fixture,
// revenue plus the company's own lines (each with its sign toward
// operating income) must give operating income within $1M. A column with a
// MISSING line cannot be footed and is listed, not failed; a column that
// can be footed and doesn't, fails the run.
//
// Usage: npx tsx scripts/test-footing.ts NVDA MSFT ...

import { loadStatements } from "@/lib/xbrl/statementLoader";
import { footIncomeStatement } from "@/lib/xbrl/statements";

async function main() {
  let failed = 0;
  let footed = 0;
  let skipped = 0;
  for (const t of process.argv.slice(2)) {
    const { ticker, statements } = await loadStatements(t);
    for (const r of footIncomeStatement(statements)) {
      if (r.status === "foots") {
        footed++;
        continue;
      }
      if (r.status === "skipped") {
        skipped++;
        console.log(`[SKIP] ${ticker} ${r.column}: MISSING ${r.missingLines!.join("; ")}`);
        continue;
      }
      failed++;
      console.log(`[FAIL] ${ticker} ${r.column}: off by $${(r.difference! / 1e6).toFixed(1)}M`);
    }
  }
  console.log(`\n${footed} columns foot, ${skipped} skipped (a MISSING line), ${failed} fail`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
