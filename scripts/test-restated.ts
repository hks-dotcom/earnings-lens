// The restated check: every income statement cell whose column's
// presentation (the latest-filed statement presenting the period) differs
// from the Key financials figure for the same period. Such a cell is shown
// marked "restated", with the original on hover; this lists them all.
//
// The five rows Key financials also reads -- revenue, operating income,
// pre-tax income, income tax, net income -- are expected to have none; a
// new one fails the run so it gets read before it ships (a restatement is
// legitimate, but it is news). Restated cells on the other standard rows
// (gross profit, the non-operating lines) are listed, not failed: they
// follow reclassifications between lines, which the company lines above
// them already show.
//
// Usage: npx tsx scripts/test-restated.ts NVDA MSFT ...

import { loadStatements } from "@/lib/xbrl/statementLoader";
import { isValue } from "@/lib/xbrl/statements";

const CHECKED_ROWS = new Set(["revenue", "operatingIncome", "pretaxIncome", "incomeTax", "netIncome"]);

async function main() {
  let count = 0;
  for (const t of process.argv.slice(2)) {
    const { ticker, statements: s } = await loadStatements(t);
    const cols = [...s.quarters.map((q) => q.label), ...s.years.map((y) => y.label)];
    for (const r of s.income) {
      [...r.quarterly, ...r.annual].forEach((c, i) => {
        if (!isValue(c) || !c.restated) return;
        const checked = CHECKED_ROWS.has(r.key);
        if (checked) count++;
        console.log(
          `[${checked ? "RESTATED" : "restated, listed"}] ${ticker} ${r.label} @ ${cols[i]}: ${c.value} as restated in ${c.restated.form} filed ${c.restated.filingDate} (${c.restated.accessionNumber}); Key financials ${c.restated.original}`
        );
      });
    }
  }
  console.log(`\n${count} restated cell(s) on revenue, operating income, pre-tax income, income tax or net income`);
  if (count > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
