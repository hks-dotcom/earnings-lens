import { KeyFinancials } from "@/lib/xbrl/keyFinancials";
import { LensResult } from "@/lib/rules/evaluateLens";
import { CompanySubmissions, FilingEntry } from "@/lib/edgar/submissions";
import { RedFlagFinding } from "@/lib/rules/redFlags";
import { formatMagnitude } from "@/lib/present/netIncomeGap";
import {
  ACQUISITIONS_PCT_OF_REVENUE,
  DPO_BAND_PCT,
  NON_OPERATING_SWING_PCT_OF_REVENUE,
  STATUTORY_TAX_RATE_PCT,
  TAX_DIVERGENCE_PCT_OF_REVENUE,
} from "@/lib/rules/declaredValues";
import { MINUS } from "@/lib/present/format";

/**
 * The exact set of items the Claude layer explains -- "each is a trigger;
 * nothing else is sent to Claude".
 *
 * Deciding WHAT needs explaining is a rules job, so it lives here with the
 * other rules and is computed from filed figures alone. The Claude layer
 * downstream can only answer the questions this module asks; it never gets
 * to choose its own subject matter, and it is never sent a filing that no
 * trigger pointed it at.
 *
 * Every `detail` below is the computed fact that tripped the trigger, and
 * nothing more. It is written by the app, from the app's own numbers, and
 * is the reason Claude is told not to restate figures: they are already on
 * screen next to whatever it says.
 */

export type TriggerKind =
  | "non-operating-swing"
  | "unusual-tax"
  | "opposite-signs"
  | "retrenchment"
  | "restructuring"
  | "dpo-rising"
  | "red-flag"
  | "acquisitions";

/**
 * Which filed text can answer this trigger.
 *
 * "financials" means the results 8-K with all its exhibits plus the latest
 * 10-Q/10-K management discussion and notes -- the bundle that explains
 * anything visible in the quarter's figures. A red flag or a restructuring
 * filing instead points at the one filing behind it, because that filing is
 * where the reason is stated (an NT form states why the filer was late; a
 * 4.02 states what is being restated; a 2.05 describes the plan).
 */
export type TriggerSource =
  | { scope: "financials" }
  | { scope: "filing"; accessionNumber: string; form: string; filingDate: string }
  /** No filed text can answer this -- resolved to "Not explained in the filing." with no call. */
  | { scope: "none"; reason: string };

export interface ExplanationTrigger {
  kind: TriggerKind;
  /** Stable cache key, unique within the accession it is stored under. */
  key: string;
  /** Short subject, e.g. "Non-operating swing". */
  title: string;
  /** The computed fact that tripped the trigger. Never an explanation. */
  detail: string;
  /** The one thing the filed text is asked for. Carries no figure and no verdict. */
  question: string;
  /**
   * What the board already shows beside the answer: the finding's own
   * sentence and figures line. Sent so the answer can leave it out -- the
   * explanation closes that finding, and a closing sentence that restates
   * the gap the finding just stated says nothing. Set by the page builder,
   * which owns the findings; absent, nothing is sent.
   */
  shown?: string;
  source: TriggerSource;
}

export const EXPLANATIONS_UNAVAILABLE = "Explanations unavailable";
export const NOT_EXPLAINED = "Not explained in the filing.";

function pctOfRevenue(revenue: number, pct: number): number {
  return (revenue * pct) / 100;
}

/**
 * Did the same fiscal quarter last year also meet the unusual-tax
 * condition? `undefined` when it can't be evaluated (any of its three
 * figures missing, or revenue not positive).
 *
 * The test exists to catch a one-off. A company that carries a full
 * valuation allowance books next to no tax on a large loss every quarter,
 * so its tax line sits far from 21% of pre-tax income year after year:
 * that is how its tax works, not something that happened this quarter. A
 * divergence the year-ago quarter shared is therefore not flagged. When
 * the year-ago quarter can't be evaluated there is nothing to say it
 * repeats, so the test fires as it always did.
 */
export function unusualTaxYearAgo(kf: KeyFinancials): boolean | undefined {
  const revenue = kf.revenue.values[4]?.value;
  const pretaxIncome = kf.pretaxIncome.values[4]?.value;
  const tax = kf.incomeTaxExpense.values[4]?.value;
  if (revenue === undefined || revenue <= 0 || pretaxIncome === undefined || tax === undefined) return undefined;
  const statutory = (pretaxIncome * STATUTORY_TAX_RATE_PCT) / 100;
  return Math.abs(tax - statutory) > pctOfRevenue(revenue, TAX_DIVERGENCE_PCT_OF_REVENUE);
}

