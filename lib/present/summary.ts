import { LensResult } from "@/lib/rules/evaluateLens";
import { KeyFinancials } from "@/lib/xbrl/keyFinancials";
import { FinancialHealth } from "@/lib/metrics/health";
import { AltmanZoneName } from "@/lib/metrics/health";
import { runwayInWords, runwaySubject } from "@/lib/rules/runway";
import { buildStandOut, operatingTrajectory, StandOutItem } from "@/lib/present/standOut";
import { financialTriggers } from "@/lib/rules/explanationTriggers";
import { termsSentence } from "@/lib/present/termsSentence";
import { chooseUnit } from "@/lib/present/format";
import { restructuringWords } from "@/lib/present/verdictReasons";

/**
 * The Summary: commentary, templated from the rules' output.
 *
 * "It says what the numbers mean, and leaves the numbers to the table, the
 * health panel and 'What stands out'." So there are no ratio values in
 * here at all -- no Z'', no percentages, no dollar figures. A duration in
 * words is the one exception the spec allows, because "more than three
 * years of runway" is the meaning of the figure rather than the figure.
 *
 * Nothing here calls anything: the page is complete without Claude.
 *
 * The six parts, in the spec's order:
 *   1. the verdict
 *   2. the balance sheet in words: strong, in the grey zone, or distressed
 *   3. the trajectory: losses shrinking or growing, profits growing or falling
 *   4a. the cash position: runway for a burn, investment ahead of operations for heavy investment
 *   4b. a pointer to the explanation, when a one-off moved net income
 *   4c. the single most important watch item ("The one thing to watch is ...")
 *   5. what it means for the relationship
 *   6. the terms sentence
 *
 * Parts 2, 3 and 4a share one sentence: what the balance sheet is, which
 * way the business is going, and what the cash flow statement says are
 * three halves of one observation, and as separate sentences the second
 * and third read as afterthoughts.
 */

export const SUMMARY_HEADING = "Summary";

/**
 * The balance sheet in words, from the zone the rules used -- after the
 * Z'' cap, so a company whose distress score was lifted to grey reads as
 * grey here too.
 *
 * Never "cash-rich". Z'' is not a cash measure: two of its four terms are
 * about accumulated earnings and book equity, and a company can score
 * safely on it while burning through what cash it has. "Strong" is what
 * the score actually says.
 */
function zoneWords(zone: AltmanZoneName | undefined): string | undefined {
  if (zone === undefined) return undefined;
  if (zone === "safe") return "strong";
  if (zone === "distress") return "distressed";
  return "in the grey zone";
}

/**
 * Whether a clause is good news, bad news or neither, so the sentence can
 * be joined with the right conjunction.
 *
 * "The balance sheet is strong and profits are growing" and "the balance
 * sheet is distressed but the losses are shrinking" are both correct; swap
 * the conjunctions and both are wrong in a way a reader notices before
 * they notice anything else.
 */
type Polarity = -1 | 0 | 1;

function zonePolarity(zone: AltmanZoneName | undefined): Polarity {
  if (zone === "safe") return 1;
  if (zone === "distress") return -1;
  return 0;
}

/**
 * Parts 2, 3 and 4a as one sentence: what the balance sheet is, which way
 * the business is going, and what the cash flow statement says.
 *
 * Every piece is a clause with its own subject and verb, joined with "and"
 * or "but" -- never a noun phrase spliced onto a clause, which is how
 * "A cash-rich balance sheet, with investment running ahead of operations,
 * and profits are growing" happened.
 */
function positionSentence(lens: LensResult, kf: KeyFinancials): string {
  const zone = lens.altmanZone.zone;
  const words = zoneWords(zone);
  const balance = words ? `The balance sheet is ${words}` : "The balance-sheet score is not available";

  const trajectory = operatingTrajectory(kf, chooseUnit(kf.revenue.values[0]?.value));
  const cash = cashClause(lens);

  const balancePolarity = zonePolarity(zone);
  const trajectoryPolarity: Polarity = trajectory ? (trajectory.tone === "good" ? 1 : -1) : 0;

  let sentence = balance;
  // A "but" only where the news actually turns, and only once: a sentence
  // that turns twice reads as two sentences badly punctuated.
  let turned = false;
  if (trajectory) {
    const contrast = balancePolarity * trajectoryPolarity < 0;
    turned = contrast;
    sentence += ` ${contrast ? "but" : "and"} ${trajectory.summaryClause}`;
  }
  if (cash) {
    // The cash clause is always the cautionary one, so it contrasts with
    // whatever came before it only if that was good news.
    const previous = trajectory ? trajectoryPolarity : balancePolarity;
    sentence += `, ${!turned && previous > 0 ? "but" : "and"} ${cash}`;
  }
  return `${sentence}.`;
}

/**
 * Part 4a: what the cash flow statement says, as a clause.
 *
 * Heavy investment is not a runway story and must never borrow the word:
 * operations funded the quarter, and capital spending simply ran ahead of
 * them. A burn is the case with a runway, and when the burn cannot be
 * measured the clause says only what is known.
 */
