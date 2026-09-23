// Runs the rules engine (signals, matrix, ladder, deal
// structure) for both lenses on a ticker and prints everything needed to
// check against the expected rungs, quadrants and signals.
//
// Usage: npx tsx scripts/rules-report.ts NVDA MSFT WMT UFPT NAII AMZN

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
function num(v: number | undefined, digits = 1): string {
  return v === undefined ? "MISSING" : v.toFixed(digits);
}

async function reportOne(ticker: string) {
  const record = await resolveTicker(ticker);
  if (!record) {
    console.log(`${ticker}: not found`);
    return;
  }
  const subs = await getSubmissions(record.cik);
  const facts = await getCompanyFacts(record.cik);
  const periodic = periodicFilings(subs);
  const kf = buildKeyFinancials(facts, periodic, subs.fiscalYearEnd);
  const health = computeFinancialHealth(kf);

  console.log(`\n\n########## ${record.title} (${record.ticker}) -- ${kf.quarters[0]?.label} ##########`);

  const core = evaluateLens("Services", kf, health, subs);
  const nova = evaluateLens("SaaS", kf, health, subs);

  console.log("\n--- Shared risk inputs (same for both lenses) ---");
  console.log(`  Altman Z'': ${num(core.altmanZPrime, 2)}`);
  console.log(`  Red flags (12mo, ${core.redFlags.windowStart} -> ${core.redFlags.windowEnd}):`);
  if (core.redFlags.findings.length === 0) {
    console.log("    none found");
  } else {
    for (const f of core.redFlags.findings) console.log(`    [${f.type}] ${f.detail}`);
  }
  console.log(`  Going concern: not checked`);
  console.log(
    `  Payment behaviour: DPO ${num(core.paymentBehavior.dpoCurrent, 1)} vs ${num(core.paymentBehavior.dpoYearAgo, 1)} a year ago, Y/Y ${pct(core.paymentBehavior.yoyPctChange)} -> ${core.paymentBehavior.state.toUpperCase()}`
  );
  console.log(
    `  Retrenchment: ${core.retrenchment.triggered ? "TRIGGERED -- " + core.retrenchment.causes.join("; ") : "none in figures"}`
  );

  console.log("\n--- Revenue signal (shared) ---");
  console.log(
    `  Y/Y ${pct(core.revenue.yoyPct)} (Q/Q ${pct(core.revenue.qoqPct)}) -> ${core.revenue.direction?.toUpperCase() ?? "MISSING"}`
  );

  console.log("\n--- Engineering spend / R&D signal (shared, feeds the matrix for both lenses) ---");
  console.log(
    `  Y/Y ${pct(core.engineeringSpend.yoyPct)} (Q/Q ${pct(core.engineeringSpend.qoqPct)}) -> ${core.engineeringSpend.direction?.toUpperCase() ?? "R&D NOT FILED"}`
  );
  console.log(
    `  Intensity (context only): ${num(core.engineeringSpend.intensityCurrentPct)}%, from ${num(core.engineeringSpend.intensityYearAgoPct)}% a year ago`
  );

  for (const lens of [core, nova]) {
    console.log(`\n--- ${lens.lens} ---`);
    console.log(`  Opportunity: ${lens.opportunity.high ? "HIGH" : "LOW"}${lens.opportunity.rdNotFiled ? "  [card: \"R&D not filed\"]" : ""}`);
    console.log(`    Rule: ${lens.opportunity.rule}`);
    console.log(`  Risk: ${lens.risk.high ? "HIGH" : "LOW"}`);
    console.log(`    Rule: ${lens.risk.rule}`);
    console.log(`  Matrix quadrant: ${lens.quadrant}`);
    console.log(`  Ladder rung: ${lens.ladder.rung}`);
    console.log(`    Rule: ${lens.ladder.rule}`);
    console.log(
      `    Net 30: ${lens.ladder.net30 ? "✓" : "✕"}${lens.ladder.escalateBeforeSigning ? " (escalate before signing)" : ""}   Net 45: ${lens.ladder.net45 ? "✓" : "✕"}   Net 60: ✕`
    );
    if (lens.lens === "Services") {
      console.log(`  Contract structure: ${lens.dealStructure.contractStructure}`);
    } else {
      console.log(
        `  Tech investment (R&D intensity, informational): ${num(lens.techInvestment?.intensityCurrentPct)}%, from ${num(lens.techInvestment?.intensityYearAgoPct)}% a year ago`
      );
      console.log(`  Product focus: handover to GTM`);
    }
    console.log(`  Credit exposure: ${lens.dealStructure.creditExposure} (${lens.dealStructure.billingAssumption})`);
    console.log(`  Negotiation note: "${lens.negotiationNote}"`);
  }
}

async function main() {
  const tickers = process.argv.slice(2);
  for (const t of tickers) {
    await reportOne(t);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
