// Unit tests for the build-2 follow-ups to "What stands out" and the verdict
// wording. No network calls.
//
// - RETURNS fires only when buybacks plus dividends over four quarters
//   exceed free cash flow over the same quarters AND exceed 5% of the latest
//   quarter's revenue: below the size test it stays quiet, above both it
//   fires with its rule line.
// - Spending cuts name every restructuring filing in the window, each with
//   its own explanation key; the Why box and the Summary name the latest
//   and count the earlier ones. No fixture has two, so they are built here.
// - A zero comparison amount reads "none".
// - Risk reads low / medium / high; the payables clause states the fact.
// - Liquidity vs debt: AMZN's check values, the net wording, and the
//   no-debt and missing cases.
//
// Usage: npx tsx scripts/test-findings.ts

import { KeyFinancials, LineItem } from "@/lib/xbrl/keyFinancials";
import { buildStandOut, listInWords, returnsItem, StandOutItem } from "@/lib/present/standOut";
import { FlowFacts } from "@/lib/present/flowFacts";
import { MILLIONS } from "@/lib/present/format";
import { LensResult } from "@/lib/rules/evaluateLens";
import { heroSubline, whyThisVerdict } from "@/lib/present/verdictReasons";
import { buildSummary } from "@/lib/present/summary";
import { FinancialHealth } from "@/lib/metrics/health";
import { buildLiquidityDebt, componentsLine, liquidityBriefLine, netHeader } from "@/lib/present/liquidityDebt";
import { Statements, StatementRow, StatementCell } from "@/lib/xbrl/statements";

