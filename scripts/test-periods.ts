// Placing a filing in a fiscal calendar, and the lookback window the debt
// tile reads. Synthetic company facts throughout -- no network calls.
//
// Each block here is a bug that reached the screen. The comment on each
// says which company found it, so a future change that reintroduces one
// fails against the real case rather than against an abstraction.
//
// Usage: npx tsx scripts/test-periods.ts

import { CompanyFacts, FactPoint } from "@/lib/edgar/companyFacts";
import { CompanySubmissions, FilingEntry } from "@/lib/edgar/submissions";
import { buildFiscalCalendar, buildFilingPeriods, DURATION_WINDOWS } from "@/lib/xbrl/periods";
import { buildKeyFinancials } from "@/lib/xbrl/keyFinancials";
import { computeRedFlags } from "@/lib/rules/redFlags";

let pass = 0;
let fail = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}  (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  if (ok) pass++;
  else fail++;
}

// --- Synthetic filings and facts -----------------------------------------

function filing(form: string, reportDate: string, filingDate: string, accn: string): FilingEntry {
  return {
    form,
    reportDate,
    filingDate,
    accessionNumber: accn,
    primaryDocument: `${accn}.htm`,
    items: "",
    acceptanceDateTime: `${filingDate}T16:00:00.000Z`,
    primaryDocDescription: form,
    isXBRL: true,
  };
}

interface FactSpec {
  concept: string;
  accn: string;
  end: string;
  start?: string;
  fy?: number;
  fp?: string;
  val?: number;
}

/** A CompanyFacts whose us-gaap facts are exactly the ones listed. */
function facts(specs: FactSpec[]): CompanyFacts {
  const us: Record<string, { units: Record<string, FactPoint[]> }> = {};
  for (const s of specs) {
    const point: FactPoint = {
      start: s.start,
      end: s.end,
      val: s.val ?? 1,
      accn: s.accn,
      fy: s.fy ?? 2026,
      fp: s.fp ?? "Q1",
      form: "10-Q",
      filed: s.end,
    };
    us[s.concept] ??= { units: { USD: [] } };
    us[s.concept].units.USD.push(point);
  }
  return {
    cik: "0000000001",
    entityName: "Test Co",
    raw: { cik: 1, entityName: "Test Co", facts: { "us-gaap": us } },
  } as unknown as CompanyFacts;
}

function labels(f: CompanyFacts, filings: FilingEntry[], fiscalYearEnd: string | null): string[] {
  const calendar = buildFiscalCalendar(f, filings, fiscalYearEnd);
  return buildFilingPeriods(calendar, filings).map((p) => p.label);
}

// --- 1. A filing company facts has not aggregated yet ---------------------
//
// Coca-Cola and PayPal. The 10-Q is in the submissions feed the day it is
// filed; its facts reach the company-facts aggregate days later. The old
// code placed a filing by finding an anchor fact carrying its accession,
// so in that window the newest 10-Q had no label and was dropped on the
// floor -- and the deadline check, projecting from the quarter before it,
// announced a missed deadline for a report the company had already filed.

console.log("=== A just-filed 10-Q that company facts has not aggregated yet ===");

const KO_FILINGS = [
  filing("10-Q", "2026-07-03", "2026-07-29", "accn-new"), // filed; no facts yet
  filing("10-Q", "2026-04-03", "2026-04-30", "accn-q1"),
  filing("10-K", "2025-12-31", "2026-02-20", "accn-fy"),
  filing("10-Q", "2025-09-26", "2025-10-23", "accn-q3"),
];
const KO_FACTS = facts([
  { concept: "NetIncomeLoss", accn: "accn-q1", end: "2026-04-03", start: "2026-01-01", fy: 2026, fp: "Q1" },
  { concept: "NetIncomeLoss", accn: "accn-fy", end: "2025-12-31", start: "2025-01-01", fy: 2025, fp: "FY" },
  { concept: "NetIncomeLoss", accn: "accn-q3", end: "2025-09-26", start: "2025-01-01", fy: 2025, fp: "Q3" },
]);

