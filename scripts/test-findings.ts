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
// - Liquidity vs debt, read from each filing's balance sheet: AMZN's check
//   values, equity securities excluded, a combined debt-and-equity line,
//   cash including short-term investments, finance leases as filed and
//   split out, face values never read, no debt, company-specific lines,
//   units, and which filing a date is read from.
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
import {
  componentsLine,
  LiquidityDebt,
  liquidityAmount,
  liquidityBriefLine,
  liquidityLabel,
  LiquidityPeriod,
  netHeader,
  readBalanceSheetPeriod,
  stripUnit,
} from "@/lib/present/liquidityDebt";
import { candidateFilings } from "@/lib/present/liquiditySources";
import { FilingStatementExtract } from "@/lib/xbrl/statementExtract";

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
// Each period is read from one filing's own balance sheet. The extracts are
// built here in the shape the extractor stores, with real filers' elements
// and captions; figures in $M.
type BsLine = [element: string, caption: string, value?: number, total?: boolean];
type NoteFact = [element: string, caption: string, value: number];
const DATE = "2026-06-30";
function extractOf(lines: BsLine[], notes: NoteFact[] = [], accessionNumber = "0000000000-26-000001"): FilingStatementExtract {
  const instants: FilingStatementExtract["instants"] = {};
  const instantCaptions: Record<string, string> = {};
  for (const [element, , value] of lines) if (value !== undefined) instants[element] = [{ end: DATE, value: value * M }];
  for (const [element, caption, value] of notes) {
    instants[element] = [{ end: DATE, value: value * M }];
    instantCaptions[element] = caption;
  }
  return {
    version: 4,
    accessionNumber,
    form: "10-Q",
    reportDate: DATE,
    filingDate: "2026-07-31",
    incomeStatement: null,
    facts: {},
    acquisitions: null,
    balanceSheet: {
      role: "r",
      roleDefinition: "Statement - Balance Sheets",
      dates: [DATE],
      lines: lines.map(([element, caption, , total]) => ({ element, caption, total: total ?? false })),
    },
    instants,
    instantCaptions,
    instanceBytes: 0,
    requests: 0,
  };
}
const read = (e: FilingStatementExtract, label = "Q2 FY26", revenue = 200_606 * M) => readBalanceSheetPeriod(e, DATE, label, revenue);
const strip = (latest: LiquidityPeriod, yearAgo: LiquidityPeriod): LiquidityDebt => ({ latest, yearAgo });
const figures = (p: LiquidityPeriod) => [p.liquidity === undefined ? undefined : p.liquidity / M, p.debt === undefined ? undefined : p.debt / M, p.net === undefined ? undefined : p.net / M];
const ASSETS_TOTALS: BsLine[] = [["us-gaap:AssetsCurrent", "Total current assets", 1, true], ["us-gaap:Assets", "Total assets", 1, true]];