/**
 * The two size tests and the sign backstop.
 *
 * Both sizes are measured against quarterly revenue, not against the line
 * they are compared with: revenue is always positive, and operating or
 * pre-tax income can be negative or near zero exactly when something worth
 * explaining has happened.
 *
 * Exported because the Summary needs to know whether either size test
 * fired, and that is a rules fact about the filed figures alone -- it does
 * not depend on the submissions list, on Claude having been called, or on
 * an answer having come back. This is a pure function of `kf`, so the
 * Summary can ask it directly instead of waiting on the explanation layer
 * it is describing.
 */
export function financialTriggers(kf: KeyFinancials): ExplanationTrigger[] {
  const out: ExplanationTrigger[] = [];
  const revenue = kf.revenue.values[0]?.value;
  const operatingIncome = kf.operatingIncome.values[0]?.value;
  const netIncome = kf.netIncome.values[0]?.value;
  const pretaxIncome = kf.pretaxIncome.values[0]?.value;
  const tax = kf.incomeTaxExpense.values[0]?.value;

  // A missing input means the test cannot be run. A test that cannot run is
  // not a passing test: nothing is flagged, and nothing is invented.
  if (revenue !== undefined && revenue > 0) {
    const swingBand = pctOfRevenue(revenue, NON_OPERATING_SWING_PCT_OF_REVENUE);
    if (pretaxIncome !== undefined && operatingIncome !== undefined) {
      const swing = pretaxIncome - operatingIncome;
      if (Math.abs(swing) > swingBand) {
        const direction = swing > 0 ? "above" : "below";
        out.push({
          kind: "non-operating-swing",
          key: "non-operating-swing",
          title: "Non-operating swing",
          detail: `Pre-tax income is ${formatMagnitude(Math.abs(swing))} ${direction} operating income, past the declared ${NON_OPERATING_SWING_PCT_OF_REVENUE}% of quarterly revenue (${formatMagnitude(swingBand)}).`,
          question:
            "What does the filing say caused the difference between pre-tax income and operating income this quarter?",
          source: { scope: "financials" },
        });
      }
    }

    const taxBand = pctOfRevenue(revenue, TAX_DIVERGENCE_PCT_OF_REVENUE);
    if (tax !== undefined && pretaxIncome !== undefined) {
      const statutory = (pretaxIncome * STATUTORY_TAX_RATE_PCT) / 100;
      const divergence = tax - statutory;
      if (Math.abs(divergence) > taxBand && unusualTaxYearAgo(kf) !== true) {
        const direction = divergence > 0 ? "above" : "below";
        out.push({
          kind: "unusual-tax",
          key: "unusual-tax",
          title: "Unusual tax charge",
          detail: `The income tax charge is ${formatMagnitude(Math.abs(divergence))} ${direction} ${STATUTORY_TAX_RATE_PCT}% of pre-tax income, past the declared ${TAX_DIVERGENCE_PCT_OF_REVENUE}% of quarterly revenue (${formatMagnitude(taxBand)}), and the same quarter last year was not also flagged.`,
          question:
            "What does the filing say the income tax charge or benefit for this quarter consists of, and why does it differ from the statutory rate?",
          source: { scope: "financials" },
        });
      }
    }
  }

  if (
    netIncome !== undefined &&
    operatingIncome !== undefined &&
    Math.sign(netIncome) * Math.sign(operatingIncome) < 0
  ) {
    out.push({
      kind: "opposite-signs",
      key: "opposite-signs",
      title: "Net income and operating income have opposite signs",
      detail: `Operating income is ${operatingIncome < 0 ? MINUS : ""}${formatMagnitude(Math.abs(operatingIncome))} and net income is ${netIncome < 0 ? MINUS : ""}${formatMagnitude(Math.abs(netIncome))}.`,
      question:
        "What does the filing say happened below operating income to turn the result from a profit into a loss, or from a loss into a profit?",
      source: { scope: "financials" },
    });
  }

  return out;
}

/**
 * The filing behind a red-flag finding, matched back out of the submissions
 * list by form and date.
 *
 * The finding itself deliberately carries no accession number: the red-flag
 * rules are a snapshotted rules output, and widening them to carry a
 * pointer for a downstream consumer would change every stored snapshot
 * without changing a single verdict. The lookup here is exact -- same form,
 * same filing date, and for an 8-K the same item -- so it either finds the
 * filing or reports none.
 */
