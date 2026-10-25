/**
 * Every threshold the S5 verdict rules use, in one place
 * (Earnings_Lens_Verdict_Rules_S5.md, sections 4, 5, 8 and 11).
 *
 * The calculation and the explanation both read these values; neither
 * writes a threshold of its own. A test, a fixture or the rules document
 * may spell a value out literally -- production code never does.
 */
export const RULES = {
  cash: {
    /** SEVERE BURN: runway below this many months. */
    severeRunwayMonths: 12,
    /** CAUTION BURN: runway at or above severeRunwayMonths and below this. */
    cautionRunwayMonths: 24,
    /** The app's runway rule counts whole quarters; months = quarters × this. */
    monthsPerQuarter: 3,
  },
  states: {
    /** Fragile: flags in this many different areas or more (4.2). */
    fragileMinAreas: 2,
  },
  liquidity: {
    /** WEAK LIQUIDITY: current ratio strictly below this (and 12-month OCF negative). */
    weakCurrentRatio: 0.8,
  },
  operating: {
    /** OPERATING DETERIORATION: revenue Y/Y (q0) at or below this, in %. */
    revenueYoYPct: -15,
    /** OPERATING DETERIORATION: operating-margin change (q0) at or below this, in percentage points. */
    marginChangePts: -3,
  },
  borrowing: {
    /** LEVERAGE / LOW-CASH DEBT split: 12-month OCF against this share of 12-month revenue (2%). */
    ocfShareOfRevenue: 0.02,
    /** LEVERAGE: net debt ÷ 12-month OCF strictly above this multiple (4×, S4-B). */
    leverageMultiple: 4,
    /** LOW-CASH DEBT: net debt strictly above this share of 12-month revenue (10%). */
    netDebtShareOfRevenue: 0.1,
    /** FUNDING SUBSTITUTION: net debt increase strictly above this share of |12-month OCF| (10%). */
    increaseShareOfAbsOcf: 0.1,
    /** FUNDING SUBSTITUTION ratio leg: net debt ÷ 12-month OCF strictly above this (2×), when OCF is positive. */
    substitutionRatio: 2,
  },
  coreThread: {
    /** EXPANDING: R&D Y/Y at or above this (q0 and q1), in %. */
    rdExpandingPct: 5,
    /** R&D CAUTION: R&D Y/Y at or below this (q0 and q1), in %. */
    rdCautionPct: -5,
  },
  windows: {
    /**
     * The "12 months before the assessment date" window for Critical and
     * restructuring filings, in days. The app's existing red-flag and
     * restructuring rules count the trailing twelve months as 365 days
     * (lib/rules/redFlags.ts, lib/rules/restructuring.ts); this keeps the
     * same convention.
     */
    filingLookbackDays: 365,
    /** Quarters summed for a 12-month figure (OCF, FCF, revenue). */
    quartersPerYear: 4,
  },
  filing: {
    /** A valid Form 12b-25 extends a 10-Q by this many calendar days from the rolled deadline. */
    extension10QDays: 5,
    /** A valid Form 12b-25 extends a 10-K by this many calendar days from the rolled deadline. */
    extension10KDays: 15,
  },
  calendar: {
    /** R1: the last two 10-K period ends must be between these many days apart. */
    annualGapMinDays: 357,
    annualGapMaxDays: 371,
    /** R1: the latest 10-K end must be within this many days of the stated fiscal-year end. */
    fiscalYearEndToleranceDays: 7,
    /** R1: the last two period ends must be between these many days apart. */
    quarterGapMinDays: 80,
    quarterGapMaxDays: 100,
    /** R1: projections may not disagree by more than this many days. */
    projectionToleranceDays: 7,
    /** R1: a 10-KT / 10-QT filed within this many years makes the calendar not measurable. */
    transitionLookbackYears: 2,
    /** Days in a year, for matching a period with the same period a year earlier (within fiscalYearEndToleranceDays). */
    yearDays: 365,
    /** R6: an R&D fact longer than this many days is an annual figure. */
    annualFactMinDays: 300,
  },
  window: {
    /** Periodic filings read for the extended quarterly window. */
    lookbackFilings: 20,
    /** Quarters in the extended window (R6: "the 12-quarter window"). */
    quarters: 12,
  },
} as const;

export type RulesConfig = typeof RULES;