// AMZN, Q2 FY26 and Q2 FY25 (10-Qs 0001018724-26-000026 and -25-000086):
// long-term debt, non-current on the face; the current portion and
// short-term debt only in the notes; "Notes outstanding" (LongTermDebt) is
// the face value and is never read while the carrying amounts are filed.
const amznNow = read(
  extractOf(
    [
      ["us-gaap:CashAndCashEquivalentsAtCarryingValue", "Cash and cash equivalents", 78_213],
      ["us-gaap:MarketableSecuritiesCurrent", "Marketable securities", 44_775],
      ["us-gaap:InventoryNet", "Inventories", 38_184],
      ...ASSETS_TOTALS,
      ["us-gaap:AccruedLiabilitiesCurrent", "Accrued expenses and other", 73_406],
      ["us-gaap:LiabilitiesCurrent", "Total current liabilities", 241_274, true],
      ["amzn:LeaseLiabilityNoncurrent", "Long-term lease liabilities", 94_338],
      ["us-gaap:LongTermDebtNoncurrent", "Long-term debt", 128_894],
    ],
    [
      ["us-gaap:LongTermDebt", "Notes outstanding", 132_995],
      ["us-gaap:LongTermDebtCurrent", "Long-Term Debt, Current Maturities", 3_330],
      ["us-gaap:DebtInstrumentCarryingAmount", "Long-term debt", 128_894],
      ["us-gaap:ShortTermBorrowings", "Short-term debt", 325],
    ]
  )
);
const amznThen = read(
  extractOf(
    [
      ["us-gaap:CashAndCashEquivalentsAtCarryingValue", "Cash and cash equivalents", 57_741],
      ["us-gaap:MarketableSecuritiesCurrent", "Marketable securities", 35_439],
      ...ASSETS_TOTALS,
      ["us-gaap:LiabilitiesCurrent", "Total current liabilities", 186_921, true],
      ["us-gaap:LongTermDebtNoncurrent", "Long-term debt", 50_718],
    ],
    [
      ["us-gaap:LongTermDebt", "Notes outstanding", 56_082],
      ["us-gaap:LongTermDebtCurrent", "Long-Term Debt, Current Maturities", 5_005],
      ["us-gaap:ShortTermBorrowings", "Short-term debt", 173],
    ]
  ),
  "Q2 FY25"
);
const amzn = strip(amznNow, amznThen);
check("liquidity: AMZN Q2 FY26 liquidity, debt, net", figures(amznNow), [122_988, 132_549, 9_561]);
check("liquidity: AMZN Q2 FY26 debt lines", amznNow.debtLines.map((d) => [d.element, d.value / M, d.where]), [
  ["us-gaap:ShortTermBorrowings", 325, "notes"],
  ["us-gaap:LongTermDebtCurrent", 3_330, "notes"],
  ["us-gaap:LongTermDebtNoncurrent", 128_894, "statement"],
]);
check("liquidity: AMZN Q2 FY25 liquidity, debt, net", figures(amznThen), [93_180, 55_896, -37_284]);
check("liquidity: AMZN header", netHeader(amzn), { now: "Net Debt $9.6B", yearAgo: " · Net Cash $37.3B a year ago" });
check(
  "liquidity: AMZN components line",
  componentsLine(amzn),
  "Q2 FY26: Cash and cash equivalents $78.2B + Marketable securities $44.8B · short-term debt $0.3B + long-term debt, current maturities $3.3B + long-term debt $128.9B. Leases excluded."
);
check("liquidity: AMZN Copy brief line", liquidityBriefLine(amzn), "Liquidity vs debt: $123.0B vs $132.5B, Net Debt $9.6B (Net Cash $37.3B a year ago).");

// NVDA Q2 FY27: marketable equity securities excluded; "Short-term debt"
// (DebtCurrent) holds both short-term parts, so nothing is added from the notes.
const nvda = read(
  extractOf(
    [
      ["us-gaap:CashAndCashEquivalentsAtCarryingValue", "Cash and cash equivalents", 22_443],
      ["us-gaap:DebtSecuritiesCurrent", "Marketable debt securities", 34_143],
      ["us-gaap:EquitySecuritiesFvNi", "Marketable equity securities", 42_783],
      ...ASSETS_TOTALS,
      ["us-gaap:DebtCurrent", "Short-term debt", 1_000],
      ["us-gaap:LiabilitiesCurrent", "Total current liabilities", 43_019, true],
      ["us-gaap:LongTermDebtNoncurrent", "Long-term debt", 32_366],
    ],
    [["us-gaap:LongTermDebtCurrent", "Current portion", 1_000]]
  ),
  "Q2 FY27"
);
check("liquidity: NVDA equity securities excluded", [...figures(nvda), nvda.excluded.map((x) => x.element)], [56_586, 33_366, -23_220, ["us-gaap:EquitySecuritiesFvNi"]]);
check(
  "liquidity: NVDA components line",
  componentsLine(strip(nvda, nvda)),
  "Q2 FY27: Cash and cash equivalents $22.4B + Marketable debt securities $34.1B · short-term debt $1.0B + long-term debt $32.4B. Marketable equity securities $42.8B and leases excluded."
);

// NVDA's FY26 10-K: one company line for debt and equity securities together.
const combined = read(
  extractOf([
    ["us-gaap:CashAndCashEquivalentsAtCarryingValue", "Cash and cash equivalents", 10_605],
    ["nvda:MarketableSecuritiesAndEquitySecuritiesFVNI", "Marketable securities", 51_951],
    ...ASSETS_TOTALS,
    ["us-gaap:LongTermDebtNoncurrent", "Long-term debt", 8_468],
  ]),
  "Q4 FY26"
);
check("liquidity: a combined debt-and-equity line leaves net MISSING", [combined.liquidityComplete, combined.net, netHeader(strip(combined, amznThen)).now], [false, undefined, "Net MISSING"]);
check(
  "liquidity: the components line says why",
  componentsLine(strip(combined, amznThen)),
  "Q4 FY26: Cash and cash equivalents $10.6B + Marketable securities $52.0B (debt and equity securities combined) · long-term debt $8.5B. Leases excluded. Q4 FY26: Marketable securities combines debt and equity securities and can't be split, so there is no net figure."
);

