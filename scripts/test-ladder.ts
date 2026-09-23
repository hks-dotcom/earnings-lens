// Every path through the payment-terms ladder: the Altman zone (safe,
// grey, distress, unavailable) crossed with red flags, with the DPO trend,
// and with runway. No network calls.
//
// The ladder is the one rule that decides what the deal desk is allowed to
// sign, and its branches are ordered -- a red flag outranks a grey zone,
// distress outranks everything, runway is applied last and only downward.
// An ordering mistake would not show up as a crash or a missing value; it
// would show up as Net 45 offered to a company that should have been
// escalated. So every combination is pinned here rather than sampled.
//
// Usage: npx tsx scripts/test-ladder.ts

import { computeLadder, LadderRung } from "@/lib/rules/ladder";
import { RedFlagsResult } from "@/lib/rules/redFlags";
import { PaymentBehaviorSignal } from "@/lib/rules/signals";
import { CashPosition } from "@/lib/rules/runway";
import { AltmanZoneResult, ALTMAN_CAP_NOTE } from "@/lib/metrics/health";

let pass = 0;
let fail = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}  (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  if (ok) pass++;
  else fail++;
}

// --- Inputs, one per axis -------------------------------------------------

/**
 * A zone result as the health engine hands it to the ladder. `profitable`
 * decides whether a distress score qualifies for the cap; every zone above
 * distress ignores it.
 */
function zoneOf(
  z: number | undefined,
  ttmOperatingIncome: number | undefined,
  ttmFreeCashFlow: number | undefined
): AltmanZoneResult {
  const scored = z === undefined ? undefined : z > 2.6 ? "safe" : z < 1.1 ? "distress" : "grey";
  const capped =
    scored === "distress" &&
    ttmOperatingIncome !== undefined &&
    ttmOperatingIncome > 0 &&
    ttmFreeCashFlow !== undefined &&
    ttmFreeCashFlow > 0;
  return { z, scored, zone: capped ? "grey" : scored, capped, ttmOperatingIncome, ttmFreeCashFlow };
}

const LOSS = -100_000_000;
const PROFIT = 100_000_000;

const Z_SAFE = zoneOf(12.26, PROFIT, PROFIT); // > 2.6
const Z_GREY = zoneOf(1.97, PROFIT, PROFIT); // between 1.1 and 2.6
const Z_DISTRESS = zoneOf(0.5, LOSS, LOSS); // < 1.1, and loss-making: no cap
const Z_NONE = zoneOf(undefined, PROFIT, PROFIT);

const NO_FLAGS: RedFlagsResult = {
  findings: [],
  windowStart: "2025-09-21",
  windowEnd: "2026-09-21",
  goingConcernChecked: false,
};
const RED_FLAG: RedFlagsResult = {
  findings: [{ type: "late-filing-12b25", detail: "NT 10-Q filed 18 May 2026; 10-Q filed 19 May 2026.", date: "2026-05-18" }],
  windowStart: "2025-09-21",
  windowEnd: "2026-09-21",
  goingConcernChecked: false,
};

const dpo = (state: PaymentBehaviorSignal["state"], pct: number | undefined): PaymentBehaviorSignal => ({
  state,
  dpoCurrent: state === "missing" ? undefined : 50,
  dpoYearAgo: state === "missing" ? undefined : 45,
  yoyPctChange: pct,
});
const DPO_RISING = dpo("rising", 24);
const DPO_STABLE = dpo("stable", 2);
const DPO_FALLING = dpo("falling", -13);
const DPO_MISSING = dpo("missing", undefined);

