// Unit tests for the verdict input builder's data repairs (lib/verdict/repairs/,
// Earnings_Lens_Verdict_Rules_S5.md section 11): R1–R6, D, M and H, each on
// fixed inputs. No network calls.
//
// Usage: npx tsx scripts/test-verdict-inputs.ts

import type { FilingEntry, CompanySubmissions } from "@/lib/edgar/submissions";
import type { CompanyFacts, FactPoint } from "@/lib/edgar/companyFacts";
import type { FilingInstance, XbrlContext } from "@/lib/edgar/xbrlInstance";
import type { FilingStatementExtract } from "@/lib/xbrl/statementExtract";
import { buildKeyFinancials } from "@/lib/xbrl/keyFinancials";
import { periodicFilings } from "@/lib/edgar/submissions";
import { readBalanceSheetPeriod } from "@/lib/present/liquidityDebt";
import { isBusinessDay, rollForward, secHolidays } from "@/lib/verdict/repairs/businessDays";
import { eightKsToScan, filingCalendar, fiscalYearChangeSentences, reportDeadline, requiredReport } from "@/lib/verdict/repairs/filingCalendar";
import { classifyRequiredReport } from "@/lib/verdict/filingStatus";
import { axisFacts, debtConceptsInFiling, debtWithoutLine, financeScope, liquidityWithSecurities, presentsDate, RESTRICTED_LABEL, restrictedCash } from "@/lib/verdict/repairs/netDebt";
import { checkOcfRebuild, newerFilingNotIncorporated, withFilingFacts } from "@/lib/verdict/repairs/staleQuarter";
import { chooseRdTag, RD_TAGS } from "@/lib/verdict/repairs/quarterly";
import { factsAsOf, submissionsAsOf } from "@/lib/verdict/repairs/asOf";
import { criticalFilings } from "@/lib/verdict/inputs";
import { runVerdict } from "@/lib/verdict/engine";
import { frozenToInputs, FixtureRecord } from "./lib/verdictS5Fixtures";
import * as fs from "fs";
import * as path from "path";

let pass = 0;
let fail = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}  (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  if (ok) pass++;
  else fail++;
}

let seq = 0;
function filing(form: string, filingDate: string, reportDate = "", items = ""): FilingEntry {
  seq++;
  return { accessionNumber: `0000000000-26-${String(seq).padStart(6, "0")}`, filingDate, reportDate, acceptanceDateTime: "", form, items, primaryDocument: `doc${seq}.htm`, primaryDocDescription: "", isXBRL: true };
}
const obsCase = (o: ReturnType<typeof classifyRequiredReport>) => (o && o.measurable ? o.case : o ? "not measurable" : null);

