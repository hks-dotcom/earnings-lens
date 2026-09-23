// Unit tests for the cash position: which of the two cases a quarter falls
// into, the runway figure in the one case that has one, and the cap that
// runway puts on the payment-terms ladder. No network calls.
//
// The two cases matter more than the arithmetic. A negative free cash flow
// means "the cash pile is paying for this quarter" when operations are
// negative and "we spent more than we earned on capital" when they are
// positive, and only the first is a question about whether they can pay
// us. Reading the second as the first told Amazon it had two years to
// live.
//
// The thresholds get unit tests because no tracked ticker sits near them:
// the fixtures that burn have years of runway or are already Weak on the
// balance sheet.
//
// Usage: npx tsx scripts/test-runway.ts

import { KeyFinancials, LineItem } from "@/lib/xbrl/keyFinancials";
import { computeCashPosition, runwayCaveat, runwayInWords, runwaySubject, CashPosition } from "@/lib/rules/runway";
import { computeLadder } from "@/lib/rules/ladder";
import { RedFlagsResult } from "@/lib/rules/redFlags";
import { PaymentBehaviorSignal } from "@/lib/rules/signals";
import { AltmanZoneResult } from "@/lib/metrics/health";

let pass = 0;
let fail = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}  (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  if (ok) pass++;
  else fail++;
}

const M = 1_000_000;

/** A line item from plain numbers; undefined means the quarter isn't filed. */
function line(values: (number | undefined)[]): LineItem {
  return {
    values: values.map((v) =>
      v === undefined ? undefined : { value: v, concept: "test", method: "direct" as const, derived: false }
    ),
  };
}

/**
 * Only the rows the cash rule reads. `ocf` defaults to matching the sign of
 * the latest free cash flow, which is the burn case -- the tests that care
 * about the split pass it explicitly.
 */
function kf(
  fcf: (number | undefined)[],
  cash: number | undefined,
  ocf?: (number | undefined)[],
  capex?: (number | undefined)[],
  sti?: { value: number | undefined; filedEver: boolean }
): KeyFinancials {
  const latest = fcf[0];
  const defaultOcf = latest === undefined ? [undefined] : [latest];
  return {
    freeCashFlow: line(fcf),
    cash: line([cash]),
    operatingCashFlow: line(ocf ?? defaultOcf),
    capitalExpenditures: line(capex ?? [undefined]),
    shortTermInvestments: line([sti?.value]),
    shortTermInvestmentsFiledEver: sti?.filedEver ?? false,
    quarters: [{ label: "Q2 FY26" }, {}, {}, {}, { label: "Q2 FY25" }],
  } as unknown as KeyFinancials;
}

const NO_RED_FLAGS: RedFlagsResult = {
  findings: [],
  windowStart: "2025-09-21",
  windowEnd: "2026-09-21",
  goingConcernChecked: false,
};
const DPO_STABLE: PaymentBehaviorSignal = {
  state: "stable",
  dpoCurrent: 50,
  dpoYearAgo: 50,
  yoyPctChange: 0,
};

/** A safe Z'' with no red flags and steady payables: Strong before runway is applied. */
const SAFE_Z: AltmanZoneResult = {
  z: 12.26,
  scored: "safe",
  zone: "safe",
  capped: false,
  ttmOperatingIncome: 100_000_000,
  ttmFreeCashFlow: 80_000_000,
};
const DISTRESS_Z: AltmanZoneResult = {
  z: 0.5,
  scored: "distress",
  zone: "distress",
  capped: false,
  ttmOperatingIncome: -100_000_000,
  ttmFreeCashFlow: -80_000_000,
};

// --- Which of the two cases a quarter falls into --------------------------

console.log("=== Burn, heavy investment, or neither ===");

/** Operations negative, capex on top: the cash pile is paying for the quarter. */
const burn = computeCashPosition(kf([-30 * M, -10 * M, -10 * M, -10 * M], 300 * M, [-20 * M], [10 * M]));
check("operating cash flow NEGATIVE -> burn", burn.case, "burn");
check("... and it carries a runway", burn.quarters, 10);

/** Amazon's shape: $45bn in from operations, $54bn out to capex. */
const investing = computeCashPosition(kf([-8_821 * M, -18_171 * M, undefined, undefined], 78_213 * M, [45_387 * M, 32_515 * M, undefined, undefined, 32_515 * M], [54_208 * M, undefined, undefined, undefined, 32_183 * M]));
check("operating cash flow POSITIVE, free cash flow negative -> heavy investment", investing.case, "heavy-investment");
check("... and it carries NO runway", investing.quarters, undefined);
check("... and no burn measure", investing.burnUsed, undefined);
check("... it carries the two figures the item states", [investing.capitalExpenditure, investing.operatingCashFlow], [54_208 * M, 45_387 * M]);
check("... and their year-ago counterparts", [investing.capitalExpenditureYearAgo, investing.operatingCashFlowYearAgo], [32_183 * M, 32_515 * M]);

