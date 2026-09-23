// Checkpoint script: pulls a ticker's key financials
// straight from EDGAR and prints them, so figures can be eyeballed against
// the design mock before any rules/UI are built on top.
//
// Usage: npx tsx scripts/checkpoint.ts NVDA

import { resolveTicker } from "@/lib/edgar/tickers";
import { getSubmissions, periodicFilings } from "@/lib/edgar/submissions";
import { getCompanyFacts } from "@/lib/edgar/companyFacts";
import { buildKeyFinancials, LineItem, FCF_FOOTER_TEXT } from "@/lib/xbrl/keyFinancials";
import { computeFinancialHealth, dpoVsYearAgo, marginPtsChange } from "@/lib/metrics/health";
import { nextFilingDue } from "@/lib/metrics/deadlines";
import { getFilingInstance } from "@/lib/edgar/xbrlInstance";
import { extractSegmentRevenueForPeriod, extractSegmentRevenueForAxis } from "@/lib/xbrl/segments";
import { FilingPeriod } from "@/lib/xbrl/periods";
import { edgarRequestCount, resetEdgarRequestCount } from "@/lib/edgar/http";

function fmt(v: number | undefined): string {
  if (v === undefined) return "MISSING";
  return v.toLocaleString("en-US");
}

function printLine(name: string, line: LineItem) {
  console.log(`${name}:`);
  line.values.forEach((v, i) => {
    if (v === undefined) {
      console.log(`  [${i}] MISSING`);
    } else {
      console.log(`  [${i}] ${fmt(v.value)}  tag=${v.concept}  method=${v.method}  derived=${v.derived}`);
    }
  });
  const distinctConcepts = new Set(line.values.filter((v) => v !== undefined).map((v) => v!.concept));
  if (distinctConcepts.size > 1) {
    console.log(`  >>> MULTIPLE TAGS IN THIS ROW: ${[...distinctConcepts].join(", ")}`);
  }
}

const SEGMENT_TICKERS = new Set(["NVDA", "MSFT", "WMT"]);

async function reportSegments(record: { cik: string; ticker: string }, kf: ReturnType<typeof buildKeyFinancials>) {
  const getInstance = (period: FilingPeriod) =>
    getFilingInstance(record.cik, period.filing.accessionNumber, period.filing.primaryDocument);

  const latestInstance = await getInstance(kf.lookbackPeriods[0]);
  console.log(
    `\nLatest quarter's XBRL instance document: ${(latestInstance.byteSize / 1024).toFixed(0)} KB (${latestInstance.byteSize.toLocaleString()} bytes)`
  );

  console.log(
    "\nSegment revenue, all 5 quarters (from each filing's own XBRL instance document, axis priority StatementBusinessSegmentsAxis > ProductOrServiceAxis):"
  );
  for (let i = 0; i < kf.quarters.length; i++) {
    const period = kf.lookbackPeriods[i];
    console.log(`  [${i}] ${period.label} (period end ${period.filing.reportDate}, ${period.filing.form})`);
    try {
      const seg = await extractSegmentRevenueForPeriod(period, kf.lookbackPeriods, getInstance);
      if (!seg.axis) {
        console.log("    MISSING (no segment-dimensioned revenue facts found under either axis)");
        continue;
      }
      console.log(`    axis=${seg.axis}  periodKind=${seg.periodKind}`);
      for (const s of seg.values) {
        console.log(
          `      ${s.member}: ${fmt(s.value)}  method=${s.method}  (tag=${s.concept}${s.periodStart ? `, ${s.periodStart} -> ${s.periodEnd}` : `, as of ${s.periodEnd}`})`
        );
      }
      const total = seg.values.reduce((sum, s) => sum + s.value, 0);
      if (seg.periodKind === "annual-only") {
        console.log(
          `    sum of segments (FY total, could not derive Q4): ${fmt(total)}  -- NOT comparable to this quarter's total revenue`
        );
      } else {
        const totalRevenue = kf.revenue.values[i]?.value;
        console.log(
          `    sum of segments: ${fmt(total)}  vs total revenue: ${fmt(totalRevenue)}  (diff ${
            totalRevenue !== undefined ? fmt(totalRevenue - total) : "n/a"
          }, expected from corporate/eliminations)`
        );
      }
    } catch (e) {
      console.log(`    MISSING (fetch/parse error: ${(e as Error).message})`);
    }
  }

  if (record.ticker === "NVDA") {
    console.log(
      "\nNVDA: product axis (srt:ProductOrServiceAxis, lower priority) shown alongside the operating-segment axis actually used:"
    );
    for (let i = 0; i < kf.quarters.length; i++) {
      const period = kf.lookbackPeriods[i];
      const result = await extractSegmentRevenueForAxis(period, "srt:ProductOrServiceAxis", getInstance);
      console.log(`  [${i}] ${period.label}:`);
      if (!result) {
        console.log("    MISSING under this axis for this period");
        continue;
      }
      for (const s of result.values) {
        console.log(`    ${s.member}: ${fmt(s.value)}  (${result.periodKind})`);
      }
    }
  }
  console.log(
    "  Note: the SaaS lens's opportunity signal uses TOTAL revenue growth, not a selected segment -- this is informational context only."
  );
}