const koCalendar = buildFiscalCalendar(KO_FACTS, KO_FILINGS, "1231");
const koPeriods = buildFilingPeriods(koCalendar, KO_FILINGS);
check("every filing is placed, including the unaggregated one", koPeriods.length, KO_FILINGS.length);
check("the unaggregated 10-Q gets its own label", koPeriods[0].label, "Q2 FY26");
check("and is marked placed", koPeriods[0].placed, true);

const koKf = buildKeyFinancials(KO_FACTS, KO_FILINGS, "1231");
check("the lookback leads with the newest FILING", koKf.lookbackPeriods[0].filing.reportDate, "2026-07-03");
check("the published list leads with the newest quarter that has figures", koKf.publishedPeriods[0].filing.reportDate, "2026-04-03");
check("so the board shows the last published quarter, not a column of blanks", koKf.quarters[0].periodEnd, "2026-04-03");

const koSubs = { category: "Large accelerated filer", filings: KO_FILINGS } as unknown as CompanySubmissions;
const koFlags = computeRedFlags(koSubs, koKf.lookbackPeriods[0], ["2025-12-31"], new Date("2026-09-21T00:00:00Z"));
check("no missed-deadline flag: the deadline projects from the filing that exists", koFlags.findings.length, 0);

// The old failure, reproduced: project from the quarter BEFORE the new
// filing and the same date does read as a missed deadline. This is what
// makes the test above meaningful rather than vacuous.
const koFlagsStale = computeRedFlags(koSubs, koKf.publishedPeriods[0], ["2025-12-31"], new Date("2026-09-21T00:00:00Z"));
check("(control) projecting from the dropped-filing state DOES flag a miss", koFlagsStale.findings.map((f) => f.type), ["missed-deadline"]);

// --- 2. A filing that cannot be placed at all -----------------------------

console.log("\n=== A filing with no fiscal calendar to place it against ===");

const LONE_FILINGS = [filing("10-Q", "2026-07-03", "2026-07-29", "accn-lone")];
const loneCalendar = buildFiscalCalendar(facts([]), LONE_FILINGS, null);
const lonePeriods = buildFilingPeriods(loneCalendar, LONE_FILINGS);
check("it is still returned, never dropped", lonePeriods.length, 1);
check("but marked unplaced", lonePeriods[0].placed, false);

const loneSubs = { category: "Large accelerated filer", filings: LONE_FILINGS } as unknown as CompanySubmissions;
const loneFlags = computeRedFlags(loneSubs, lonePeriods[0], [], new Date("2027-09-21T00:00:00Z"));
check("and the missed-deadline check refuses to run on it", loneFlags.findings.length, 0);

// --- 3. Two quarters, one EDGAR label ------------------------------------
//
// Oracle. Its fiscal year ends in May, and it tagged the quarter ended
// August 2026 with the same DocumentFiscalYearFocus it used for the
// quarter ended August 2025: fy2026/Q1. Reading that tag put two different
// quarters in the five-quarter window under one heading -- and worse, the
// Q4 derivation looked up "Q1 of fy2026", found the WRONG one, and
// subtracted a quarter from the wrong year out of the annual figure.

console.log("=== Oracle: two quarters EDGAR tags fy2026/Q1 ===");