const NO_RUNWAY: CashPosition = {
  case: "none",
  latestBurn: undefined,
  averageBurn: undefined,
  burnUsed: undefined,
  burnBasis: undefined,
  cash: undefined,
  quarters: undefined,
  capitalExpenditure: undefined,
  operatingCashFlow: undefined,
  capitalExpenditureYearAgo: undefined,
  operatingCashFlowYearAgo: undefined,
};
const runway = (quarters: number): CashPosition => ({
  ...NO_RUNWAY,
  case: "burn",
  latestBurn: 10_000_000,
  averageBurn: 10_000_000,
  burnUsed: 10_000_000,
  burnBasis: "this quarter",
  cash: quarters * 10_000_000,
  quarters,
  operatingCashFlow: -10_000_000,
});
/** Heavy investment: a negative free cash flow that must not touch the ladder. */
const HEAVY_INVESTMENT: CashPosition = {
  ...NO_RUNWAY,
  case: "heavy-investment",
  capitalExpenditure: 54_208_000_000,
  operatingCashFlow: 45_387_000_000,
};

function rung(z: AltmanZoneResult, flags: RedFlagsResult, behaviour: PaymentBehaviorSignal, r: CashPosition = NO_RUNWAY): LadderRung {
  return computeLadder(z, flags, behaviour, r).rung;
}

// --- The balance-sheet matrix, before runway ------------------------------

console.log("=== Altman zone x red flag x DPO trend (no runway) ===");

console.log("\n-- safe --");
check("safe, no flags, DPO stable", rung(Z_SAFE, NO_FLAGS, DPO_STABLE), "Strong");
check("safe, no flags, DPO falling", rung(Z_SAFE, NO_FLAGS, DPO_FALLING), "Strong");
check("safe, no flags, DPO unavailable -> treated as not rising", rung(Z_SAFE, NO_FLAGS, DPO_MISSING), "Strong");
check("safe, no flags, DPO rising -> slower payer, not escalation", rung(Z_SAFE, NO_FLAGS, DPO_RISING), "Neutral");
check("safe, RED FLAG, DPO stable -> a flag outranks a safe balance sheet", rung(Z_SAFE, RED_FLAG, DPO_STABLE), "Weak");
check("safe, RED FLAG, DPO rising", rung(Z_SAFE, RED_FLAG, DPO_RISING), "Weak");

console.log("\n-- grey --");
check("grey, no flags, DPO stable", rung(Z_GREY, NO_FLAGS, DPO_STABLE), "Neutral");
check("grey, no flags, DPO falling", rung(Z_GREY, NO_FLAGS, DPO_FALLING), "Neutral");
check("grey, no flags, DPO unavailable", rung(Z_GREY, NO_FLAGS, DPO_MISSING), "Neutral");
check("grey, no flags, DPO RISING -> the grey-zone-plus-rising-DPO exception", rung(Z_GREY, NO_FLAGS, DPO_RISING), "Weak");
check("grey, RED FLAG, DPO stable", rung(Z_GREY, RED_FLAG, DPO_STABLE), "Weak");

console.log("\n-- distress --");
check("distress, no flags, DPO stable", rung(Z_DISTRESS, NO_FLAGS, DPO_STABLE), "Weak");
check("distress, no flags, DPO rising", rung(Z_DISTRESS, NO_FLAGS, DPO_RISING), "Weak");
check("distress, RED FLAG", rung(Z_DISTRESS, RED_FLAG, DPO_STABLE), "Weak");
check(
  "distress outranks the red flag in the stated reason",
  computeLadder(Z_DISTRESS, RED_FLAG, DPO_STABLE, NO_RUNWAY).rule.includes("distress zone"),
  true
);

console.log("\n-- Z'' unavailable --");
check("no Z'', no flags, DPO stable -> can't confirm safe, so not Strong", rung(Z_NONE, NO_FLAGS, DPO_STABLE), "Neutral");
check("no Z'', no flags, DPO rising", rung(Z_NONE, NO_FLAGS, DPO_RISING), "Neutral");
check("no Z'', RED FLAG", rung(Z_NONE, RED_FLAG, DPO_STABLE), "Weak");

// --- The same matrix with runway applied over the top ---------------------

console.log("\n=== ... crossed with runway ===");

