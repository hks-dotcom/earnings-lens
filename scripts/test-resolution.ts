// Unit tests for the resolution rules the statements rest on, which apply
// to Key financials as well. No network calls.
//
// - The nil rule: a missing prior year-to-date cash-flow figure counts as
//   nil only when (a) that quarter's filing is published, (b) no candidate
//   tag has a value for it, and (c) the filer has used the tag in a 10-Q
//   before. Each condition is broken on its own to show it matters.
// - Splice recency: two tags must agree in the most recent period both
//   report, whatever they did earlier.
// - Cross-tag year-to-date subtraction: a proven splice lets one tag's
//   year-to-date figure be reduced by the other tag's prior one.
//
// Usage: npx tsx scripts/test-resolution.ts

import { CompanyFacts, FactPoint } from "@/lib/edgar/companyFacts";
import { FilingEntry } from "@/lib/edgar/submissions";
import { FilingPeriod, FiscalPeriodLabel } from "@/lib/xbrl/periods";
import { resolveDurationSeries, resolveInstantSeries, tagsAgree } from "@/lib/xbrl/keyFinancials";

let pass = 0;
let fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${ok ? "" : `\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`}`);
  if (ok) pass++;
  else fail++;
}

const M = 1_000_000;

function filing(form: string, reportDate: string, filingDate: string): FilingEntry {
  return {
    accessionNumber: `acc-${reportDate}`,
    filingDate,
    reportDate,
    acceptanceDateTime: "",
    form,
    items: "",
    primaryDocument: "doc.htm",
    primaryDocDescription: "",
    isXBRL: true,
  };
}

function period(fp: FiscalPeriodLabel, fy: number, reportDate: string, filingDate: string): FilingPeriod {
  const f = filing(fp === "FY" ? "10-K" : "10-Q", reportDate, filingDate);
  return { filing: f, fy, fp, label: `${fp === "FY" ? "Q4" : fp} FY${String(fy).slice(-2)}`, placed: true };
}

// Fiscal year = calendar year. Newest first, as the app keeps them.
const FY26 = period("FY", 2026, "2026-12-31", "2027-02-10");
const Q3 = period("Q3", 2026, "2026-09-30", "2026-10-30");
const Q2 = period("Q2", 2026, "2026-06-30", "2026-07-31");
const Q1 = period("Q1", 2026, "2026-03-31", "2026-04-30");
const Q2_25 = period("Q2", 2025, "2025-06-30", "2025-07-31");
const ALL = [FY26, Q3, Q2, Q1, Q2_25];

function pt(start: string | undefined, end: string, val: number, form: string, filed: string): FactPoint {
  return { start, end, val, accn: `acc-${end}`, fy: Number(end.slice(0, 4)), fp: "", form, filed };
}

function facts(byTag: Record<string, FactPoint[]>): CompanyFacts {
  const usgaap: Record<string, { units: Record<string, FactPoint[]> }> = {};
  for (const [tag, points] of Object.entries(byTag)) usgaap[tag] = { units: { USD: points } };
  return { cik: "0", entityName: "Test", raw: { cik: 0, entityName: "Test", facts: { "us-gaap": usgaap } } } as unknown as CompanyFacts;
}

const TAG = "ProceedsFromIssuanceOfLongTermDebt";
const EARLIER_10Q = pt("2025-01-01", "2025-06-30", 500 * M, "10-Q", "2025-07-31");
const Q2_YTD = pt("2026-01-01", "2026-06-30", 800 * M, "10-Q", "2026-07-31");

const resolveQ2 = (f: CompanyFacts, all: FilingPeriod[] = ALL, cashFlow = true, tags = [TAG]) =>
  resolveDurationSeries(f, tags, [Q2], all, { cashFlow }).values[0];

console.log("=== The nil rule ===");
check(
  "Q1 not filed, all three conditions hold -> Q2 = the six-month figure, marked nil",
  resolveQ2(facts({ [TAG]: [EARLIER_10Q, Q2_YTD] })),
  { value: 800 * M, concept: TAG, method: "ytd-subtraction", derived: true, nilPeriods: ["Q1 FY26"] }
);
check(
  "(a) Q1's filing not published -> MISSING",
  resolveQ2(facts({ [TAG]: [EARLIER_10Q, Q2_YTD] }), [FY26, Q3, Q2, Q2_25]),
  undefined
);
check(
  "(b) another candidate tag has a Q1 value -> MISSING",
  resolveQ2(
    facts({ [TAG]: [EARLIER_10Q, Q2_YTD], ProceedsFromIssuanceOfDebt: [pt("2026-01-01", "2026-03-31", 90 * M, "10-Q", "2026-04-30")] }),
    ALL,
    true,
    [TAG, "ProceedsFromIssuanceOfDebt"]
  ),
  undefined
);
check(
  "(c) the tag has only ever been used in a 10-K -> MISSING",
  resolveQ2(facts({ [TAG]: [pt("2025-01-01", "2025-12-31", 500 * M, "10-K", "2026-02-10"), Q2_YTD] })),
  undefined
);
check(
  "(c) a 10-Q use AFTER the gap doesn't count -> MISSING",
  resolveQ2(facts({ [TAG]: [Q2_YTD] })),
  undefined
);
check(
  "not a cash-flow row -> the rule doesn't apply -> MISSING",
  resolveQ2(facts({ [TAG]: [EARLIER_10Q, Q2_YTD] }), ALL, false),
  undefined
);
check(
  "Q1 filed -> ordinary subtraction, nothing read as nil",
  resolveQ2(facts({ [TAG]: [EARLIER_10Q, pt("2026-01-01", "2026-03-31", 300 * M, "10-Q", "2026-04-30"), Q2_YTD] })),
  { value: 500 * M, concept: TAG, method: "ytd-subtraction", derived: true }
);
check(
  "Q4: nine-month figure not filed -> Q4 = the annual figure, marked nil",
  resolveDurationSeries(
    facts({ [TAG]: [EARLIER_10Q, pt("2026-01-01", "2026-12-31", 1_200 * M, "10-K", "2027-02-10")] }),
    [TAG],
    [FY26],
    ALL,
    { cashFlow: true }
  ).values[0],
  { value: 1_200 * M, concept: TAG, method: "annual-minus-9mo", derived: true, nilPeriods: ["Q3 FY26"] }
);
check(
  "the period's OWN figure is never read as nil: Q2 not filed -> MISSING",
  resolveQ2(facts({ [TAG]: [EARLIER_10Q, pt("2026-01-01", "2026-03-31", 300 * M, "10-Q", "2026-04-30")] })),
  undefined
);

console.log("\n=== Splice recency ===");
const inst = (end: string, val: number, filed: string) => pt(undefined, end, val, "10-Q", filed);
const key = (p: FactPoint) => p.end;
check(
  "agreed in 2024, disagree in the most recent shared period -> no splice",
  tagsAgree([inst("2024-12-31", 100 * M, "2025-02-01"), inst("2025-12-31", 200 * M, "2026-02-01")], [inst("2024-12-31", 100 * M, "2025-02-01"), inst("2025-12-31", 250 * M, "2026-02-01")], key),
  false
);
check(
  "disagreed in 2024, agree in the most recent shared period -> splice",
  tagsAgree([inst("2024-12-31", 100 * M, "2025-02-01"), inst("2025-12-31", 200 * M, "2026-02-01")], [inst("2024-12-31", 150 * M, "2025-02-01"), inst("2025-12-31", 200.5 * M, "2026-02-01")], key),
  true
);
check(
  "a restatement counts: the latest-filed value at the shared period decides",
  tagsAgree([inst("2025-12-31", 200 * M, "2026-02-01"), inst("2025-12-31", 260 * M, "2026-05-01")], [inst("2025-12-31", 260 * M, "2026-02-01")], key),
  true
);
check("no shared period -> no splice", tagsAgree([inst("2024-12-31", 1, "2025-02-01")], [inst("2025-12-31", 1, "2026-02-01")], key), false);
{
  // Row: primary covers the latest balance, the second tag fills an older gap only if the tags agree recently.
  const A = "ShortTermBorrowings";
  const B = "CommercialPaper";
  const disp = [Q2, Q1];
  const f = (bRecent: number) =>
    facts({
      [A]: [inst("2026-06-30", 10 * M, "2026-07-31"), inst("2025-12-31", 20 * M, "2026-02-10")],
      [B]: [inst("2026-03-31", 30 * M, "2026-04-30"), inst("2025-12-31", bRecent, "2026-02-10"), inst("2024-12-31", 5 * M, "2025-02-10")],
    });
  check("an instant row splices a gap when the tags agree recently", resolveInstantSeries(f(20 * M), [A, B], disp).values[1]?.method, "spliced");
  check("... and leaves it MISSING when they don't", resolveInstantSeries(f(21.5 * M), [A, B], disp).values[1], undefined);
}

console.log("\n=== Cross-tag year-to-date subtraction ===");
{
  const NEW = "PaymentsToAcquireProductiveAssets";
  const OLD = "PaymentsToAcquirePropertyPlantAndEquipment";
  // The filer switched tags in Q2: Q1's year-to-date is under the old tag,
  // the six-month figure under the new one. They agree on FY25, the most
  // recent period both report.
  const f = (fy25New: number) =>
    facts({
      [NEW]: [pt("2026-01-01", "2026-06-30", 900 * M, "10-Q", "2026-07-31"), pt("2025-01-01", "2025-12-31", fy25New, "10-Q", "2026-07-31")],
      [OLD]: [pt("2026-01-01", "2026-03-31", 400 * M, "10-Q", "2026-04-30"), pt("2025-01-01", "2025-12-31", 1_500 * M, "10-K", "2026-02-10")],
    });
  check(
    "proven splice -> Q2 = new tag's six months − old tag's Q1",
    resolveDurationSeries(f(1_500 * M), [NEW, OLD], [Q2], ALL, { cashFlow: true }).values[0],
    { value: 500 * M, concept: NEW, method: "spliced-ytd", derived: true, splicedWith: OLD }
  );
  check(
    "tags disagree in the most recent shared period -> MISSING",
    resolveDurationSeries(f(1_600 * M), [NEW, OLD], [Q2], ALL, { cashFlow: true }).values[0],
    undefined
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