// TGT: the cash line's own element includes short-term investments; debt
// elements that include finance leases, with nothing to split them.
const tgt = read(
  extractOf([
    ["us-gaap:CashCashEquivalentsAndShortTermInvestments", "Cash and cash equivalents", 5_411],
    ...ASSETS_TOTALS,
    ["us-gaap:LongTermDebtAndCapitalLeaseObligationsCurrent", "Current portion of long-term debt and other borrowings", 1_136],
    ["us-gaap:LiabilitiesCurrent", "Total current liabilities", 21_180, true],
    ["us-gaap:LongTermDebtAndCapitalLeaseObligations", "Long-term debt and other borrowings", 14_221],
  ])
);
check("liquidity: TGT cash line includes short-term investments", [liquidityLabel(tgt), ...figures(tgt)], ["Cash and short-term investments", 5_411, 15_357, 9_946]);
check(
  "liquidity: TGT finance leases as filed",
  componentsLine(strip(tgt, tgt)),
  "Q2 FY26: Cash and cash equivalents $5.4B · current portion of long-term debt and other borrowings $1.1B (includes finance leases, as filed) + long-term debt and other borrowings $14.2B (includes finance leases, as filed). Other leases excluded."
);

// GOOGL: a total of cash and marketable securities is a sum, never added.
const googl = read(
  extractOf(
    [
      ["us-gaap:CashAndCashEquivalentsAtCarryingValue", "Cash and cash equivalents", 55_911],
      ["us-gaap:MarketableSecuritiesCurrent", "Marketable securities", 186_563],
      ["us-gaap:CashCashEquivalentsAndShortTermInvestments", "Total cash, cash equivalents, and marketable securities", 242_474, true],
      ...ASSETS_TOTALS,
      ["us-gaap:LiabilitiesCurrent", "Total current liabilities", 126_111, true],
      ["us-gaap:LongTermDebtNoncurrent", "Long-term debt", 98_165],
    ],
    [
      ["us-gaap:CommercialPaper", "Commercial paper", 0],
      ["us-gaap:LongTermDebtCurrent", "Long-Term Debt, Current Maturities", 1_999],
      ["us-gaap:DebtInstrumentCarryingAmount", "Long-Term Debt, Gross", 101_085],
    ]
  )
);
check("liquidity: GOOGL totals skipped, current portion from the notes", figures(googl), [242_474, 100_164, -142_310]);

// FDX's 10-K: finance leases sit inside both debt lines (its finance-lease
// figures are captioned as those lines), and the notes file long-term debt
// without them, so that figure replaces the two lines.
const fdx = read(
  extractOf(
    [
      ["us-gaap:CashAndCashEquivalentsAtCarryingValue", "Cash and cash equivalents", 13_311],
      ...ASSETS_TOTALS,
      ["us-gaap:LongTermDebtAndCapitalLeaseObligationsCurrent", "Current portion of long-term debt", 1_676],
      ["us-gaap:ShortTermBorrowings", "Short-term borrowings", 745],
      ["us-gaap:LiabilitiesCurrent", "Total current liabilities", 1, true],
      ["us-gaap:LongTermDebtNoncurrent", "LONG-TERM DEBT, LESS CURRENT PORTION", 23_293],
    ],
    [
      ["us-gaap:FinanceLeaseLiabilityCurrent", "Current portion of long-term debt", 170],
      ["us-gaap:FinanceLeaseLiabilityNoncurrent", "Long-term debt, less current portion", 1_344],
      ["us-gaap:DebtInstrumentCarryingAmount", "Long-Term Debt, Gross", 23_694],
      ["us-gaap:LongTermDebt", "Long-Term Debt", 23_455],
    ]
  ),
  "Q4 FY26"
);
check("liquidity: FDX long-term debt without finance leases replaces the lines", [...figures(fdx), fdx.debtLines.map((d) => d.element)], [13_311, 24_200, 10_889, ["us-gaap:ShortTermBorrowings", "us-gaap:LongTermDebt"]]);
check(
  "liquidity: FDX components line",
  componentsLine(strip(fdx, fdx)),
  "Q4 FY26: Cash and cash equivalents $13.3B · short-term borrowings $0.7B + long-term debt $23.5B (from the notes, without finance leases). Leases excluded."
);

