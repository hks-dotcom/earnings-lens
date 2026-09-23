// The recast check: every income statement cell whose column's
// presentation (the latest-filed statement presenting the period) differs
// from the Key financials figure for the same period. Such a cell is shown
// marked recast, with the original on hover; this lists them all.
//
// The five rows Key financials also reads -- revenue, operating income,
// pre-tax income, income tax, net income -- are expected to have none; a
// new one fails the run so it gets read before it ships (a recast is
// legitimate, but it is news). Recast cells on the other standard rows
// (gross profit, the non-operating lines) are listed, not failed: they
// follow reclassifications between lines, which the company lines above
// them already show.
//
// Usage: npx tsx scripts/test-recast.ts NVDA MSFT ...

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
        if (!isValue(c) || !c.recast) return;
        const checked = CHECKED_ROWS.has(r.key);
        if (checked) count++;
        const x = c.recast;
        console.log(
          `[${checked ? "RECAST" : "recast, listed"}] ${ticker} ${r.label} @ ${cols[i]}: ${c.value} as recast in ${x.form} filed ${x.filingDate} (${x.accessionNumber}); originally ${x.original} in ${x.originalForm} filed ${x.originalFilingDate}`
        );
      });
    }
  }
  console.log(`\n${count} recast cell(s) on revenue, operating income, pre-tax income, income tax or net income`);
  if (count > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