const ORCL_FILINGS = [
  filing("10-Q", "2026-08-31", "2026-09-11", "o-q1-27"),
  filing("10-K", "2026-05-31", "2026-06-22", "o-fy26"),
  filing("10-Q", "2026-02-28", "2026-03-11", "o-q3-26"),
  filing("10-Q", "2025-11-30", "2025-12-11", "o-q2-26"),
  filing("10-Q", "2025-08-31", "2025-09-10", "o-q1-26"),
];
const ORCL_FACTS = facts([
  { concept: "NetIncomeLoss", accn: "o-q1-27", end: "2026-08-31", fy: 2026, fp: "Q1" }, // EDGAR's own collision
  { concept: "NetIncomeLoss", accn: "o-fy26", end: "2026-05-31", fy: 2026, fp: "FY" },
  { concept: "NetIncomeLoss", accn: "o-q3-26", end: "2026-02-28", fy: 2026, fp: "Q3" },
  { concept: "NetIncomeLoss", accn: "o-q2-26", end: "2025-11-30", fy: 2026, fp: "Q2" },
  { concept: "NetIncomeLoss", accn: "o-q1-26", end: "2025-08-31", fy: 2026, fp: "Q1" },
]);
const orclLabels = labels(ORCL_FACTS, ORCL_FILINGS, "0531");
check("five quarters, five distinct headings", new Set(orclLabels).size, 5);
check("the headings", orclLabels, ["Q1 FY27", "Q4 FY26", "Q3 FY26", "Q2 FY26", "Q1 FY26"]);

// --- 4. A 10-K the filer tagged with the wrong year -----------------------
//
// Salesforce. Its 10-K for the year it calls fiscal 2026 carries fy=2025,
// while every 10-Q around it is tagged correctly. The mislabelled 10-K
// went looking for "Q1 of fy2025", found nothing, and gave up: no derived
// Q4 operating income, so no trailing-twelve-month EBIT, so no Altman Z''
// at all. A single wrong tag emptied the whole risk axis.

console.log("\n=== Salesforce: a 10-K tagged a year behind its own quarters ===");

const CRM_FILINGS = [
  filing("10-Q", "2026-07-31", "2026-08-27", "c-q2-27"),
  filing("10-Q", "2026-04-30", "2026-05-28", "c-q1-27"),
  filing("10-K", "2026-01-31", "2026-03-05", "c-fy26"),
  filing("10-Q", "2025-10-31", "2025-12-03", "c-q3-26"),
  filing("10-Q", "2025-07-31", "2025-09-03", "c-q2-26"),
  filing("10-Q", "2025-04-30", "2025-05-29", "c-q1-26"),
];
const CRM_FACTS = facts([
  { concept: "NetIncomeLoss", accn: "c-q2-27", end: "2026-07-31", fy: 2027, fp: "Q2" },
  { concept: "NetIncomeLoss", accn: "c-q1-27", end: "2026-04-30", fy: 2027, fp: "Q1" },
  { concept: "NetIncomeLoss", accn: "c-fy26", end: "2026-01-31", fy: 2025, fp: "FY" }, // the wrong one
  { concept: "NetIncomeLoss", accn: "c-q3-26", end: "2025-10-31", fy: 2026, fp: "Q3" },
  { concept: "NetIncomeLoss", accn: "c-q2-26", end: "2025-07-31", fy: 2026, fp: "Q2" },
  { concept: "NetIncomeLoss", accn: "c-q1-26", end: "2025-04-30", fy: 2026, fp: "Q1" },
]);
const crmLabels = labels(CRM_FACTS, CRM_FILINGS, "0131");
check("one outvoted tag does not move the whole calendar", crmLabels, [
  "Q2 FY27",
  "Q1 FY27",
  "Q4 FY26",
  "Q3 FY26",
  "Q2 FY26",
  "Q1 FY26",
]);

// --- 5. The two fiscal-year naming conventions ---------------------------
//
// NVIDIA's year ending January 2026 is FY26. A filer whose year ends in
// early January and is numbered for the calendar year it mostly covers
// calls the same year FY25. Both are correct, and no amount of date
// arithmetic can tell them apart, so the convention is read off the
// filer's own tags and nothing else is.

console.log("\n=== Both fiscal-year naming conventions ===");

const NVDA_FILINGS = [
  filing("10-Q", "2026-07-26", "2026-08-26", "n-q2"),
  filing("10-K", "2026-01-25", "2026-02-25", "n-fy"),
];
const nvdaLabels = labels(
  facts([
    { concept: "NetIncomeLoss", accn: "n-q2", end: "2026-07-26", fy: 2027, fp: "Q2" },
    { concept: "NetIncomeLoss", accn: "n-fy", end: "2026-01-25", fy: 2026, fp: "FY" },
  ]),
  NVDA_FILINGS,
  "0125"
);
check("year ending Jan 2026 called FY26 (NVIDIA)", nvdaLabels, ["Q2 FY27", "Q4 FY26"]);

