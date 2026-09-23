// Unit tests for lib/metrics/deadlines.ts -- every filer category x
// 10-Q/10-K x normal vs. 52/53-week fiscal year. No network calls.
//
// Usage: npx tsx scripts/test-deadlines.ts

import {
  tenQDeadlineDays,
  tenKDeadlineDays,
  isFloatingFiscalCalendar,
  nextFilingDue,
} from "@/lib/metrics/deadlines";
import { FilingPeriod } from "@/lib/xbrl/periods";
import { FilingEntry } from "@/lib/edgar/submissions";

let pass = 0;
let fail = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}  (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  if (ok) pass++;
  else fail++;
}

// --- Real EDGAR category strings seen across NVDA/MSFT/WMT/UFPT (accelerated
// variants) and RGCO/NAII/GSIT/etc. (non-accelerated, always with the raw
// "<br>Smaller reporting company" suffix EDGAR actually returns). ---
const CATEGORIES = {
  largeAccelerated: "Large accelerated filer",
  accelerated: "Accelerated filer",
  nonAccelerated: "Non-accelerated filer",
  nonAcceleratedRaw: "Non-accelerated filer<br>Smaller reporting company", // as seen from real submissions.json
  none: null,
};

console.log("=== 10-Q deadline days, by filer category ===");
check("10-Q, Large accelerated filer", tenQDeadlineDays(CATEGORIES.largeAccelerated), 40);
check("10-Q, Accelerated filer", tenQDeadlineDays(CATEGORIES.accelerated), 40);
check("10-Q, Non-accelerated filer", tenQDeadlineDays(CATEGORIES.nonAccelerated), 45);
check(
  "10-Q, Non-accelerated filer<br>Smaller reporting company (raw EDGAR string)",
  tenQDeadlineDays(CATEGORIES.nonAcceleratedRaw),
  45
);
check("10-Q, no category", tenQDeadlineDays(CATEGORIES.none), undefined);

console.log("\n=== 10-K deadline days, by filer category ===");
check("10-K, Large accelerated filer", tenKDeadlineDays(CATEGORIES.largeAccelerated), 60);
check("10-K, Accelerated filer", tenKDeadlineDays(CATEGORIES.accelerated), 75);
check("10-K, Non-accelerated filer", tenKDeadlineDays(CATEGORIES.nonAccelerated), 90);
check(
  "10-K, Non-accelerated filer<br>Smaller reporting company (raw EDGAR string)",
  tenKDeadlineDays(CATEGORIES.nonAcceleratedRaw),
  90
);
check("10-K, no category", tenKDeadlineDays(CATEGORIES.none), undefined);

console.log("\n=== Floating (52/53-week) fiscal calendar detection ===");
// NVDA: fiscal year ends "last Sunday of January" -- floats by a day or two
// each year, but the day-count between consecutive FY ends is always a
// multiple of 7 (364 for a 52-week year, 371 for a 53-week year).
check(
  "NVDA-style FY ends (2025-01-26, 2026-01-25) -> floating",
  isFloatingFiscalCalendar(["2025-01-26", "2026-01-25"]),
  true
);
// MSFT: fixed June 30 fiscal year end every year -- 365 (or 366) days apart, never a multiple of 7.
check(
  "MSFT-style FY ends (2025-06-30, 2026-06-30) -> not floating",
  isFloatingFiscalCalendar(["2025-06-30", "2026-06-30"]),
  false
);
// A calendar-year filer: Dec 31 every year, also fixed.
check(
  "Calendar-year FY ends (2024-12-31, 2025-12-31) -> not floating",
  isFloatingFiscalCalendar(["2024-12-31", "2025-12-31"]),
  false
);
check("Fewer than 2 annual ends -> not floating (can't tell)", isFloatingFiscalCalendar(["2026-01-25"]), false);

