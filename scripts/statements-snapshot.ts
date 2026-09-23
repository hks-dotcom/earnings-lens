// Writes statements-snapshots/<TICKER>.json: every cell of the Income
// statement, Balance sheet and Cash flow tabs, with value, method and
// provenance. The baseline test:statements-snapshot diffs against.
//
// Usage: npx tsx scripts/statements-snapshot.ts NVDA MSFT ...

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadStatements } from "@/lib/xbrl/statementLoader";
import { buildStatementsSnapshot } from "@/scripts/lib/statementsSnapshot";

const DIR = join(process.cwd(), "statements-snapshots");

async function main() {
  const tickers = process.argv.slice(2);
  mkdirSync(DIR, { recursive: true });
  for (const t of tickers) {
    const { ticker, statements } = await loadStatements(t);
    const path = join(DIR, `${ticker}.json`);
    writeFileSync(path, JSON.stringify(buildStatementsSnapshot(ticker, statements), null, 2) + "\n");
    console.log(`  ${ticker}: wrote ${path}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