check(
  "operating cash flow positive, free cash flow POSITIVE -> neither",
  computeCashPosition(kf([5 * M], 100 * M, [20 * M], [15 * M])).case,
  "none"
);

console.log("\n-- the boundary and the missing cases --");
check(
  "operating cash flow EXACTLY ZERO -> neither case, whatever free cash flow does",
  computeCashPosition(kf([-10 * M], 100 * M, [0], [10 * M])).case,
  "none"
);
check(
  "... so no runway",
  computeCashPosition(kf([-10 * M], 100 * M, [0], [10 * M])).quarters,
  undefined
);
check(
  "operating cash flow MISSING -> neither case, even with free cash flow negative",
  computeCashPosition(kf([-10 * M], 100 * M, [undefined], [10 * M])).case,
  "none"
);
check(
  "... so no runway",
  computeCashPosition(kf([-10 * M], 100 * M, [undefined], [10 * M])).quarters,
  undefined
);
check(
  "operations negative but capex unfiled -> still a burn, runway unmeasurable",
  computeCashPosition(kf([undefined], 100 * M, [-20 * M], [undefined])).case,
  "burn"
);
check(
  "... with no runway figure rather than a guessed one",
  computeCashPosition(kf([undefined], 100 * M, [-20 * M], [undefined])).quarters,
  undefined
);

console.log("\n-- and what each case does to the ladder --");
function rungWith(position: CashPosition): string {
  return computeLadder(SAFE_Z, NO_RED_FLAGS, DPO_STABLE, position).rung;
}
const shortBurn = computeCashPosition(kf([-30 * M, -30 * M, -30 * M, -30 * M], 60 * M, [-30 * M], [0]));
check("a 2-quarter burn caps the rung", [shortBurn.case, shortBurn.quarters, rungWith(shortBurn)], ["burn", 2, "Weak"]);
const bigInvestment = computeCashPosition(kf([-50_000 * M], 10 * M, [1 * M], [50_001 * M]));
check(
  "heavy investment leaves the rung alone, however large",
  [bigInvestment.case, rungWith(bigInvestment)],
  ["heavy-investment", "Strong"]
);
check(
  "operating cash flow zero leaves the rung alone",
  rungWith(computeCashPosition(kf([-50_000 * M], 10 * M, [0], [50_000 * M]))),
  "Strong"
);
check(
  "operating cash flow missing leaves the rung alone",
  rungWith(computeCashPosition(kf([-50_000 * M], 10 * M, [undefined], [50_000 * M]))),
  "Strong"
);

console.log("\n=== Which burn measure the rule divides by ===");

// One heavy quarter against three quiet ones: this quarter's burn is the
// larger, so it is the divisor.
const heavyLatest = computeCashPosition(kf([-26.828 * M, -4.903 * M, -1.63 * M, 27.929 * M], 362.191 * M));
check("this quarter's burn is larger -> basis is this quarter", heavyLatest.burnBasis, "this quarter");
check("this quarter's burn is larger -> 13 quarters", heavyLatest.quarters, 13);

// The mirror image: a small current quarter after three heavy ones. The
// four-quarter average is larger, so it wins and the runway is shorter
// than this quarter alone would suggest.
const heavyAverage = computeCashPosition(kf([-2 * M, -20 * M, -20 * M, -22 * M, -5 * M], 160 * M));
check("four-quarter average is larger -> basis is the average", heavyAverage.burnBasis, "four-quarter average");
check("four-quarter average is larger -> average burn $16M", heavyAverage.averageBurn, 16 * M);
check("four-quarter average is larger -> 10 quarters, not 80", heavyAverage.quarters, 10);

console.log("\n=== When the rule does not apply, or cannot be computed ===");
check("positive free cash flow -> neither case", computeCashPosition(kf([5 * M, -1 * M, -1 * M, -1 * M], 100 * M)).case, "none");
check("free cash flow not filed, operations not filed -> neither case", computeCashPosition(kf([undefined], 100 * M)).case, "none");
check(
  "a missing quarter -> no four-quarter average (never a partial one)",
  computeCashPosition(kf([-10 * M, undefined, -10 * M, -10 * M], 100 * M)).averageBurn,
  undefined
);
check(
  "a missing quarter -> the rule still runs on this quarter's burn",
  computeCashPosition(kf([-10 * M, undefined, -10 * M, -10 * M], 100 * M)).quarters,
  10
);
check("cash not filed -> runway stays missing", computeCashPosition(kf([-10 * M, -10 * M, -10 * M, -10 * M], undefined)).quarters, undefined);