async function main() {
  const ticker = process.argv[2];
  if (!ticker) {
    console.error("Usage: npx tsx scripts/checkpoint.ts TICKER");
    process.exit(1);
  }

  resetEdgarRequestCount();

  const record = await resolveTicker(ticker);
  if (!record) {
    console.error(`Ticker ${ticker} not found in SEC's ticker map.`);
    process.exit(1);
  }
  console.log(`\n=== ${record.title} (${record.ticker}), CIK ${record.cik} ===`);

  const subs = await getSubmissions(record.cik);
  console.log(`Filer category (submissions.category): ${subs.category}`);
  console.log(`Fiscal year end: ${subs.fiscalYearEnd}`);

  const periodic = periodicFilings(subs);
  const facts = await getCompanyFacts(record.cik);
  const kf = buildKeyFinancials(facts, periodic, subs.fiscalYearEnd);

  console.log("\nQuarters (newest first):");
  kf.quarters.forEach((q, i) => {
    console.log(
      `  [${i}] ${q.label.padEnd(10)} period end ${q.periodEnd}  ${q.form}  accn ${q.accessionNumber}  filed ${q.filingDate}`
    );
  });

  console.log("\nKey financials (per cell: value, tag, method, derived):");
  printLine("Revenue", kf.revenue);
  printLine("Cost of revenue", kf.costOfRevenue);
  printLine("Gross profit", kf.grossProfit);
  printLine("R&D", kf.researchAndDevelopment);
  printLine("SG&A", kf.sga);
  printLine("Operating income", kf.operatingIncome);
  printLine("Net income", kf.netIncome);
  printLine("Operating cash flow", kf.operatingCashFlow);
  printLine("Capital expenditures", kf.capitalExpenditures);
  printLine("Free cash flow", kf.freeCashFlow);
  console.log(`  Footer: ${FCF_FOOTER_TEXT}`);
  printLine("Cash & equivalents", kf.cash);
  printLine("Accounts receivable", kf.accountsReceivable);
  printLine("Accounts payable", kf.accountsPayable);
  printLine("Current assets", kf.currentAssets);
  printLine("Current liabilities", kf.currentLiabilities);
  printLine("Total assets", kf.totalAssets);
  printLine("Total liabilities", kf.totalLiabilities);
  printLine("Equity", kf.equity);
  printLine("Retained earnings", kf.retainedEarnings);
  printLine("Long-term debt (total)", kf.longTermDebt);

  const health = computeFinancialHealth(kf);
  const pct = (v: number | undefined, d = 1) => (v === undefined ? "MISSING" : v.toFixed(d));
  const displayPct = (v: number | undefined) => (v === undefined ? "MISSING" : v.toFixed(1) + "%");

  console.log("\nGross margin % (displayed, 1 decimal):");
  console.log("  " + health.grossMarginPct.map(displayPct).join("  |  "));
  console.log(
    `  Q/Q pts change (from displayed values): ${pct(marginPtsChange(health.grossMarginPct[0], health.grossMarginPct[1]))}`
  );
  console.log(
    `  Y/Y pts change (from displayed values): ${pct(marginPtsChange(health.grossMarginPct[0], health.grossMarginPct[4]))}`
  );

  console.log("\nOperating margin % (displayed, 1 decimal):");
  console.log("  " + health.operatingMarginPct.map(displayPct).join("  |  "));
  console.log(
    `  Q/Q pts change (from displayed values): ${pct(marginPtsChange(health.operatingMarginPct[0], health.operatingMarginPct[1]))}`
  );
  console.log(
    `  Y/Y pts change (from displayed values): ${pct(marginPtsChange(health.operatingMarginPct[0], health.operatingMarginPct[4]))}`
  );

  console.log("\nFinancial health (newest first):");
  console.log(
    "  Current ratio:  " +
      health.currentRatio.map((v) => (v === undefined ? "MISSING" : v.toFixed(1) + "x")).join("  |  ")
  );
  console.log("  Debt/equity:    " + health.debtToEquity.map((v) => pct(v, 2)).join("  |  "));
  console.log(
    "  DSO (days):     " +
      health.dso.map((v) => (v === undefined ? "MISSING" : Math.round(v))).join("  |  ")
  );
  console.log(
    "  DPO (days):     " +
      health.dpo.map((v) => (v === undefined ? "MISSING" : Math.round(v))).join("  |  ")
  );
  console.log(
    `  DPO latest [${kf.quarters[0]?.label}]: ${
      health.dpo[0] === undefined ? "MISSING" : Math.round(health.dpo[0])
    } days   DPO year-ago [${kf.quarters[4]?.label}]: ${
      health.dpo[4] === undefined ? "MISSING" : Math.round(health.dpo[4])
    } days`
  );
  const dpoYoY = dpoVsYearAgo(health.dpo, 0);
  console.log(
    `  DPO trend (Y/Y): ${
      dpoYoY === undefined ? "MISSING" : `${dpoYoY >= 0 ? "+" : ""}${dpoYoY.toFixed(1)} days`
    }`
  );
  console.log(
    "  Altman Z'' (by quarter): " +
      kf.quarters.map((q, i) => `${q.label}=${pct(health.altmanZDoublePrime[i], 2)}`).join("  |  ")
  );

  const annualEnds = kf.lookbackPeriods.filter((p) => p.fp === "FY").map((p) => p.filing.reportDate);
  const due = nextFilingDue(kf.lookbackPeriods[0], subs.category, annualEnds);
  console.log("\nHeader line:");
  console.log(
    `  Financials for the quarter ended ${kf.quarters[0].periodEnd} (${kf.quarters[0].label})`
  );
  if (due) {
    console.log(
      `  Next ${due.form} due by ${due.isEstimated ? "~" : ""}${due.dueDate} (estimated period end ${due.estimatedPeriodEnd}${due.isEstimated ? ", estimated" : ""})`
    );
  } else {
    console.log("  Next filing due: MISSING (no filer category found)");
  }

  if (SEGMENT_TICKERS.has(record.ticker)) {
    await reportSegments(record, kf);
  }

  console.log(`\nEDGAR requests made for this ticker lookup: ${edgarRequestCount()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