// ------------------------------------------------------------------ R1
console.log("=== R1 filing calendar ===");
{
  // A calendar-year filer, 10-Qs and 10-Ks on time.
  const cal = [
    filing("10-Q", "2026-07-30", "2026-06-30"),
    filing("10-Q", "2026-04-30", "2026-03-31"),
    filing("10-K", "2026-02-20", "2025-12-31"),
    filing("10-Q", "2025-10-30", "2025-09-30"),
    filing("10-K", "2025-02-20", "2024-12-31"),
  ];
  const c = filingCalendar({ filings: cal, fiscalYearEnd: "1231", assessmentDate: "2026-10-25", appProjection: { form: "10-Q", periodEnd: "2026-09-30" }, fyChangeHits: [] });
  check("calendar-year filer: measurable, next 10-Q for 2026-09-30", [c.measurable, c.expected], [true, { form: "10-Q", periodEnd: "2026-09-30" }]);
  const k = filingCalendar({ filings: [filing("10-Q", "2026-10-28", "2026-09-30"), ...cal], fiscalYearEnd: "1231", assessmentDate: "2026-11-01", appProjection: null, fyChangeHits: [] });
  check("after Q3: next is the 10-K for 2026-12-31", k.expected, { form: "10-K", periodEnd: "2026-12-31" });
  const late = filingCalendar({ filings: [filing("10-Q", "2026-10-28", "2026-09-30"), ...cal], fiscalYearEnd: "1231", assessmentDate: "2026-10-25", appProjection: null, fyChangeHits: [] });
  check("as of a date, a later filing is not read", late.latest?.reportDate, "2026-06-30");

  // 52/53-week filer (NVDA-style): the projection snaps to the filed weekday.
  const nv = [
    filing("10-Q", "2026-08-26", "2026-07-26"),
    filing("10-Q", "2026-05-27", "2026-04-26"),
    filing("10-K", "2026-02-25", "2026-01-25"),
    filing("10-K", "2025-02-26", "2025-01-26"),
  ];
  const n = filingCalendar({ filings: nv, fiscalYearEnd: "0125", assessmentDate: "2026-10-25", appProjection: null, fyChangeHits: [] });
  check("52/53-week: floating, next 10-Q on the same weekday (2026-10-25, a Sunday)", [n.floating, n.expected, n.measurable], [true, { form: "10-Q", periodEnd: "2026-10-25" }, true]);

  // FedEx: an 8-K announcing a fiscal-year change makes the calendar not measurable.
  const fdx = [filing("10-K", "2026-07-20", "2026-05-31"), filing("10-Q", "2026-03-20", "2026-02-28"), filing("10-K", "2025-07-21", "2025-05-31")];
  const eightK = filing("8-K", "2026-07-21", "", "2.02,9.01");
  const scan = eightKsToScan([eightK, ...fdx], "2026-05-31", "2026-10-25");
  check("FedEx: the results 8-K after the period end is read", scan.map((f) => f.items), ["2.02,9.01"]);
  const sentences = fiscalYearChangeSentences(
    "Earnings release. Effective June 1, 2026, FedEx Corporation (“FedEx”) changed its fiscal year end from May 31 to December 31. Revenue rose."
  );
  check("FedEx: the fiscal-year-change sentence is matched", sentences, ["Effective June 1, 2026, FedEx Corporation (“FedEx”) changed its fiscal year end from May 31 to December 31."]);
  const fc = filingCalendar({
    filings: [eightK, ...fdx],
    fiscalYearEnd: "1231",
    assessmentDate: "2026-10-25",
    appProjection: { form: "10-Q", periodEnd: "2026-08-31" },
    fyChangeHits: sentences.map((s) => ({ accessionNumber: eightK.accessionNumber, filingDate: eightK.filingDate, items: eightK.items, part: "8-K body", sentence: s })),
  });
  check("FedEx: filing calendar not measurable", fc.measurable, false);
  const fr = requiredReport({ filings: [eightK, ...fdx], category: "Large accelerated filer", assessmentDate: "2026-10-25", calendar: fc });
  check("FedEx: filing status (and MISSED FILING) not measurable", fr.observation.measurable, false);
  check(
    "the Item 5.03 caption alone is not a fiscal-year change",
    fiscalYearChangeSentences("Item 5.03 Amendments to Articles of Incorporation or Bylaws; Change in Fiscal Year. On September 10 the Board amended the bylaws to update advance-notice provisions."),
    []
  );
  check(
    "a transition period is a fiscal-year change",
    fiscalYearChangeSentences("As a result of the change in fiscal year, the Company will file a transition report covering the transition period from June 1 to December 31.").length,
    1
  );
  const kt = filingCalendar({ filings: [filing("10-KT", "2025-03-01", "2024-12-31"), ...cal], fiscalYearEnd: "1231", assessmentDate: "2026-10-25", appProjection: null, fyChangeHits: [] });
  check("a 10-KT in the last two years -> not measurable", [kt.measurable, kt.reasons[0].startsWith("transition-period form filed")], [false, true]);
  const gapK = filingCalendar({ filings: [filing("10-Q", "2026-07-30", "2026-06-30"), filing("10-Q", "2026-04-30", "2026-03-31"), filing("10-K", "2026-02-20", "2025-12-31"), filing("10-K", "2025-02-20", "2025-05-31")], fiscalYearEnd: "1231", assessmentDate: "2026-10-25", appProjection: null, fyChangeHits: [] });
  check("10-K ends not 357–371 days apart -> not measurable", gapK.reasons.some((r) => r.includes("days apart") && r.startsWith("10-K")), true);
  const fye = filingCalendar({ filings: cal, fiscalYearEnd: "0630", assessmentDate: "2026-10-25", appProjection: null, fyChangeHits: [] });
  check("latest 10-K end more than 7 days from the stated fiscal-year end -> not measurable", fye.measurable, false);
  const qgap = filingCalendar({ filings: [filing("10-Q", "2026-07-30", "2026-06-30"), filing("10-K", "2026-02-20", "2025-12-31"), filing("10-K", "2025-02-20", "2024-12-31")], fiscalYearEnd: "1231", assessmentDate: "2026-10-25", appProjection: null, fyChangeHits: [] });
  check("last two period ends not 80–100 days apart -> not measurable", qgap.measurable, false);
  const dis = filingCalendar({ filings: cal, fiscalYearEnd: "1231", assessmentDate: "2026-10-25", appProjection: { form: "10-K", periodEnd: "2026-09-30" }, fyChangeHits: [] });
  check("projections disagree on form -> not measurable", dis.measurable, false);
}