function cashClause(lens: LensResult): string | undefined {
  if (lens.cashPosition.case === "heavy-investment") {
    return "investment is currently running ahead of cash from operations";
  }
  if (lens.cashPosition.case !== "burn") return undefined;
  const duration = runwayInWords(lens.cashPosition.quarters);
  if (!duration) return "operations are consuming cash";
  const subject = runwaySubject(lens.cashPosition);
  return `${subject[0].toLowerCase()}${subject.slice(1)} ${duration} at the current burn`;
}

/**
 * Part 4b: the sentence that follows when a one-off sits between operating
 * income and net income.
 *
 * Parts 2 to 4a are deliberately about operating income and cash, because
 * that is what the lens rules read. A reader who looks from this paragraph
 * to the table then meets a net income the paragraph never accounts for --
 * investment gains, a valuation-allowance charge -- and the honest answer
 * is one line pointing at the one-off item in "What stands out", which
 * carries the figures and, when the filing gives one, the reason. It
 * carries no figure, because it is not the Summary's job to state one and
 * the figures are directly below it.
 *
 * When both tests fire, the tax sentence is used: a tax item is the more
 * specific of the two, and the item below states both either way.
 */
function oneOffSentence(kf: KeyFinancials): string | undefined {
  const kinds = new Set(financialTriggers(kf).map((t) => t.kind));
  if (kinds.has("unusual-tax")) {
    return "A one-off tax item moved net income this quarter; see below.";
  }
  if (kinds.has("non-operating-swing")) {
    return "A one-off non-operating item moved net income this quarter; see below.";
  }
  return undefined;
}

/**
 * Part 4c: the one thing to watch.
 *
 * Read off "What stands out" in its own fixed order, so the item the
 * Summary singles out is the first one a reader meets below it.
 *
 * Three kinds are skipped, because another part of this same paragraph
 * already says them: cash burn (part 2's runway), the operating-income
 * move (part 3's trajectory) and spending cuts (part 5, which answers with
 * nothing else whenever they are present). The spec's own worked example
 * is the rule here -- a company with cash burn above costs in "What stands
 * out" still has its Summary single out costs -- and a paragraph whose
 * fourth sentence repeats its second has spent a sentence saying nothing.
 */
const ALREADY_SAID: StandOutItem["kind"][] = ["cash-burn", "heavy-investment", "losses", "spending-cuts"];

/** The display-only cash-flow findings: on the board and in the brief, never in the Summary. */
const NOT_IN_SUMMARY: StandOutItem["kind"][] = ["borrowing", "acquisitions", "returns"];

function watchClause(standOut: StandOutItem[]): string | undefined {
  const item = standOut.find(
    (i) => i.tone === "watch" && !ALREADY_SAID.includes(i.kind) && !NOT_IN_SUMMARY.includes(i.kind)
  );
  if (!item) return undefined;
  const headline = item.headline.replace(/\.$/, "");
  return `The one thing to watch is ${headline[0].toLowerCase()}${headline.slice(1)}.`;
}

/**
 * Part 5: what it means for the relationship.
 *
 * Retrenchment is checked first and answers on its own: R&D or SG&A
 * falling is exactly the case where revenue growth would otherwise read as
 * an expanding customer. A restructuring filing is named by the latest
 * one, with a count of any earlier ones in the window.
 */
function relationshipSentence(lens: LensResult): string {
  if (lens.retrenchment.triggered) {
    const filing = restructuringWords(lens);
    return filing
      ? `Spending cuts, including ${filing}, point to a shrinking customer.`
      : "Spending cuts point to a shrinking customer.";
  }

  const revenueUp = lens.revenue.direction === "up";
  if (!revenueUp) {
    if (lens.revenue.direction === undefined) {
      return "Revenue on last year is not filed, so there is nothing yet to say about the direction of the relationship.";
    }
    return "Revenue is not growing, so there is no sign yet of an expanding customer.";
  }

  if (lens.opportunity.rdNotFiled) return "Growth points to an expanding customer; R&D is not filed.";
  if (lens.engineeringSpend.direction === "up") {
    return "Growth and R&D investment both point to an expanding customer.";
  }
  return "Growth points to an expanding customer, with R&D spending held flat.";
}

export interface Summary {
  heading: string;
  /** Part 1: "Pursue with guardrails." */
  verdict: string;
  /**
   * Everything after the verdict, in order. Parts 2 and 3 share the first
   * sentence; the one-off pointer and part 4 are each absent when nothing
   * fired.
   *
   * The page shows only these: the verdict hero directly above already
   * says part 1, in larger type. The Copy brief, which has no hero, keeps
   * the verdict (see summaryText).
   */
  parts: string[];
}

export function buildSummary(
  lens: LensResult,
  kf: KeyFinancials,
  health: FinancialHealth,
  standOut: StandOutItem[] = buildStandOut(lens, kf, health)
): Summary {
  const parts = [positionSentence(lens, kf)];
  const oneOff = oneOffSentence(kf);
  if (oneOff) parts.push(oneOff);
  const watch = watchClause(standOut);
  if (watch) parts.push(watch);
  parts.push(relationshipSentence(lens));
  parts.push(termsSentence(lens));

  return { heading: SUMMARY_HEADING, verdict: `${lens.quadrant}.`, parts };
}

export function summaryText(
  lens: LensResult,
  kf: KeyFinancials,
  health: FinancialHealth,
  standOut?: StandOutItem[]
): string {
  const summary = buildSummary(lens, kf, health, standOut);
  return [summary.verdict, ...summary.parts].join(" ");
}