console.log("\n=== The two declared runway thresholds ===");

/** Strong on the balance sheet; only runway can move it. */
function rungFor(fcf: (number | undefined)[], cash: number): string {
  return computeLadder(SAFE_Z, NO_RED_FLAGS, DPO_STABLE, computeCashPosition(kf(fcf, cash))).rung;
}

const STEADY_BURN = [-10 * M, -10 * M, -10 * M, -10 * M];
check("13 quarters of runway -> Strong (no cap)", rungFor(STEADY_BURN, 130 * M), "Strong");
check("8 quarters exactly -> Strong (the threshold is 'under 8')", rungFor(STEADY_BURN, 80 * M), "Strong");
check("7.9 quarters -> capped at Neutral", rungFor(STEADY_BURN, 79 * M), "Neutral");
check("4 quarters exactly -> Neutral (the threshold is 'under 4')", rungFor(STEADY_BURN, 40 * M), "Neutral");
check("3.9 quarters -> Weak", rungFor(STEADY_BURN, 39 * M), "Weak");
check("0 quarters -> Weak", rungFor(STEADY_BURN, 1 * M), "Weak");
check(
  "under 4 quarters -> escalate before signing",
  computeLadder(SAFE_Z, NO_RED_FLAGS, DPO_STABLE, computeCashPosition(kf(STEADY_BURN, 39 * M))).escalateBeforeSigning,
  true
);
check(
  "positive free cash flow has no runway limit -> still Strong",
  rungFor([1 * M, 1 * M, 1 * M, 1 * M], 1 * M),
  "Strong"
);

// The cap only ever moves the rung down: a company already Weak on its
// balance sheet is not promoted by a long runway.
check(
  "a long runway never promotes a distressed balance sheet",
  computeLadder(DISTRESS_Z, NO_RED_FLAGS, DPO_STABLE, computeCashPosition(kf(STEADY_BURN, 130 * M))).rung,
  "Weak"
);

console.log("\n=== Runway = (cash + short-term investments) ÷ burn ===");
{
  const burn40 = [-10 * M, -10 * M, -10 * M, -10 * M];
  const both = computeCashPosition(kf(burn40, 30 * M, undefined, undefined, { value: 50 * M, filedEver: true }));
  check("cash 30 + short-term investments 50 over a burn of 10 -> 8 quarters", both.quarters, 8);
  check("... divides both", [both.liquidityBasis, both.liquidity, both.shortTermInvestments], ["cash-and-short-term-investments", 80 * M, 50 * M]);
  check("... and the text names both", runwaySubject(both), "Cash and short-term investments cover");
  check(
    "short-term investments lift a capped rung: cash 30 alone would be Neutral, with 50 more it is Strong",
    computeLadder(SAFE_Z, NO_RED_FLAGS, DPO_STABLE, both).rung,
    "Strong"
  );
  const never = computeCashPosition(kf(burn40, 30 * M, undefined, undefined, { value: undefined, filedEver: false }));
  check("never filed -> cash alone, 3 quarters", [never.quarters, never.liquidityBasis], [3, "cash-only-not-filed"]);
  check("... and the text says cash, with no caveat", [runwaySubject(never), runwayCaveat(never)], ["Cash covers", ""]);
  const gap = computeCashPosition(kf(burn40, 30 * M, undefined, undefined, { value: undefined, filedEver: true }));
  check("filed before but not this quarter -> cash alone, 3 quarters", [gap.quarters, gap.liquidityBasis], [3, "cash-only-missing-this-quarter"]);
  check(
    "... and the text says so",
    runwayCaveat(gap),
    "; short-term investments are not filed for this quarter, so cash alone is counted"
  );
  check(
    "cash missing -> no runway even with short-term investments",
    computeCashPosition(kf(burn40, undefined, undefined, undefined, { value: 50 * M, filedEver: true })).quarters,
    undefined
  );
}

console.log("\n=== Runway as the Summary says it: a bare duration in words, never a ratio ===");
check("13 quarters", runwayInWords(13), "more than three years");
check("12 quarters", runwayInWords(12), "about three years");
check("8 quarters", runwayInWords(8), "about two years");
check("5 quarters", runwayInWords(5), "more than one year");
check("3 quarters", runwayInWords(3), "less than a year");
check("60 quarters", runwayInWords(60), "more than ten years");
check("not computable", runwayInWords(undefined), undefined);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