// A face value is never read: only a combined element equal to the gross figure is filed.
const faceOnly = read(
  extractOf(
    [["us-gaap:CashAndCashEquivalentsAtCarryingValue", "Cash and cash equivalents", 1_000], ...ASSETS_TOTALS],
    [
      ["us-gaap:LongTermDebt", "Long-Term Debt", 49_085],
      ["us-gaap:DebtInstrumentCarryingAmount", "Long-Term Debt, Gross", 49_085],
    ]
  )
);
check("liquidity: only a face value filed, debt MISSING", [faceOnly.debtState, faceOnly.debt, faceOnly.net], ["missing", undefined, undefined]);

// Nothing tagged as debt at the date: "No debt on the balance sheet".
const zm = read(
  extractOf([
    ["us-gaap:CashAndCashEquivalentsAtCarryingValue", "Cash and cash equivalents", 932],
    ["us-gaap:AvailableForSaleSecuritiesDebtSecuritiesCurrent", "Marketable securities", 6_318],
    ...ASSETS_TOTALS,
    ["zm:AccruedLiabilitiesAndOtherLiabilitiesCurrent", "Accrued expenses and other current liabilities", 558],
  ])
);
check("liquidity: no debt on the balance sheet", [zm.debtState, netHeader(strip(zm, zm))], ["none", { now: "No debt on the balance sheet", yearAgo: " · no debt a year ago" }]);

// Company-specific lines count only when the caption plainly names debt;
// restricted cash is excluded.
const company = read(
  extractOf([
    ["us-gaap:CashAndCashEquivalentsAtCarryingValue", "Cash and cash equivalents", 900],
    ["us-gaap:RestrictedCashAndCashEquivalentsAtCarryingValue", "Restricted cash and cash equivalents", 100],
    ["co:ShortTermDeposits", "Short-term investments", 50],
    ...ASSETS_TOTALS,
    ["co:RevolverCurrent", "Borrowings under revolving credit facility", 40],
    ["co:AccruedInterest", "Accrued interest on notes", 5],
    ["us-gaap:LiabilitiesCurrent", "Total current liabilities", 1, true],
    ["co:LeaseLiabilityNoncurrent", "Long-term lease liabilities", 300],
    ["co:SeniorNotesNet", "Senior notes, net", 600],
  ])
);
check(
  "liquidity: company-specific lines by caption",
  [company.investmentLines.map((x) => x.element), company.excluded.map((x) => x.element), company.debtLines.map((d) => [d.element, d.part])],
  [["co:ShortTermDeposits"], ["us-gaap:RestrictedCashAndCashEquivalentsAtCarryingValue"], [["co:RevolverCurrent", "current-all"], ["co:SeniorNotesNet", "noncurrent"]]]
);

// Units per period: $M under $1B (whole, or one decimal under $100M
// quarterly revenue), $B from $1B up.
check("liquidity: units", [stripUnit([23.4 * M, 130.6 * M], 150 * M), stripUnit([999 * M], 80 * M), stripUnit([1_000 * M], 80 * M)], [
  { scale: "M", decimals: 0 },
  { scale: "M", decimals: 1 },
  { scale: "B", decimals: 1 },
]);
check("liquidity: a UFPT-sized amount", liquidityAmount(117.3 * M, stripUnit([9 * M, 117.3 * M], 150 * M)), "$117M");

// Which filing a date is read from: the latest filed whose balance sheet
// can present it -- a fiscal year end is presented again by the next 10-K.
const filing = (form: string, reportDate: string, filingDate: string) => ({ filing: { form, reportDate, filingDate, accessionNumber: `${form}-${reportDate}` } });
const kfFilings = {
  lookbackPeriods: [
    filing("10-K", "2026-06-30", "2026-07-29"),
    filing("10-Q", "2026-03-31", "2026-04-29"),
    filing("10-Q", "2025-12-31", "2026-01-28"),
    filing("10-Q", "2025-09-30", "2025-10-29"),
    filing("10-K", "2025-06-30", "2025-07-30"),
    filing("10-Q", "2025-03-31", "2025-04-30"),
  ],
} as unknown as KeyFinancials;
check("liquidity: a year-end date, newest filing first", candidateFilings("2025-06-30", kfFilings).map((f) => f.accessionNumber), [
  "10-K-2026-06-30",
  "10-Q-2026-03-31",
  "10-Q-2025-12-31",
  "10-Q-2025-09-30",
  "10-K-2025-06-30",
]);
check("liquidity: a quarter-end date, its own filing only", candidateFilings("2025-03-31", kfFilings).map((f) => f.accessionNumber), ["10-Q-2025-03-31"]);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