// --- End-to-end: nextFilingDue for each filer category x form x calendar type. ---
// A minimal fake FilingEntry/FilingPeriod is enough since nextFilingDue only
// reads filing.reportDate, fy, and fp.
function fakeFiling(reportDate: string): FilingEntry {
  return {
    accessionNumber: "0000000000-00-000000",
    filingDate: reportDate,
    reportDate,
    acceptanceDateTime: "",
    form: "10-Q",
    items: "",
    primaryDocument: "fake.htm",
    primaryDocDescription: "",
    isXBRL: true,
  };
}
function fakePeriod(reportDate: string, fp: FilingPeriod["fp"], fy = 2026): FilingPeriod {
  return { filing: fakeFiling(reportDate), fy, fp, label: `${fp} FY${String(fy).slice(-2)}`, placed: true };
}

console.log("\n=== End-to-end nextFilingDue: form selection, deadline math, and the '~' estimate flag ===");

// Latest is Q1 or Q2 -> next form is 10-Q.
check(
  "Latest Q1 -> next form 10-Q",
  nextFilingDue(fakePeriod("2026-04-26", "Q1"), CATEGORIES.largeAccelerated, ["2025-01-26", "2026-01-25"])?.form,
  "10-Q"
);
check(
  "Latest Q2 -> next form 10-Q",
  nextFilingDue(fakePeriod("2026-07-26", "Q2"), CATEGORIES.largeAccelerated, ["2025-01-26", "2026-01-25"])?.form,
  "10-Q"
);
// Latest is Q3 -> next form is 10-K (Q4 is never filed standalone).
check(
  "Latest Q3 -> next form 10-K",
  nextFilingDue(fakePeriod("2025-10-26", "Q3"), CATEGORIES.largeAccelerated, ["2025-01-26", "2026-01-25"])?.form,
  "10-K"
);
// Latest is FY (10-K just filed) -> next form is 10-Q (Q1 of the new year).
check(
  "Latest FY -> next form 10-Q",
  nextFilingDue(fakePeriod("2026-01-25", "FY"), CATEGORIES.largeAccelerated, ["2025-01-26", "2026-01-25"])?.form,
  "10-Q"
);

// NVDA's real, independently-verified case: Q2 FY27 (2026-07-26) -> next
// 10-Q due ~2026-12-04, floating (52/53-week), large accelerated (40 days).
const nvdaCase = nextFilingDue(fakePeriod("2026-07-26", "Q2", 2027), CATEGORIES.largeAccelerated, [
  "2025-01-26",
  "2026-01-25",
]);
check("NVDA case: isEstimated (floating FY)", nvdaCase?.isEstimated, true);
check("NVDA case: due date ~2026-12-04", nvdaCase?.dueDate, "2026-12-04");

// MSFT's real, independently-verified case: Q1 FY27 (2026-09-30, projected
// from Q4 FY26) -> due 2026-11-09, fixed calendar, large accelerated (40 days).
const msftCase = nextFilingDue(fakePeriod("2026-06-30", "FY", 2026), CATEGORIES.largeAccelerated, [
  "2025-06-30",
  "2026-06-30",
]);
check("MSFT case: isEstimated (fixed FY)", msftCase?.isEstimated, false);
check("MSFT case: due date 2026-11-09", msftCase?.dueDate, "2026-11-09");

// NAII's real, independently-verified case: Q3 FY26 (2026-03-31) -> next
// 10-K due 2026-09-28, fixed calendar, non-accelerated (90 days).
const naiiCase = nextFilingDue(fakePeriod("2026-03-31", "Q3", 2026), CATEGORIES.nonAcceleratedRaw, [
  "2025-06-30",
  "2026-06-30",
]);
check("NAII case: next form 10-K", naiiCase?.form, "10-K");
check("NAII case: isEstimated (fixed FY)", naiiCase?.isEstimated, false);
check("NAII case: due date 2026-09-28", naiiCase?.dueDate, "2026-09-28");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