// ------------------------------------------------------------------ R2
console.log("\n=== R2 business-day deadlines and the D2 cases ===");
check("2026 SEC holidays", secHolidays(2026), ["2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26", "2026-12-25"]);
check("New Year's Day on a Saturday is observed the Friday before (31 Dec 2021)", secHolidays(2021).includes("2021-12-31"), true);
check("Sunday 1 Mar 2026 rolls to Monday 2 Mar", rollForward("2026-03-01"), "2026-03-02");
check("Saturday 4 Jul 2026 is not a business day, nor is its observed Friday", [isBusinessDay("2026-07-04"), isBusinessDay("2026-07-03"), rollForward("2026-07-03")], [false, false, "2026-07-06"]);
check("Monday 12 Oct 2026 (Columbus Day) rolls to Tuesday", rollForward("2026-10-12"), "2026-10-13");
{
  // Xerox FY2025 10-K: due Sunday 1 Mar 2026 -> Monday 2 Mar; 12b-25 to Tuesday 17 Mar; filed 17 Mar.
  const nt = filing("NT 10-K", "2026-03-02", "2025-12-31");
  const d = reportDeadline("10-K", "2025-12-31", "Large accelerated filer", nt)!;
  check("Xerox: deadline Sunday 1 Mar -> Monday 2 Mar; extension to Tuesday 17 Mar", [d.nominal, d.deadline, d.extendedDeadline], ["2026-03-01", "2026-03-02", "2026-03-17"]);
  check(
    "Xerox: 10-K filed 17 Mar reads filed within extension",
    obsCase(classifyRequiredReport({ form: "10-K", periodEnd: "2025-12-31", deadline: d.deadline, extendedDeadline: d.extendedDeadline, filedOn: "2026-03-17" }, "2026-03-20")),
    "filed-within-extension"
  );
  const xrx = [filing("10-K", "2026-03-17", "2025-12-31"), nt, filing("10-Q", "2025-10-30", "2025-09-30"), filing("10-Q", "2025-07-31", "2025-06-30"), filing("10-K", "2025-02-25", "2024-12-31")];
  const c = filingCalendar({ filings: xrx, fiscalYearEnd: "1231", assessmentDate: "2026-03-20", appProjection: null, fyChangeHits: [] });
  const r = requiredReport({ filings: xrx, category: "Large accelerated filer", assessmentDate: "2026-03-20", calendar: c });
  check("Xerox through the builder (as of 20 Mar 2026): filed within extension", obsCase(r.observation), "filed-within-extension");
  check("Xerox: the 12b-25 event is classified the same way", r.twelveB25.map((e) => obsCase(e.observation)), ["filed-within-extension"]);
  check("the same 10-K under calendar days alone would have been late (16 Mar)", d.deadline !== "2026-03-01", true);
}
{
  const base = [filing("10-Q", "2026-05-07", "2026-03-31"), filing("10-K", "2026-02-20", "2025-12-31"), filing("10-Q", "2025-11-06", "2025-09-30"), filing("10-K", "2025-02-20", "2024-12-31")];
  const run = (extra: FilingEntry[], asOf: string) => {
    const fl = [...extra, ...base];
    return requiredReport({ filings: fl, category: "Large accelerated filer", assessmentDate: asOf, calendar: filingCalendar({ filings: fl, fiscalYearEnd: "1231", assessmentDate: asOf, appProjection: null, fyChangeHits: [] }) });
  };
  // Q2 10-Q for 2026-06-30: due 9 Aug 2026 (Sunday) -> Monday 10 Aug; with a 12b-25, 15 Aug (Saturday) -> Monday 17 Aug.
  check("overdue, none filed, no 12b-25", obsCase(run([], "2026-08-11").observation), "overdue");
  check("overdue: deadline is the rolled one", (() => { const o = run([], "2026-08-11").observation; return o.measurable ? o.deadline : null; })(), "2026-08-10");
  check("not yet due on its rolled deadline: the latest filed report (on time) is shown", obsCase(run([], "2026-08-10").observation), "on-time");
  const nt = filing("NT 10-Q", "2026-08-11", "2026-06-30");
  check("12b-25 filed, extension open", obsCase(run([nt], "2026-08-14").observation), "extension-open");
  check("extension from the rolled deadline, rolled again: 17 Aug", (() => { const o = run([nt], "2026-08-14").observation; return o.measurable ? o.extendedDeadline : null; })(), "2026-08-17");
  check("12b-25 filed, past the extension, none filed -> overdue", obsCase(run([nt], "2026-08-18").observation), "overdue");
  check("filed within the extension", obsCase(run([filing("10-Q", "2026-08-17", "2026-06-30"), nt], "2026-09-01").observation), "filed-within-extension");
  check("filed after the extended deadline -> filed late · received", obsCase(run([filing("10-Q", "2026-08-20", "2026-06-30"), nt], "2026-09-01").observation), "filed-late");
  check("filed by the original deadline -> on time", obsCase(run([filing("10-Q", "2026-08-10", "2026-06-30")], "2026-09-01").observation), "on-time");
  check("filed late with no 12b-25 -> filed late · received", obsCase(run([filing("10-Q", "2026-08-12", "2026-06-30")], "2026-09-01").observation), "filed-late");
  check("non-accelerated filer: 45 days for a 10-Q", reportDeadline("10-Q", "2026-06-30", "Non-accelerated filer<br>Smaller reporting company", null)!.deadline, "2026-08-14");
  check("no filer category -> not measurable", run([], "2026-08-11").observation.measurable && requiredReport({ filings: base, category: null, assessmentDate: "2026-08-11", calendar: filingCalendar({ filings: base, fiscalYearEnd: "1231", assessmentDate: "2026-08-11", appProjection: null, fyChangeHits: [] }) }).observation.measurable, false);
}