let pass = 0;
let fail = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${ok ? "" : `\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`}`);
  if (ok) pass++;
  else fail++;
}

const M = 1_000_000;

function cell(value: number | undefined) {
  return value === undefined ? undefined : { value: value * M, concept: "test", method: "direct" as const, derived: false };
}

function line(latest: number | undefined, yearAgo?: number): LineItem {
  return { values: [cell(latest), undefined, undefined, undefined, cell(yearAgo)] };
}

const EMPTY: LineItem = { values: [undefined, undefined, undefined, undefined, undefined] };

function kfWith(rows: Partial<Record<keyof KeyFinancials, LineItem>>): KeyFinancials {
  return {
    revenue: EMPTY,
    costOfRevenue: EMPTY,
    grossProfit: EMPTY,
    researchAndDevelopment: EMPTY,
    sga: EMPTY,
    operatingIncome: EMPTY,
    netIncome: EMPTY,
    pretaxIncome: EMPTY,
    incomeTaxExpense: EMPTY,
    operatingCashFlow: EMPTY,
    capitalExpenditures: EMPTY,
    freeCashFlow: EMPTY,
    cash: EMPTY,
    shortTermInvestments: EMPTY,
    shortTermInvestmentsFiledEver: true,
    accountsReceivable: EMPTY,
    accountsPayable: EMPTY,
    debtTagFiledInLookback: true,
    quarters: [
      { label: "Q2 FY26", periodEnd: "2026-06-30" },
      { label: "Q1 FY26" },
      { label: "Q4 FY25" },
      { label: "Q3 FY25" },
      { label: "Q2 FY25", periodEnd: "2025-06-30" },
    ],
    ...rows,
  } as unknown as KeyFinancials;
}

function flows(buybacks: number, dividends: number, fcf: number): FlowFacts {
  return { debtLines: [], ttm: { buybacks: buybacks * M, dividends: dividends * M, freeCashFlow: fcf * M, from: "Q3 FY25", to: "Q2 FY26" } };
}

// --- RETURNS ------------------------------------------------------------------
// Revenue $10,000M a quarter: the size test is $500M.
const kf10k = kfWith({ revenue: line(10_000) });

check(
  "RETURNS: above free cash flow but below 5% of quarterly revenue does not fire",
  returnsItem(kf10k, flows(300, 150, 100), MILLIONS),
  undefined
);
check(
  "RETURNS: exactly 5% of quarterly revenue does not fire (must exceed)",
  returnsItem(kf10k, flows(400, 100, 100), MILLIONS),
  undefined
);
check(
  "RETURNS: above 5% of revenue but not above free cash flow does not fire",
  returnsItem(kf10k, flows(4_000, 1_000, 6_000), MILLIONS),
  undefined
);
const fired = returnsItem(kf10k, flows(4_000, 1_000, 3_000), MILLIONS);
check("RETURNS: above both fires", fired && { sentence: fired.sentence, figures: fired.figures, rule: fired.rule }, {
  sentence: "Buybacks and dividends of $5,000M over four quarters, against free cash flow of $3,000M.",
  figures: "Buybacks $4,000M · dividends $1,000M · free cash flow $3,000M, Q3 FY25 to Q2 FY26",
  rule: "flagged when buybacks plus dividends over the last four quarters exceed free cash flow over the same quarters, and exceed 5% of quarterly revenue ($500M here).",
});
check(
  "RETURNS: negative free cash flow, above the size test, fires",
  returnsItem(kf10k, flows(0, 600, -200), MILLIONS)?.kind,
  "returns"
);
check("RETURNS: revenue missing, no size test, does not fire", returnsItem(kfWith({}), flows(4_000, 1_000, 3_000), MILLIONS), undefined);

// --- the lens results the wording tests read ---------------------------------

function lens(over: Partial<LensResult> & { rung: "Strong" | "Neutral" | "Weak" }): LensResult {
  const { rung, ...rest } = over;
  return {
    lens: "Services",
    revenue: { direction: "up", yoyPct: 20, qoqPct: 1 },
    engineeringSpend: { direction: undefined, yoyPct: undefined, qoqPct: undefined, intensityCurrentPct: undefined, intensityYearAgoPct: undefined },
    paymentBehavior: { state: "stable", dpoCurrent: 60, dpoYearAgo: 58, yoyPctChange: 3.4 },
    retrenchment: { triggered: false, causes: [] },
    redFlags: { findings: [], windowStart: "2025-09-22", windowEnd: "2026-09-22", goingConcernChecked: false },
    altmanZPrime: 3.5,
    altmanZone: { z: 3.5, scored: "safe", zone: "safe", capped: false, ttmOperatingIncome: undefined, ttmFreeCashFlow: undefined },
    cashPosition: { case: "none", latestBurn: undefined, averageBurn: undefined, burnUsed: undefined, burnBasis: undefined, cash: undefined },
    ladder: { rung, rule: "", net30: true, net45: rung === "Strong", net60: false, escalateBeforeSigning: rung === "Weak" },
    opportunity: { high: true, rule: "", rdNotFiled: true },
    risk: { high: rung !== "Strong", rule: "" },
    quadrant: rung === "Strong" ? "Pursue" : "Pursue with guardrails",
    dealStructure: { contractStructure: "T&M monthly", creditExposure: "", billingAssumption: "" },
    negotiationNote: "",
    ...rest,
  } as LensResult;
}

const HEALTH = { grossMarginPct: [], operatingMarginPct: [] } as unknown as FinancialHealth;

// --- risk wording -------------------------------------------------------------
check("hero: Strong reads low", heroSubline(lens({ rung: "Strong" })), "Risk: low · Opportunity: high · Offer Net 30; Net 45 if pushed");
check("hero: Neutral reads medium", heroSubline(lens({ rung: "Neutral" })), "Risk: medium · Opportunity: high · Offer Net 30 and hold it");
check(
  "hero: Weak reads high",
  heroSubline(lens({ rung: "Weak" })),
  "Risk: high · Opportunity: high · Offer Net 30 · escalate before signing"
);

// --- the payables clause states the fact --------------------------------------
const kfPlain = kfWith({ revenue: line(1_000, 900) });
check(
  "Why: payables falling beyond the band states both day counts",
  whyThisVerdict(
    lens({ rung: "Strong", altmanZone: { z: 12.17, scored: "safe", zone: "safe", capped: false, ttmOperatingIncome: undefined, ttmFreeCashFlow: undefined }, paymentBehavior: { state: "falling", dpoCurrent: 56.9, dpoYearAgo: 64.0, yoyPctChange: -11.1 } }),
    kfPlain
  ).risk,
  {
    label: "Risk: low.",
    text: "The balance sheet is safe (Z'' 12.17), there are no red flags and payables are falling: 56.9 days of cost of revenue, from 64.0 a year ago.",
  }
);
check(
  "Why: payables within the band say so",
  whyThisVerdict(lens({ rung: "Strong" }), kfPlain).risk.text,
  "The balance sheet is safe (Z'' 3.50), there are no red flags and payables are within the ±10% band."
);
check(
  "Why: grey zone, payables within the band",
  whyThisVerdict(lens({ rung: "Neutral", altmanZone: { z: 2.1, scored: "grey", zone: "grey", capped: false, ttmOperatingIncome: undefined, ttmFreeCashFlow: undefined } }), kfPlain).risk.text,
  "The balance sheet is in the grey zone (Z'' 2.10). There are no red flags and payables are within the ±10% band."
);

// --- spending cuts: every restructuring filing --------------------------------
function cutsLens(filings: { filingDate: string; accessionNumber: string }[], causes: string[] = []): LensResult {
  return lens({
    rung: "Strong",
    retrenchment: {
      triggered: true,
      causes: [...filings.map((f) => `restructuring filing (8-K Item 2.05) filed ${f.filingDate}`), ...causes],
      filings,
    },
    risk: { high: true, rule: "" },
    quadrant: "Pursue with guardrails",
  });
}
const TWO = [
  { filingDate: "2026-06-03", accessionNumber: "0000000000-26-000200" },
  { filingDate: "2026-01-29", accessionNumber: "0000000000-26-000100" },
];
const THREE = [{ filingDate: "2026-08-10", accessionNumber: "0000000000-26-000300" }, ...TWO];

function cutsItem(l: LensResult, kf = kfPlain): StandOutItem | undefined {
  return buildStandOut(l, kf, HEALTH).find((i) => i.kind === "spending-cuts");
}

const two = cutsItem(cutsLens(TWO));
check("spending cuts: two filings in one sentence, oldest first", two?.sentence, "Restructuring filings (8-K Item 2.05) on 29 Jan 2026 and 3 Jun 2026.");
check("spending cuts: each filing has its own explanation key", [two?.explainKey, ...(two?.alsoExplainKeys ?? [])], [
  "restructuring:0000000000-26-000100",
  "restructuring:0000000000-26-000200",
]);
check(
  "spending cuts: three filings, commas and \"and\"",
  cutsItem(cutsLens(THREE))?.sentence,
  "Restructuring filings (8-K Item 2.05) on 29 Jan 2026, 3 Jun 2026 and 10 Aug 2026."
);
const one = cutsItem(cutsLens(TWO.slice(1)));
check("spending cuts: one filing", [one?.sentence, one?.alsoExplainKeys], ["A restructuring filing (8-K Item 2.05) on 29 Jan 2026.", undefined]);
check("listInWords", [listInWords(["a"]), listInWords(["a", "b"]), listInWords(["a", "b", "c"])], ["a", "a and b", "a, b and c"]);

const kfRnd = kfWith({ revenue: line(1_000, 900), researchAndDevelopment: line(90, 100) });
const withCut = cutsItem(cutsLens(TWO.slice(1), ["R&D down -10.0% Y/Y, beyond the 2% flat band"]), kfRnd);
check("spending cuts: a filing and an R&D cut", {
  sentence: withCut?.sentence,
  more: withCut?.more,
  figures: withCut?.figures,
}, {
  sentence: "A restructuring filing (8-K Item 2.05) on 29 Jan 2026.",
  more: [{ sentence: "R&D down 10.0% on last year.", explainKey: "retrenchment" }],
  figures: "8-K filed 29 Jan 2026, accession 0000000000-26-000100 · R&D $90M, from $100M in Q2 FY25",
});

check(
  "Why: names the latest filing and counts the earlier one",
  whyThisVerdict(cutsLens(TWO), kfPlain).risk.text.split(". ")[0],
  "A restructuring filing (8-K Item 2.05) on 3 Jun 2026 and 1 earlier put it in the higher-risk half of the matrix"
);
check("Why: label with spending cuts", whyThisVerdict(cutsLens(TWO), kfPlain).risk.label, "Risk: low, with spending cuts.");
check(
  "Summary: names the latest filing and counts the earlier ones",
  buildSummary(cutsLens(THREE), kfPlain, HEALTH).parts.find((p) => p.startsWith("Spending cuts")),
  "Spending cuts, including a restructuring filing (8-K Item 2.05) on 10 Aug 2026 and 2 earlier, point to a shrinking customer."
);
check(
  "Summary: one filing, no count",
  buildSummary(cutsLens(TWO.slice(1)), kfPlain, HEALTH).parts.find((p) => p.startsWith("Spending cuts")),
  "Spending cuts, including a restructuring filing (8-K Item 2.05) on 29 Jan 2026, point to a shrinking customer."
);

// --- a zero comparison amount reads "none" ------------------------------------
const kfAcq = kfWith({ revenue: line(2_000, 1_800) });
const acq = buildStandOut(lens({ rung: "Strong" }), kfAcq, HEALTH, {
  debtLines: [],
  acquisitions: 249 * M,
  acquisitionsYearAgo: 0,
  ttm: {},
}).find((i) => i.kind === "acquisitions");
check("acquisitions: a zero year-ago amount reads none", acq?.sentence, "$249M this quarter, against none in Q2 FY25.");
const heavy = buildStandOut(
  lens({
    rung: "Strong",
    cashPosition: {
      case: "heavy-investment",
      capitalExpenditure: 500 * M,
      capitalExpenditureYearAgo: 0,
      operatingCashFlow: 400 * M,
      operatingCashFlowYearAgo: 300 * M,
    } as LensResult["cashPosition"],
  }),
  kfAcq,
  HEALTH
).find((i) => i.kind === "heavy-investment");
check(
  "heavy investment: a zero year-ago capex reads none",
  heavy?.figures,
  "Capex $500M (Q2 FY26), none (Q2 FY25) · operating cash flow $400M (Q2 FY26), $300M (Q2 FY25)"
);

// --- liquidity vs debt --------------------------------------------------------
function bsRow(key: string, latest: number | undefined, yearAgo: number | undefined, notFiled = false): StatementRow {
  const c = (v: number | undefined): StatementCell =>
    v === undefined ? { missing: "not filed for this period" } : { value: v * M, concept: "t", method: "instant", derived: false, source: "company-facts" };
  return { key, label: key, kind: "line", quarterly: [c(latest), c(undefined), c(undefined), c(undefined), c(yearAgo)], annual: [], notFiled };
}
function statements(rows: StatementRow[]): Statements {
  return { quarters: [], years: [], income: [], balance: rows, cashFlow: [], joins: [] };
}

// AMZN's check values, Q2 FY26 and Q2 FY25.
const amzn = buildLiquidityDebt(
  statements([
    bsRow("cash", 78_188, 57_741),
    bsRow("shortTermInvestments", 44_800, 35_439),
    bsRow("longTermDebt", 132_995, 56_082),
    bsRow("shortTermBorrowings", 325, 173),
  ]),
  kfWith({ revenue: line(200_606) })
);
check("liquidity: AMZN latest", [amzn.latest.liquidity! / M, amzn.latest.debt! / M, amzn.latest.net! / M], [122_988, 133_320, 10_332]);
check("liquidity: AMZN year ago", [amzn.yearAgo.liquidity! / M, amzn.yearAgo.debt! / M, amzn.yearAgo.net! / M], [93_180, 56_255, -36_925]);
check("liquidity: AMZN header", netHeader(amzn), { now: "Net Debt $10.3B", yearAgo: " · Net Cash $36.9B a year ago" });
check(
  "liquidity: AMZN components line",
  componentsLine(amzn),
  "Q2 FY26: cash $78.2B + short-term investments $44.8B · long-term debt, incl. the part due within a year, $133.0B + short-term borrowings $0.3B. Leases excluded."
);
check(
  "liquidity: AMZN Copy brief line",
  liquidityBriefLine(amzn),
  "Liquidity vs debt: $123.0B vs $133.3B, Net Debt $10.3B (Net Cash $36.9B a year ago)."
);

const noDebt = buildLiquidityDebt(
  statements([bsRow("cash", 1_000, 900), bsRow("shortTermInvestments", 500, 400), bsRow("longTermDebt", undefined, undefined), bsRow("shortTermBorrowings", undefined, undefined, true)]),
  kfWith({ revenue: line(1_000), debtTagFiledInLookback: false } as never)
);
check("liquidity: never tagged debt", [noDebt.debtTagged, netHeader(noDebt).now, noDebt.latest.net], [false, "No debt tagged", undefined]);

const missingStb = buildLiquidityDebt(
  statements([bsRow("cash", 1_000, 900), bsRow("shortTermInvestments", 500, 400), bsRow("longTermDebt", 800, 700), bsRow("shortTermBorrowings", undefined, 50)]),
  kfWith({ revenue: line(1_000) })
);
check("liquidity: a debt row missing for the quarter makes debt and net MISSING", [missingStb.latest.debt, netHeader(missingStb).now], [undefined, "Net MISSING"]);

const cashOnly = buildLiquidityDebt(
  statements([bsRow("cash", 60, 50), bsRow("shortTermInvestments", undefined, undefined, true), bsRow("longTermDebt", 20, 25), bsRow("shortTermBorrowings", undefined, undefined, true)]),
  kfWith({ revenue: line(35), shortTermInvestmentsFiledEver: false } as never)
);
check(
  "liquidity: short-term investments never filed, cash only, $M under $100M revenue",
  [componentsLine(cashOnly), netHeader(cashOnly)],
  [
    "Q2 FY26: cash $60.0M · long-term debt, incl. the part due within a year, $20.0M; no short-term borrowings tagged. Leases excluded.",
    { now: "Net Cash $40.0M", yearAgo: " · Net Cash $25.0M a year ago" },
  ]
);

const stiMissing = buildLiquidityDebt(
  statements([bsRow("cash", 1_000, 900), bsRow("shortTermInvestments", undefined, 400), bsRow("longTermDebt", 800, 700), bsRow("shortTermBorrowings", undefined, undefined, true)]),
  kfWith({ revenue: line(1_000) })
);
check(
  "liquidity: short-term investments filed but missing this quarter, cash only and said so",
  [stiMissing.latest.liquidity! / M, componentsLine(stiMissing)],
  [1_000, "Q2 FY26: cash $1.0B (short-term investments not filed for this quarter, so cash only) · long-term debt, incl. the part due within a year, $0.8B; no short-term borrowings tagged. Leases excluded."]
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