check("Strong + 13 quarters -> untouched", rung(Z_SAFE, NO_FLAGS, DPO_STABLE, runway(13)), "Strong");
check("Strong + exactly 8 quarters -> untouched ('under 8')", rung(Z_SAFE, NO_FLAGS, DPO_STABLE, runway(8)), "Strong");
check("Strong + 7 quarters -> capped at Neutral", rung(Z_SAFE, NO_FLAGS, DPO_STABLE, runway(7)), "Neutral");
check("Strong + exactly 4 quarters -> Neutral, not Weak ('under 4')", rung(Z_SAFE, NO_FLAGS, DPO_STABLE, runway(4)), "Neutral");
check("Strong + 3 quarters -> Weak", rung(Z_SAFE, NO_FLAGS, DPO_STABLE, runway(3)), "Weak");
check("Strong + 0 quarters -> Weak", rung(Z_SAFE, NO_FLAGS, DPO_STABLE, runway(0)), "Weak");

check("Neutral (safe, DPO rising) + 7 quarters -> still Neutral", rung(Z_SAFE, NO_FLAGS, DPO_RISING, runway(7)), "Neutral");
check("Neutral (safe, DPO rising) + 3 quarters -> Weak", rung(Z_SAFE, NO_FLAGS, DPO_RISING, runway(3)), "Weak");
check("Neutral (grey) + 3 quarters -> Weak", rung(Z_GREY, NO_FLAGS, DPO_STABLE, runway(3)), "Weak");
check("Neutral (no Z'') + 3 quarters -> Weak", rung(Z_NONE, NO_FLAGS, DPO_STABLE, runway(3)), "Weak");

check("Weak (red flag) + 3 quarters -> stays Weak", rung(Z_SAFE, RED_FLAG, DPO_STABLE, runway(3)), "Weak");
check("Weak (distress) + 40 quarters -> a long runway never promotes", rung(Z_DISTRESS, NO_FLAGS, DPO_STABLE, runway(40)), "Weak");
check("Weak (grey + rising DPO) + 40 quarters -> stays Weak", rung(Z_GREY, NO_FLAGS, DPO_RISING, runway(40)), "Weak");
check(
  "a Weak rung keeps its own reason rather than the runway's",
  computeLadder(Z_SAFE, RED_FLAG, DPO_STABLE, runway(3)).rule.includes("Red-flag"),
  true
);
check(
  "a runway-capped rung says so",
  computeLadder(Z_SAFE, NO_FLAGS, DPO_STABLE, runway(7)).rule.includes("runway threshold"),
  true
);

// --- The Altman cap: a distress score on a company that is paying its way --
//
// Z'' has two balance-sheet terms that punish an accumulated deficit and
// negative book equity, so a company that has bought back more stock than
// it has ever booked as earnings scores as distressed while collecting
// cash every quarter. The cap lifts that to GREY, never to safe -- so the
// grey rules still bite -- and only when both trailing-twelve-month
// figures are present and positive.

console.log("\n=== The Altman distress cap ===");

const CAPPED = zoneOf(0.5, PROFIT, PROFIT);

check("distress score + TTM profit + TTM cash generation -> treated as grey", CAPPED.zone, "grey");
check("... and the raw score is still recorded as distress", CAPPED.scored, "distress");
check("... and it is flagged as capped", CAPPED.capped, true);
check("capped + DPO stable -> Neutral, not Weak", rung(CAPPED, NO_FLAGS, DPO_STABLE), "Neutral");
check("capped + DPO RISING -> Weak: every grey rule still applies", rung(CAPPED, NO_FLAGS, DPO_RISING), "Weak");
check("capped + RED FLAG -> Weak: a flag still outranks everything", rung(CAPPED, RED_FLAG, DPO_STABLE), "Weak");
check("capped never reaches Strong", rung(CAPPED, NO_FLAGS, DPO_FALLING) === "Strong", false);
check(
  "the rule says why a distress score produced a grey outcome",
  computeLadder(CAPPED, NO_FLAGS, DPO_STABLE, NO_RUNWAY).rule.includes(ALTMAN_CAP_NOTE),
  true
);
check("capped + 3 quarters of runway -> Weak, as any grey company would be", rung(CAPPED, NO_FLAGS, DPO_STABLE, runway(3)), "Weak");