// ------------------------------------------------------------------ R3
console.log("\n=== R3 finance arms (Ford, GM): one scope ===");
{
  const split = { finance: "f:FordCreditMember", nonFinance: "f:CompanyExcludingFordCreditMember" };
  const debt = ["us-gaap:DebtCurrent", "us-gaap:LongTermDebtAndCapitalLeaseObligations"];
  const liq = ["us-gaap:CashAndCashEquivalentsAtCarryingValue", "us-gaap:MarketableSecuritiesCurrent"];
  const facts = [
    { concept: "us-gaap:DebtCurrent", member: split.nonFinance, value: 3268 },
    { concept: "us-gaap:DebtCurrent", member: split.finance, value: 47523 },
    { concept: "us-gaap:LongTermDebtAndCapitalLeaseObligations", member: split.nonFinance, value: 16327 },
    { concept: "us-gaap:LongTermDebtAndCapitalLeaseObligations", member: split.finance, value: 90008 },
    { concept: "us-gaap:CashAndCashEquivalentsAtCarryingValue", member: split.nonFinance, value: 14000 },
    { concept: "us-gaap:MarketableSecuritiesCurrent", member: split.nonFinance, value: 9000 },
  ];
  const ok = financeScope(split, debt, liq, facts);
  check("both sides on the operating-company member -> separable, same scope", [ok.separable, ok.exFinanceDebt, ok.exFinanceLiquidity, ok.consolidatedDebt], [true, 19595, 23000, 157126]);
  const noCash = financeScope(split, debt, liq, facts.filter((f) => f.concept !== "us-gaap:MarketableSecuritiesCurrent"));
  check("operating-company liquidity not filed -> not separable, nothing mixed", [noCash.separable, noCash.exFinanceDebt, noCash.exFinanceLiquidity], [false, null, null]);
  const inst: FilingInstance = {
    byteSize: 0,
    contexts: new Map<string, XbrlContext>([
      ["a", { members: { "us-gaap:StatementBusinessSegmentsAxis": split.nonFinance }, end: "2026-03-31" }],
      ["b", { members: { "us-gaap:StatementBusinessSegmentsAxis": split.nonFinance, "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember" }, end: "2026-03-31" }],
      ["c", { members: { "us-gaap:StatementBusinessSegmentsAxis": split.finance, "us-gaap:DebtInstrumentAxis": "f:NotesMember" }, end: "2026-03-31" }],
      ["d", { members: {}, end: "2026-03-31" }],
    ]),
    facts: [
      { concept: "us-gaap:DebtCurrent", contextRef: "a", value: 1 },
      { concept: "us-gaap:LongTermDebtAndCapitalLeaseObligations", contextRef: "b", value: 2 },
      { concept: "us-gaap:DebtCurrent", contextRef: "c", value: 3 },
      { concept: "us-gaap:DebtCurrent", contextRef: "d", value: 4 },
    ],
  };
  check("axis facts: the business axis alone (with Ford's consolidation-items member accepted)", axisFacts(inst, "us-gaap:StatementBusinessSegmentsAxis", "2026-03-31", debt), [
    { concept: "us-gaap:DebtCurrent", member: split.nonFinance, value: 1 },
    { concept: "us-gaap:LongTermDebtAndCapitalLeaseObligations", member: split.nonFinance, value: 2 },
  ]);
  const rec: FixtureRecord = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/verdict-s5/today.json"), "utf8")).find((r: FixtureRecord) => r.ticker === "NVDA");
  const x = frozenToInputs(rec);
  x.netDebt = { now: null, yearAgo: null };
  x.dataQuality.financeArmDebtNotSeparable = true;
  check("not separable -> net debt unavailable, evidence Limited (finance-arm debt not separable)", runVerdict(x).nexCore.evidence.reasons.includes("finance-arm debt not separable"), true);
}