export function filingBehindRedFlag(
  subs: CompanySubmissions,
  finding: RedFlagFinding
): FilingEntry | undefined {
  if (finding.type === "late-filing-12b25") {
    return subs.filings.find(
      (f) => (f.form === "NT 10-Q" || f.form === "NT 10-K") && f.filingDate === finding.date
    );
  }
  if (finding.type.startsWith("8-K-")) {
    const item = finding.type.slice("8-K-".length);
    return subs.filings.find(
      (f) =>
        f.form === "8-K" &&
        f.filingDate === finding.date &&
        f.items.split(",").map((s) => s.trim()).includes(item)
    );
  }
  // "missed-deadline" is the absence of a filing. There is nothing to read.
  return undefined;
}

/** The trigger key for one restructuring filing: unique per filing, and the cache row is stored under that filing. */
export function restructuringKey(accessionNumber: string): string {
  return `restructuring:${accessionNumber}`;
}

/** The restructuring filings behind a spending-cuts signal, newest first. */
export function restructuringFilingsOf(lens: LensResult): { filingDate: string; accessionNumber: string }[] {
  return lens.retrenchment.filings ?? [];
}

export function buildExplanationTriggers(
  kf: KeyFinancials,
  lens: LensResult,
  subs: CompanySubmissions,
  flags: { acquisitions?: boolean } = {}
): ExplanationTrigger[] {
  const triggers: ExplanationTrigger[] = [...financialTriggers(kf)];

  // Acquisitions and investments past the declared share of revenue: the
  // line is often a mix (businesses, private stakes, other), and the filing
  // is where the company says what it bought.
  if (flags.acquisitions) {
    triggers.push({
      kind: "acquisitions",
      key: "acquisitions",
      title: "Acquisitions and investments",
      detail: `The acquisitions line is above ${ACQUISITIONS_PCT_OF_REVENUE}% of quarterly revenue.`,
      question:
        "What does the filing say the company acquired or invested in this quarter, in the line for acquisitions, non-marketable investments and similar payments?",
      source: { scope: "financials" },
    });
  }

  // Spending cuts: each restructuring filing is its own trigger, read from
  // that 8-K and cached under it -- a filing never changes, so its answer is
  // asked for once, and a second filing in the window is a second question
  // rather than a rewrite of the first. An R&D or SG&A cut is a figure in
  // the quarter, so the quarter's own filed text answers it.
  for (const filing of restructuringFilingsOf(lens)) {
    const entry = subs.filings.find((f) => f.accessionNumber === filing.accessionNumber);
    triggers.push({
      kind: "restructuring",
      key: restructuringKey(filing.accessionNumber),
      title: "Restructuring filing",
      detail: `A restructuring filing (8-K Item 2.05) filed ${filing.filingDate}.`,
      question:
        "What does this filing say the restructuring or cost-reduction plan is, and why the company is undertaking it?",
      source: entry
        ? { scope: "filing", accessionNumber: entry.accessionNumber, form: entry.form, filingDate: entry.filingDate }
        : { scope: "none", reason: "The filing is not in the submissions list." },
    });
  }
  const figureCuts = lens.retrenchment.causes.filter((c) => /^(R&D|SG&A)/.test(c));
  if (figureCuts.length > 0) {
    triggers.push({
      kind: "retrenchment",
      key: "retrenchment",
      title: "Spending cuts",
      detail: `Spending under review: ${figureCuts.join("; ")}.`,
      question:
        "What does the filing say about why research and development or selling, general and administrative spending fell, or about a cost-reduction plan?",
      source: { scope: "financials" },
    });
  }

  if (lens.paymentBehavior.state === "rising") {
    const pct = lens.paymentBehavior.yoyPctChange;
    triggers.push({
      kind: "dpo-rising",
      key: "dpo-rising",
      title: "Payables stretching",
      detail: `Payables ≈ ${lens.paymentBehavior.dpoCurrent?.toFixed(1) ?? "MISSING"} days of cost of revenue, up ${pct === undefined ? "MISSING" : Math.round(pct)}% Y/Y, past the declared ±${DPO_BAND_PCT}% band.`,
      question:
        "What does the filing say about the change in accounts payable, supplier payment terms, or supplier financing arrangements?",
      source: { scope: "financials" },
    });
  }

  for (const finding of lens.redFlags.findings) {
    const filing = filingBehindRedFlag(subs, finding);
    triggers.push({
      kind: "red-flag",
      key: `red-flag:${finding.type}:${finding.date}`,
      title: `Red flag: ${finding.type}`,
      detail: finding.detail,
      question:
        finding.type === "late-filing-12b25"
          ? "What reason does this notification of late filing give for the filing not being made on time?"
          : "What does this filing say happened, and why?",
      source: filing
        ? {
            scope: "filing",
            accessionNumber: filing.accessionNumber,
            form: filing.form,
            filingDate: filing.filingDate,
          }
        : {
            scope: "none",
            reason: "No filing was made, so there is no filed text to read.",
          },
    });
  }

  return triggers;
}