console.log("\n-- the cap does not apply --");
check("distress + TTM operating LOSS + TTM cash generation -> stays distress", zoneOf(0.5, LOSS, PROFIT).zone, "distress");
check("distress + TTM profit + TTM cash BURN -> stays distress", zoneOf(0.5, PROFIT, LOSS).zone, "distress");
check("distress + both negative -> stays distress", zoneOf(0.5, LOSS, LOSS).zone, "distress");
check("TTM operating income MISSING -> no cap, stays distress", zoneOf(0.5, undefined, PROFIT).zone, "distress");
check("TTM free cash flow MISSING -> no cap, stays distress", zoneOf(0.5, PROFIT, undefined).zone, "distress");
check("both MISSING -> no cap, stays distress", zoneOf(0.5, undefined, undefined).zone, "distress");
check("TTM operating income MISSING -> rung stays Weak", rung(zoneOf(0.5, undefined, PROFIT), NO_FLAGS, DPO_STABLE), "Weak");
check("TTM free cash flow MISSING -> rung stays Weak", rung(zoneOf(0.5, PROFIT, undefined), NO_FLAGS, DPO_STABLE), "Weak");
check("exactly zero TTM operating income is not positive -> no cap", zoneOf(0.5, 0, PROFIT).zone, "distress");
check("exactly zero TTM free cash flow is not positive -> no cap", zoneOf(0.5, PROFIT, 0).zone, "distress");
check("a GREY score is never 'capped', however profitable", zoneOf(1.97, PROFIT, PROFIT).capped, false);
check("a SAFE score is never 'capped'", zoneOf(12.26, PROFIT, PROFIT).capped, false);
check("a safe, profitable company is still Strong", rung(zoneOf(12.26, PROFIT, PROFIT), NO_FLAGS, DPO_STABLE), "Strong");

// --- What each rung actually permits --------------------------------------

console.log("\n=== The terms each rung permits ===");

const strong = computeLadder(Z_SAFE, NO_FLAGS, DPO_STABLE, NO_RUNWAY);
const neutral = computeLadder(Z_GREY, NO_FLAGS, DPO_STABLE, NO_RUNWAY);
const weak = computeLadder(Z_DISTRESS, NO_FLAGS, DPO_STABLE, NO_RUNWAY);

check("Strong: Net 30 yes", strong.net30, true);
check("Strong: Net 45 yes", strong.net45, true);
check("Strong: Net 60 never", strong.net60, false);
check("Strong: no escalation", strong.escalateBeforeSigning, false);

check("Neutral: Net 30 yes", neutral.net30, true);
check("Neutral: Net 45 no", neutral.net45, false);
check("Neutral: Net 60 never", neutral.net60, false);
check("Neutral: no escalation", neutral.escalateBeforeSigning, false);

check("Weak: Net 30 yes, with escalation", weak.net30, true);
check("Weak: Net 45 no", weak.net45, false);
check("Weak: Net 60 never", weak.net60, false);
check("Weak: escalate before signing", weak.escalateBeforeSigning, true);

check("Weak by runway alone also escalates", computeLadder(Z_SAFE, NO_FLAGS, DPO_STABLE, runway(2)).escalateBeforeSigning, true);
check("a runway cap to Neutral does not escalate", computeLadder(Z_SAFE, NO_FLAGS, DPO_STABLE, runway(6)).escalateBeforeSigning, false);

console.log("\n=== Heavy investment never reaches the ladder ===");
check("Strong stays Strong", rung(Z_SAFE, NO_FLAGS, DPO_STABLE, HEAVY_INVESTMENT), "Strong");
check("grey stays Neutral", rung(Z_GREY, NO_FLAGS, DPO_STABLE, HEAVY_INVESTMENT), "Neutral");
check(
  "and the rule text says nothing about runway",
  computeLadder(Z_SAFE, NO_FLAGS, DPO_STABLE, HEAVY_INVESTMENT).rule.includes("runway"),
  false
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