const JAN_YEAR_END_FILINGS = [
  filing("10-Q", "2026-07-04", "2026-08-05", "s-q2"),
  filing("10-K", "2026-01-03", "2026-02-04", "s-fy"),
];
const janLabels = labels(
  facts([
    { concept: "NetIncomeLoss", accn: "s-q2", end: "2026-07-04", fy: 2026, fp: "Q2" },
    { concept: "NetIncomeLoss", accn: "s-fy", end: "2026-01-03", fy: 2025, fp: "FY" },
  ]),
  JAN_YEAR_END_FILINGS,
  "0102"
);
check("year ending Jan 2026 called FY25 (the other convention)", janLabels, ["Q2 FY26", "Q4 FY25"]);

// --- 6. A 4-4-5 retail year's third quarter -------------------------------
//
// Costco. Twelve weeks a quarter puts three quarters at 252 days, and the
// old Q3 window started at 255, so the year-to-date cash flow fell through
// it and free cash flow came out missing for every retailer on that
// calendar.

console.log("\n=== A 12+12+12-week year-to-date period ===");
check("Q3 window admits 252 days", DURATION_WINDOWS.Q3[0] <= 252 && 252 <= DURATION_WINDOWS.Q3[1], true);
check("Q2 window still stops well short of it", DURATION_WINDOWS.Q2[1] < DURATION_WINDOWS.Q3[0], true);
check("FY window still starts well past it", DURATION_WINDOWS.Q3[1] < DURATION_WINDOWS.FY[0], true);

// --- 7. The debt lookback boundary ---------------------------------------
//
// "Debt not tagged in filings" versus MISSING turns entirely on whether a
// debt fact falls inside the lookback window. Coca-Cola sits right on it:
// it stopped tagging LongTermDebtNoncurrent in March 2024, just before the
// window opens, and read as a company with no debt at all.

console.log("\n=== The debt lookback boundary ===");

const DEBT_FILINGS = [
  filing("10-Q", "2026-06-30", "2026-07-30", "d-q2"),
  filing("10-Q", "2026-03-31", "2026-04-30", "d-q1"),
  filing("10-K", "2025-12-31", "2026-02-20", "d-fy"),
  filing("10-Q", "2025-09-30", "2025-10-30", "d-q3"),
  filing("10-Q", "2025-06-30", "2025-07-30", "d-q2b"),
];
const OLDEST_END = "2025-06-30"; // the lookback's oldest period end

function debtCase(debtEnd: string | undefined) {
  const specs: FactSpec[] = DEBT_FILINGS.map((f, i) => ({
    concept: "NetIncomeLoss",
    accn: f.accessionNumber,
    end: f.reportDate,
    fy: 2026,
    fp: i === 2 ? "FY" : "Q1",
  }));
  if (debtEnd) specs.push({ concept: "LongTermDebtNoncurrent", accn: "d-old", end: debtEnd, val: 1_000_000 });
  return buildKeyFinancials(facts(specs), DEBT_FILINGS, "1231").debtTagFiledInLookback;
}

check("no debt tag anywhere -> not tagged", debtCase(undefined), false);
check("a debt fact one day BEFORE the window opens -> not tagged", debtCase("2025-06-29"), false);
check("a debt fact exactly ON the window's oldest period end -> tagged", debtCase(OLDEST_END), true);
check("a debt fact one day AFTER the window opens -> tagged", debtCase("2025-07-01"), true);
check("a debt fact at the latest quarter -> tagged", debtCase("2026-06-30"), true);
check("a debt fact years before the window (Coca-Cola's case) -> not tagged", debtCase("2024-03-29"), false);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
