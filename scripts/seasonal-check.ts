// A retailer's seasonal Q/Q dip in SG&A must not
// trigger retrenchment, because signals read Y/Y. Walmart's Q1 FY27
// (post-holiday) is a real seasonal Q/Q dip off its Q4 FY26 (holiday)
// peak. Evaluated with Q1 FY27 as the "current" quarter (dropping the
// newest filing before building key financials shifts the whole 5-quarter
// window back one), so the Q4->Q1 Q/Q dip is directly visible in the same
// run as the Y/Y-based retrenchment check.
//
// Usage: npx tsx scripts/seasonal-check.ts WMT

import { resolveTicker } from "@/lib/edgar/tickers";
import { getSubmissions, periodicFilings } from "@/lib/edgar/submissions";
import { getCompanyFacts } from "@/lib/edgar/companyFacts";
import { buildKeyFinancials } from "@/lib/xbrl/keyFinancials";
import { computeFinancialHealth } from "@/lib/metrics/health";
import { evaluateLens } from "@/lib/rules/evaluateLens";

function pct(v: number | undefined, digits = 1): string {
  if (v === undefined) return "MISSING";
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}
function change(current: number | undefined, base: number | undefined): number | undefined {
  if (current === undefined || base === undefined || base === 0) return undefined;
  return ((current - base) / Math.abs(base)) * 100;
}

async function main() {
  const ticker = process.argv[2];
  const record = await resolveTicker(ticker);
  if (!record) throw new Error(`${ticker} not found`);

  const subs = await getSubmissions(record.cik);
  const facts = await getCompanyFacts(record.cik);
  const periodic = periodicFilings(subs);

  // Drop the newest filing so the display window shifts back one quarter:
  // "current" becomes Q1 FY27 (post-holiday), index1 becomes Q4 FY26 (the
  // holiday peak, prior quarter), index4 becomes Q1 FY26 (year-ago).
  const kf = buildKeyFinancials(facts, periodic.slice(1), subs.fiscalYearEnd);
  const health = computeFinancialHealth(kf);

  const label = (i: number) => kf.quarters[i]?.label ?? `index ${i}`;
  console.log(`\n${record.title} (${record.ticker})`);
  console.log(`Quarters in window: ${kf.quarters.map((q) => q.label).join(", ")}`);
  console.log(`  [0] ${label(0)} = post-holiday quarter (current)`);
  console.log(`  [1] ${label(1)} = prior quarter (the Q4 holiday peak)`);
  console.log(`  [4] ${label(4)} = same quarter last year`);

  const sga = kf.sga;
  const post = sga.values[0]?.value;
  const prior = sga.values[1]?.value;
  const yearAgo = sga.values[4]?.value;

  console.log("\nSG&A:");
  console.log(`  Post-holiday quarter [${label(0)}]: ${post?.toLocaleString() ?? "MISSING"}  (tag=${sga.values[0]?.concept}, method=${sga.values[0]?.method})`);
  console.log(`  Prior quarter        [${label(1)}]: ${prior?.toLocaleString() ?? "MISSING"}  (tag=${sga.values[1]?.concept}, method=${sga.values[1]?.method})`);
  console.log(`  Year-ago quarter     [${label(4)}]: ${yearAgo?.toLocaleString() ?? "MISSING"}  (tag=${sga.values[4]?.concept}, method=${sga.values[4]?.method})`);
  console.log(`  Q/Q change (post-holiday vs prior quarter): ${pct(change(post, prior))}`);
  console.log(`  Y/Y change (post-holiday vs year-ago):      ${pct(change(post, yearAgo))}`);

  const rev = kf.revenue;
  console.log("\nRevenue (for context -- same seasonal shape):");
  console.log(`  Q/Q: ${pct(change(rev.values[0]?.value, rev.values[1]?.value))}   Y/Y: ${pct(change(rev.values[0]?.value, rev.values[4]?.value))}`);

  const core = evaluateLens("Services", kf, health, subs);
  console.log("\nRetrenchment (Y/Y-based -- must ignore the Q/Q seasonal SG&A dip):");
  console.log(`  Triggered: ${core.retrenchment.triggered}`);
  console.log(`  Causes: ${core.retrenchment.causes.length ? core.retrenchment.causes.join("; ") : "none"}`);
  console.log(
    `\nSeasonality: ${!core.retrenchment.triggered ? "PASS -- no spending cuts despite the seasonal SG&A Q/Q dip" : "FAIL -- spending cuts fired on a seasonal dip"}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
