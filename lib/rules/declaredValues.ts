// Every declared baseline the rules engine uses, in one place, so the page
// footer ("All declared values are visible in the page footer") can read
// straight from here instead of duplicating numbers.

export const ALTMAN_ZONES = { safeAbove: 2.6, distressBelow: 1.1 } as const;

/**
 * Why a distress score is not always read as distress.
 *
 * Printed in the footer beside the zones themselves, because it changes
 * what the zones mean and a reader checking a verdict against the rule
 * needs both in front of them.
 */
export const ALTMAN_CAP_RATIONALE =
  "Z'' penalises accumulated deficits and buyback-driven negative equity; a profitable, cash-generating company isn't treated as distressed on Z'' alone.";

/** Growth flat band: a Y/Y change within ±this% counts as "flat", not up or down. */
export const GROWTH_FLAT_BAND_PCT = 2;

/** DPO band: a Y/Y change within ±this% of the year-ago DPO counts as "stable". */
export const DPO_BAND_PCT = 10;

/**
 * Explanation triggers, in the units the spec declares them in.
 *
 * Quarterly revenue is the denominator for both size tests because it is
 * always positive. Operating income -- the obvious alternative -- can be
 * negative or near zero, and a threshold measured against it stops meaning
 * anything exactly when a company is in the state worth explaining. A
 * quarter with a $423M tax charge against a $24M pre-tax loss is the case
 * that forced this: "1,700% of pre-tax income" reports only how small the
 * denominator was.
 *
 * Calibrated across the tracked fixtures: NVDA (investment gains) and the
 * EV makers (valuation-allowance tax charges) trip these; routine tax and
 * interest at MSFT, WMT, UFPT and NAII do not.
 */

/** Non-operating swing: |pre-tax income − operating income| past this share of quarterly revenue. */
export const NON_OPERATING_SWING_PCT_OF_REVENUE = 5;

/**
 * Unusual tax: |tax charge − 21% of pre-tax income| past this share of
 * quarterly revenue -- and the same quarter last year not past it too, so
 * a tax position that repeats every year (a full valuation allowance) is
 * not flagged as a one-off.
 */
export const TAX_DIVERGENCE_PCT_OF_REVENUE = 5;

/** The US federal statutory rate the tax test measures against. */
export const STATUTORY_TAX_RATE_PCT = 21;

/** Daily cap on Claude calls -- a backstop behind per-filing caching. */
export const CLAUDE_DAILY_CAP = 50;

export const PAYMENT_TERMS_BASELINE_DAYS = 30;
export const PAYMENT_TERMS_CEILING_DAYS = 45;

/**
 * Runway, in the one case it means anything: operating cash flow negative
 * in the latest quarter. Cash ÷ the larger of this quarter's burn and the
 * four-quarter average burn, both measured on free cash flow.
 *
 * Two burn measures rather than one because either alone misreads a
 * company. This quarter's burn alone turns a single heavy quarter into a
 * crisis; the four-quarter average alone lets three good quarters hide a
 * burn that has just started. Taking the larger is the conservative read
 * of both.
 */
export const RUNWAY_NEUTRAL_CAP_QUARTERS = 8;
export const RUNWAY_WEAK_BELOW_QUARTERS = 4;

/**
 * The two shapes a negative free cash flow comes in, and what each one
 * does. Printed in the footer because they lead to opposite outcomes from
 * the same-looking figure.
 */
export const CASH_CASE_RULE =
  "Cash burn (operating cash flow negative this quarter): runway = (cash + short-term investments) ÷ the larger of this quarter's and the four-quarter average burn, and it caps the rung. Heavy investment (operating cash flow positive, free cash flow negative): shown as a watch item with no runway and no effect on the ladder.";

/**
 * "What stands out" thresholds. Each item appears only when its threshold
 * fires; the page reads these constants rather than repeating the numbers,
 * so the footer, the item text and the rule can never disagree.
 */

/** Costs: SG&A growth this many points away from revenue growth, Y/Y. */
export const COSTS_VS_REVENUE_POINTS = 10;

/** Losses / profits: operating income moved this much Y/Y, on the year-ago absolute value. */
export const OPERATING_INCOME_MOVE_PCT = 25;

/**
 * The second, higher band on the same move: past this, the Summary says
 * the losses are shrinking (or the profits growing) *fast*.
 *
 * One threshold could not carry both jobs. 25% is the point where a move
 * is worth an item of its own, and a quarter of an already-small operating
 * income is a routine swing -- calling it "fast" in a one-paragraph
 * commentary would spend the word on companies that have barely moved.
 */
export const OPERATING_INCOME_FAST_MOVE_PCT = 50;

/** Margin: gross margin moved this many points Y/Y. */
export const GROSS_MARGIN_MOVE_PTS = 2;

/**
 * The three display-only cash-flow findings. None affects the ladder, the
 * quadrant or the Summary.
 *
 * Borrowing: net new debt above this share of quarterly revenue, while free
 * cash flow is negative or buybacks and dividends over four quarters
 * exceed free cash flow over the same quarters.
 */
export const BORROWING_PCT_OF_REVENUE = 5;

/** Acquisitions and investments: the line above this share of quarterly revenue. Also an explanation trigger. */
export const ACQUISITIONS_PCT_OF_REVENUE = 5;

/**
 * Returns: buybacks plus dividends over the last four quarters above free
 * cash flow over the same quarters, and above this share of the latest
 * quarter's revenue. The size test keeps a company whose free cash flow is
 * near zero or negative from firing on a token dividend.
 */
export const RETURNS_PCT_OF_REVENUE = 5;

/**
 * Financial health benchmarks: one reference line under each tile.
 * Reference points, not rules -- nothing reads them but the tiles and the
 * footer, and they vary by industry. DPO's is the terms ceiling (a company
 * inside it pays suppliers within the longest terms we'd offer) and Z''s is
 * the rules' own safe zone.
 */
export const HEALTH_BENCHMARKS = {
  currentRatioAbove: 1.0,
  debtToEquityBelow: 1.0,
  dsoWithinDays: 45,
  dpoWithinDays: PAYMENT_TERMS_CEILING_DAYS,
  altmanZAbove: ALTMAN_ZONES.safeAbove,
} as const;

export const BENCHMARKS_NOTE =
  "Benchmarks are reference points, not rules, and vary by industry: retailers often run a current ratio below 1.0x by design.";