// ------------------------------------------------------------------ R4 / M / D (balance-sheet reads)
console.log("\n=== R4 restricted cash, M marketable securities, D missing debt ===");
function extract(lines: [string, string, boolean?][], instants: Record<string, number>, date = "2026-07-31", accn = "0000000000-26-900001"): FilingStatementExtract {
  return {
    version: 4,
    accessionNumber: accn,
    form: "10-Q",
    reportDate: date,
    filingDate: "2026-08-27",
    incomeStatement: null,
    facts: {},
    acquisitions: null,
    balanceSheet: { role: "bs", roleDefinition: "Balance sheet", dates: [date], lines: lines.map(([element, caption, total]) => ({ element, caption, total: !!total })) },
    instants: Object.fromEntries(Object.entries(instants).map(([k, v]) => [k, [{ end: date, value: v }]])),
    instantCaptions: {},
    instanceBytes: 0,
    requests: 0,
  };
}
{
  // HPQ: face line includes restricted cash; the filing discloses restricted cash separately -> subtracted.
  const hpq = extract(
    [["us-gaap:CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "Cash, cash equivalents and restricted cash"], ["us-gaap:AssetsCurrent", "Total current assets", true], ["us-gaap:Assets", "Total assets", true], ["us-gaap:LongTermDebtNoncurrent", "Long-term debt"]],
    { "us-gaap:CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents": 2874, "us-gaap:RestrictedCashAndCashEquivalentsAtCarryingValue": 3, "us-gaap:AssetsCurrent": 30000, "us-gaap:Assets": 40000, "us-gaap:LongTermDebtNoncurrent": 9600 }
  );
  const p = readBalanceSheetPeriod(hpq, "2026-07-31", "Q3 FY26", 50000);
  const r = restrictedCash(p, hpq, "2026-07-31", null);
  check("R4 case 1 (HPQ): separate restricted cash subtracted", [r.case, r.cashUsed, r.liquidity, r.notSeparated, r.label], ["separate-fact-subtracted", 2871, 2871, false, null]);
  // SBUX / LULU / MMM: face line includes restricted cash, nothing separate.
  const sbux = extract(
    [["us-gaap:CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "Cash and cash equivalents"], ["us-gaap:ShortTermInvestments", "Short-term investments"], ["us-gaap:AssetsCurrent", "Total current assets", true], ["us-gaap:Assets", "Total assets", true]],
    { "us-gaap:CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents": 3450, "us-gaap:ShortTermInvestments": 160, "us-gaap:AssetsCurrent": 9000, "us-gaap:Assets": 30000 }
  );
  const ps = readBalanceSheetPeriod(sbux, "2026-07-31", "Q3 FY26", 9000);
  const rs = restrictedCash(ps, sbux, "2026-07-31", null);
  check("R4 case 3 (SBUX/LULU/MMM): face value used, labelled, not separated", [rs.case, rs.liquidity, rs.label, rs.notSeparated], ["face-includes-restricted", 3610, RESTRICTED_LABEL, true]);
  check("R4 case 3 label wording", RESTRICTED_LABEL, "includes restricted cash not separately disclosed");
  // A plain cash line: used as filed.
  const plain = extract(
    [["us-gaap:CashAndCashEquivalentsAtCarryingValue", "Cash and cash equivalents"], ["us-gaap:MarketableSecuritiesCurrent", "Marketable securities"], ["us-gaap:AssetsCurrent", "Total current assets", true], ["us-gaap:Assets", "Total assets", true]],
    { "us-gaap:CashAndCashEquivalentsAtCarryingValue": 11600, "us-gaap:MarketableSecuritiesCurrent": 45000, "us-gaap:AssetsCurrent": 90000, "us-gaap:Assets": 120000 }
  );
  const pp = readBalanceSheetPeriod(plain, "2026-07-31", "Q2 FY27", 300000);
  const rp = restrictedCash(pp, plain, "2026-07-31", null);
  check("R4 case 2: a cash line with no restricted component is used as filed", [rp.case, rp.notSeparated], ["no-restricted-component", false]);
  check("M (NVDA): short-term marketable securities count in liquidity", [liquidityWithSecurities(pp), pp.investmentLines.map((l) => l.element)], [56600, ["us-gaap:MarketableSecuritiesCurrent"]]);
  // A restricted line with no cash line and no combined face line fits none of the three cases.
  const odd = extract(
    [["us-gaap:RestrictedCashCurrent", "Restricted cash"], ["us-gaap:AssetsCurrent", "Total current assets", true], ["us-gaap:Assets", "Total assets", true]],
    { "us-gaap:RestrictedCashCurrent": 10, "us-gaap:AssetsCurrent": 100, "us-gaap:Assets": 200 }
  );
  const ro = restrictedCash(readBalanceSheetPeriod(odd, "2026-07-31", "Q", 100), odd, "2026-07-31", null);
  check("R4: a filing that fits none of the cases is reported, not resolved", [ro.case, ro.liquidity, ro.unresolved !== null], [null, null, true]);
  // D
  check("D: no debt concept anywhere in the filing -> debt 0", debtWithoutLine(debtConceptsInFiling({ facts: [{ concept: "us-gaap:Assets", contextRef: "x", value: 1 }] })), { debt: 0, why: "no debt concept anywhere in the filing: debt 0" });
  check(
    "D: a debt concept in the filing (even dimensional) but no debt line -> not measurable",
    debtWithoutLine(debtConceptsInFiling({ facts: [{ concept: "us-gaap:LongTermDebt", contextRef: "dim", value: 500 }] })).debt,
    null
  );
  // Strict presentation.
  const strict = extract([["us-gaap:Assets", "Total assets", true]], { "us-gaap:Assets": 1, "us-gaap:LiabilitiesAndStockholdersEquity": 1 });
  strict.instants["us-gaap:Assets"].push({ end: "2025-07-31", value: 1 });
  check("a filing with an Assets fact but no total liabilities and equity at a date does not present it", [presentsDate(strict, "2026-07-31"), presentsDate(strict, "2025-07-31")], [true, false]);
}

// ------------------------------------------------------------------ R5
console.log("\n=== R5 stale quarters rebuilt from year-to-date values ===");
{
  const subs: CompanySubmissions = {
    cik: "0000000001",
    name: "Test",
    tickers: [],
    exchanges: [],
    sic: "2080",
    sicDescription: "",
    category: "Large accelerated filer",
    fiscalYearEnd: "1231",
    filings: [
      filing("10-Q", "2026-07-29", "2026-06-30"),
      filing("10-Q", "2026-04-29", "2026-03-31"),
      filing("10-K", "2026-02-20", "2025-12-31"),
      filing("10-Q", "2025-10-29", "2025-09-30"),
      filing("10-Q", "2025-07-29", "2025-06-30"),
      filing("10-Q", "2025-04-29", "2025-03-31"),
      filing("10-K", "2025-02-20", "2024-12-31"),
    ],
  };
  const [q2, q1, k25, q325, q225, q125, k24] = subs.filings;
  const pt = (f: FilingEntry, end: string, val: number, start?: string): FactPoint => ({ ...(start ? { start } : {}), end, val, accn: f.accessionNumber, fy: Number(f.reportDate.slice(0, 4)), fp: "Q1", form: f.form, filed: f.filingDate });
  // Company facts stop at Q1 2026 (the Q2 10-Q is filed but not aggregated).
  const ocf: FactPoint[] = [
    pt(q125, "2025-03-31", 100, "2025-01-01"),
    pt(q225, "2025-06-30", 250, "2025-01-01"),
    pt(q325, "2025-09-30", 420, "2025-01-01"),
    pt(k25, "2025-12-31", 600, "2025-01-01"),
    pt(k24, "2024-12-31", 500, "2024-01-01"),
    pt(q1, "2026-03-31", 120, "2026-01-01"),
  ];
  const anchors = (f: FilingEntry) => pt(f, f.reportDate, 1000);
  const facts: CompanyFacts = {
    cik: "0000000001",
    entityName: "Test",
    raw: {
      cik: 1,
      entityName: "Test",
      facts: {
        "us-gaap": {
          NetCashProvidedByUsedInOperatingActivities: { units: { USD: ocf } },
          Assets: { units: { USD: [q1, k25, q325, q225, q125, k24].map(anchors) } },
        },
      },
    },
  };
  const kf = buildKeyFinancials(facts, periodicFilings(subs), subs.fiscalYearEnd);
  const newer = newerFilingNotIncorporated(kf);
  check("a filed 10-Q not yet in company facts is detected", newer?.filing.reportDate, "2026-06-30");
  const x = extract([["us-gaap:Assets", "Total assets", true]], { "us-gaap:Assets": 1100 }, "2026-06-30", q2.accessionNumber);
  x.facts = {
    "us-gaap:NetCashProvidedByUsedInOperatingActivities": [
      { start: "2026-01-01", end: "2026-06-30", value: 310 },
      { start: "2025-01-01", end: "2025-06-30", value: 250 },
    ],
  };
  const c = checkOcfRebuild(facts, x, newer!, kf.lookbackPeriods);
  check("fiscal-period and reconciliation checks pass; quarter = 310 − 120", [c.ok, c.quarter, c.comparative?.companyFacts], [true, 190, 250]);
  const rebuilt = withFilingFacts(facts, x, newer!);
  const kfR = buildKeyFinancials(rebuilt, periodicFilings(subs), subs.fiscalYearEnd);
  check("rebuilt: the newer quarter is published and its operating cash flow is derived from year-to-date", [kfR.quarters[0].periodEnd, kfR.operatingCashFlow.values[0]?.value, kfR.operatingCashFlow.values[0]?.method], ["2026-06-30", 190, "ytd-subtraction"]);
  check("rebuilt: nothing stale any more", newerFilingNotIncorporated(kfR), null);
  check("the input facts are not changed", facts.raw.facts["us-gaap"].NetCashProvidedByUsedInOperatingActivities.units.USD.length, 6);
  const recast = structuredClone(x);
  recast.facts["us-gaap:NetCashProvidedByUsedInOperatingActivities"][1].value = 260;
  check("reconciliation fails when the filing's comparative differs from company facts", checkOcfRebuild(facts, recast, newer!, kf.lookbackPeriods).ok, false);
  const shifted = structuredClone(x);
  shifted.facts["us-gaap:NetCashProvidedByUsedInOperatingActivities"][0].start = "2026-01-02";
  check("fiscal-period check fails when the year-to-date start differs from the prior quarter's", checkOcfRebuild(facts, shifted, newer!, kf.lookbackPeriods).ok, false);
  const none = structuredClone(x);
  none.facts = {};
  check("no year-to-date operating cash flow in the filing -> not rebuilt", checkOcfRebuild(facts, none, newer!, kf.lookbackPeriods).ok, false);
}

// ------------------------------------------------------------------ R6
console.log("\n=== R6 R&D tag precedence ===");
{
  const w = (vals: (number | null)[]) => vals;
  const pfe = chooseRdTag(
    [
      { tag: RD_TAGS[0], values: w([null, null, null]) },
      { tag: RD_TAGS[1], values: w([2800, 2700, 2600]) },
      { tag: RD_TAGS[2], values: w([5, 5, 5]) },
    ],
    [],
    "2023-09-30"
  );
  check("PFE: the first tag with a quarterly value wins, used for every quarter, never summed", [pfe.tag, pfe.values, pfe.status], [RD_TAGS[1], [2800, 2700, 2600], "quarterly"]);
  const first = chooseRdTag([{ tag: RD_TAGS[0], values: w([1, null, 3]) }, { tag: RD_TAGS[1], values: w([10, 20, 30]) }], [], "2023-09-30");
  check("the precedence tag wins even when a later tag covers more quarters", [first.tag, first.values], [RD_TAGS[0], [1, null, 3]]);
  const annual = chooseRdTag([{ tag: RD_TAGS[0], values: w([null, null]) }], [{ start: "2025-01-01", end: "2025-12-31" }], "2023-09-30");
  check("annual R&D only inside the window -> annual only", annual.status, "annual only");
  const old = chooseRdTag([{ tag: RD_TAGS[0], values: w([null, null]) }], [{ start: "2013-01-01", end: "2013-12-31" }], "2023-09-30");
  check("R&D filed only before the window -> not filed in the window", old.status, "not filed in the window");
  check("no R&D tag ever -> not filed", chooseRdTag([{ tag: RD_TAGS[0], values: w([null]) }], [], "2023-09-30").status, "not filed");
}

// ------------------------------------------------------------------ H
console.log("\n=== H historical reads ===");
{
  const before = filing("8-K", "2025-06-27", "", "2.04");
  const after = filing("8-K", "2026-06-01", "", "1.03");
  const subs: CompanySubmissions = { cik: "1", name: "", tickers: [], exchanges: [], sic: "", sicDescription: "", category: null, fiscalYearEnd: null, filings: [after, before] };
  const asOf = submissionsAsOf(subs, "2026-05-11");
  check("only filings on or before the vantage date are read", asOf.filings.map((f) => f.filingDate), ["2025-06-27"]);
  check("EchoStar-style: Critical comes only from the pre-vantage 8-K", criticalFilings(asOf, "2026-05-11").map((c) => [c.item, c.filingDate]), [["2.04", "2025-06-27"]]);
  check("a Critical 8-K older than 12 months does not count", criticalFilings(asOf, "2026-07-01").length, 0);
  const facts: CompanyFacts = {
    cik: "1",
    entityName: "",
    raw: { cik: 1, entityName: "", facts: { "us-gaap": { Assets: { units: { USD: [{ end: "2026-03-31", val: 1, accn: "a", fy: 2026, fp: "Q1", form: "10-Q", filed: "2026-05-01" }, { end: "2026-06-30", val: 2, accn: "b", fy: 2026, fp: "Q2", form: "10-Q", filed: "2026-08-01" }] } } } } },
  };
  check("company facts filed after the vantage date are dropped", factsAsOf(facts, "2026-05-11").raw.facts["us-gaap"].Assets.units.USD.map((p) => p.end), ["2026-03-31"]);
  // A report filed after the vantage date never clears a MISSED FILING in the earlier assessment.
  const base = [filing("10-Q", "2026-09-15", "2026-06-30"), filing("10-Q", "2026-05-07", "2026-03-31"), filing("10-K", "2026-02-20", "2025-12-31"), filing("10-K", "2025-02-20", "2024-12-31")];
  const at = (d: string) => {
    const s = submissionsAsOf({ ...subs, filings: base }, d).filings;
    return requiredReport({ filings: s, category: "Large accelerated filer", assessmentDate: d, calendar: filingCalendar({ filings: s, fiscalYearEnd: "1231", assessmentDate: d, appProjection: null, fyChangeHits: [] }) }).observation;
  };
  check("as of 1 Sep 2026 (10-Q filed 15 Sep): overdue", obsCase(at("2026-09-01")), "overdue");
  check("as of 1 Oct 2026: filed late · received", obsCase(at("2026-10-01")), "filed-late");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
