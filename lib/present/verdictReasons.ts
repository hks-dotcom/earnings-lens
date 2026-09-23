import { LensResult } from "@/lib/rules/evaluateLens";
import { KeyFinancials } from "@/lib/xbrl/keyFinancials";
import { LadderRung } from "@/lib/rules/ladder";
import {
  ALTMAN_ZONES,
  DPO_BAND_PCT,
  GROWTH_FLAT_BAND_PCT,
  PAYMENT_TERMS_BASELINE_DAYS,
  PAYMENT_TERMS_CEILING_DAYS,
  RUNWAY_NEUTRAL_CAP_QUARTERS,
  RUNWAY_WEAK_BELOW_QUARTERS,
} from "@/lib/rules/declaredValues";
import { bandPctWords, dpoMissingReason, payablesShown, RED_FLAG_HEADLINE } from "@/lib/present/standOut";
import { LENS_NAME } from "@/lib/present/lensNames";
import { MINUS } from "@/lib/present/format";
import { runwayCaveat, runwaySubject } from "@/lib/rules/runway";
import { riskWord } from "@/lib/present/riskWords";
import { formatDate } from "@/lib/rules/redFlags";
import { restructuringFilingsOf } from "@/lib/rules/explanationTriggers";

/**
 * The verdict hero's subline and the "Why this verdict" box.
 *
 * Both are read off the rules' output and nothing else: the rung, the
 * zone, the payables trend, the red flags, the runway and the opportunity
 * inputs the ladder and the matrix already decided on. Every figure here
 * is one of the rules' own values, formatted the way the findings below
 * format it, so the box and the finding it points at never disagree.
 *
 * The box says which input decided each axis and why, with its figure. The
 * rules themselves -- every threshold and how they combine -- are in the
 * board's footnote, not here.
 */

/** "Offer Net 30 and hold it": the hero's terms phrase, by rung. */
export function heroTermsPhrase(rung: LadderRung): string {
  if (rung === "Strong") return `Offer Net ${PAYMENT_TERMS_BASELINE_DAYS}; Net ${PAYMENT_TERMS_CEILING_DAYS} if pushed`;
  if (rung === "Neutral") return `Offer Net ${PAYMENT_TERMS_BASELINE_DAYS} and hold it`;
  return `Offer Net ${PAYMENT_TERMS_BASELINE_DAYS} · escalate before signing`;
}

/**
 * "low", or "low, with spending cuts". Spending cuts don't move the rung or
 * the terms, but they put the company in the higher-risk half of the
 * matrix on their own, so a bare "low" beside that column would leave the
 * reader to work out why. The matrix's risk axis reads the same phrase.
 */
export function riskLabel(lens: LensResult): string {
  return `${riskWord(lens.ladder.rung)}${lens.retrenchment.triggered ? ", with spending cuts" : ""}`;
}

/** "Risk: medium · Opportunity: high · Offer Net 30 and hold it" */
export function heroSubline(lens: LensResult): string {
  return `Risk: ${riskLabel(lens)} · Opportunity: ${lens.opportunity.high ? "high" : "low"} · ${heroTermsPhrase(lens.ladder.rung)}`;
}

export interface WhyLine {
  /** "Risk: medium." -- set in bold on the page. */
  label: string;
  /** The deciding reason with its figure, then any context. */
  text: string;
}

export interface WhyThisVerdict {
  risk: WhyLine;
  opportunity: WhyLine;
}

function zScore(z: number): string {
  return `${z < 0 ? MINUS : ""}${Math.abs(z).toFixed(2)}`;
}


/**
 * The latest restructuring filing, and how many came before it in the
 * window: "a restructuring filing (8-K Item 2.05) on 3 Jun 2026 and 1
 * earlier". Undefined when there is none.
 */
export function restructuringWords(lens: LensResult): string | undefined {
  const filings = restructuringFilingsOf(lens);
  if (filings.length === 0) return undefined;
  const earlier = filings.length > 1 ? ` and ${filings.length - 1} earlier` : "";
  return `a restructuring filing (8-K Item 2.05) on ${formatDate(filings[0].filingDate)}${earlier}`;
}

/**
 * The retrenchment causes, as a reader would say them. The rules state
 * each cause in their own shorthand ("R&D down -3.4% Y/Y, beyond the 2%
 * flat band"); here the same facts read as a clause, with the restructuring
 * filings named by the latest one.
 */
function spendingCutWords(lens: LensResult): string {
  const cuts = lens.retrenchment.causes
    .map((c) => c.match(/^(R&D|SG&A) down -?([\d.]+)% Y\/Y/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => `${m[1]} down ${m[2]}% on last year`);
  const filing = restructuringWords(lens);
  return [...(filing ? [filing] : []), ...cuts].join(" and ");
}

/**
 * The payables clause when payables are not rising beyond the band: the
 * fact, with no reading of it. Falling beyond the band states the day
 * counts; within the band says so.
 */
function payablesNotRising(lens: LensResult): string {
  const shown = payablesShown(lens);
  if (lens.paymentBehavior.state === "falling" && shown) {
    return `payables are falling: ${shown.days} days of cost of revenue, from ${shown.daysYearAgo} a year ago`;
  }
  return `payables are within the ±${DPO_BAND_PCT}% band`;
}

function riskReason(lens: LensResult, kf: KeyFinancials): string {
  const zone = lens.altmanZone;
  const z = zone.z === undefined ? undefined : zScore(zone.z);
  const pay = lens.paymentBehavior;
  const shown = payablesShown(lens);
  const flags = lens.redFlags.findings;
  const rising = pay.state === "rising" && shown !== undefined;
  const payMissing = pay.state === "missing" || shown === undefined;

  const payablesUp = rising ? `payables are ${shown!.move} on last year, beyond the ±${DPO_BAND_PCT}% band` : "";
  const payablesUnknown = `payables can't be measured because ${dpoMissingReason(kf)}`;
  const noFlagsAndPayables = rising
    ? `There are no red flags, and ${payablesUp}.`
    : payMissing
      ? `There are no red flags, and ${payablesUnknown}.`
      : `There are no red flags and ${payablesNotRising(lens)}.`;

  const zoneSentence =
    zone.zone === undefined || z === undefined
      ? "The Z'' score can't be computed for this quarter, so the balance sheet can't be confirmed safe."
      : zone.capped
        ? `Z'' scores in distress (${z}), but the company is profitable and cash-generative, so it's read as grey.`
        : zone.zone === "safe"
          ? `The balance sheet is safe (Z'' ${z}).`
          : zone.zone === "grey"
            ? `The balance sheet is in the grey zone (Z'' ${z}).`
            : `Z'' scores in distress (${z}), under ${ALTMAN_ZONES.distressBelow}.`;

  // The finding's own headline, as a sentence: "A late-filing notice is on
  // file: NT 10-Q filed 18 May 2026; 10-Q filed 19 May 2026."
  const flagSentences = flags.map(
    (f) => `${RED_FLAG_HEADLINE[f.type].replace(/ on file\.$/, " is on file.").replace(/\.$/, "")}: ${f.detail}`
  );

  // The balance-sheet rules, in the order the ladder applies them, each
  // with the sentences that say what decided it and then what else holds.
  let base: LadderRung;
  let sentences: string[];
  if (zone.zone === "distress") {
    base = "Weak";
    sentences = [zoneSentence, ...flagSentences];
  } else if (flags.length > 0) {
    base = "Weak";
    sentences = [...flagSentences, zoneSentence];
  } else if (zone.zone === "grey" && rising) {
    base = "Weak";
    sentences = zone.capped
      ? [zoneSentence, `${payablesUp[0].toUpperCase()}${payablesUp.slice(1)}.`, "There are no red flags."]
      : [`The balance sheet is in the grey zone (Z'' ${z}) and ${payablesUp}.`, "There are no red flags."];
  } else if (zone.zone === "safe" && !rising) {
    base = "Strong";
    sentences = payMissing
      ? [`The balance sheet is safe (Z'' ${z}), there are no red flags, and ${payablesUnknown}.`]
      : [`The balance sheet is safe (Z'' ${z}), there are no red flags and ${payablesNotRising(lens)}.`];
  } else if (zone.zone === "safe") {
    base = "Neutral";
    sentences = [
      `${payablesUp[0].toUpperCase()}${payablesUp.slice(1)}.`,
      `The balance sheet is safe (Z'' ${z}) and there are no red flags.`,
    ];
  } else {
    // Grey without rising payables, or no score at all.
    base = "Neutral";
    sentences = [zoneSentence, noFlagsAndPayables];
  }

  // Runway, applied over the top exactly as the ladder applies it: it can
  // only move the rung down, and it decides only when it does.
  const cash = lens.cashPosition;
  const quarters = cash.case === "burn" ? cash.quarters : undefined;
  if (quarters !== undefined) {
    const covers = `about ${quarters} quarter${quarters === 1 ? "" : "s"} of burn`;
    // "Cash and short-term investments cover" / "Cash covers", and the
    // same with "also" after the subject when the runway is not deciding.
    const subject = runwaySubject(cash);
    const also = subject.replace(/ (covers?)$/, " also $1");
    const caveat = runwayCaveat(cash);
    if (quarters < RUNWAY_WEAK_BELOW_QUARTERS) {
      if (base === "Weak") {
        sentences.push(`${also} ${covers}, under ${RUNWAY_WEAK_BELOW_QUARTERS}, which on its own sets risk to ${riskWord("Weak")}${caveat}.`);
      } else {
        sentences.unshift(`${subject} ${covers}, under ${RUNWAY_WEAK_BELOW_QUARTERS}, so risk is ${riskWord("Weak")}${caveat}.`);
      }
    } else if (quarters < RUNWAY_NEUTRAL_CAP_QUARTERS) {
      if (base === "Strong") {
        sentences.unshift(`${subject} ${covers}, under ${RUNWAY_NEUTRAL_CAP_QUARTERS}, so risk is capped at ${riskWord("Neutral")}${caveat}.`);
      } else {
        sentences.push(
          `${also} ${covers}, under ${RUNWAY_NEUTRAL_CAP_QUARTERS}, which on its own caps risk at ${riskWord("Neutral")}${caveat}.`
        );
      }
    }
  }

  if (lens.ladder.escalateBeforeSigning) sentences.push("Escalate before signing.");

  // Spending cuts decide the matrix column whatever the rung, so they lead,
  // and the rung's own reasons follow after "Otherwise".
  if (lens.retrenchment.triggered) {
    const causes = spendingCutWords(lens);
    const verb = lens.retrenchment.causes.length > 1 ? "put" : "puts";
    const lead = `${causes[0].toUpperCase()}${causes.slice(1)} ${verb} it in the higher-risk half of the matrix.`;
    const [first, ...rest] = sentences;
    // "Otherwise the balance sheet is safe", but "Otherwise Z'' scores in
    // distress" and "Otherwise R&D ...": a name keeps its capitals.
    const keepCase = /^(Z''|[A-Z&]{2,})/.test(first);
    return [lead, `Otherwise ${keepCase ? first : `${first[0].toLowerCase()}${first.slice(1)}`}`, ...rest].join(" ");
  }
  return sentences.join(" ");
}

function opportunityReason(lens: LensResult): string {
  const revenue = lens.revenue;
  const rd = lens.engineeringSpend;

  if (lens.lens === "SaaS" && lens.retrenchment.triggered) {
    return `Spending cuts set opportunity low for ${LENS_NAME.SaaS}: ${spendingCutWords(lens)}.`;
  }
  if (revenue.direction === undefined || revenue.yoyPct === undefined) {
    return "Revenue on last year is not filed, so opportunity can't be read as high.";
  }

  const band = `the ±${GROWTH_FLAT_BAND_PCT}% flat band`;
  const revenueClause = `Revenue is ${bandPctWords(revenue.yoyPct, GROWTH_FLAT_BAND_PCT)} on last year, ${
    revenue.direction === "flat" ? "within" : "beyond"
  } ${band}`;

  if (lens.opportunity.rdNotFiled) {
    return `${revenueClause}; R&D is not filed, so revenue decides alone.`;
  }
  if (revenue.direction !== "up") return `${revenueClause}.`;

  const rdClause = `R&D is ${bandPctWords(rd.yoyPct!, GROWTH_FLAT_BAND_PCT)}${rd.direction === "flat" ? ", within the band" : ""}`;
  if (rd.direction === "down") return `${revenueClause}, but ${rdClause} on last year, beyond the band.`;
  return `${revenueClause}, and ${rdClause}.`;
}

export function whyThisVerdict(lens: LensResult, kf: KeyFinancials): WhyThisVerdict {
  return {
    risk: { label: `Risk: ${riskLabel(lens)}.`, text: riskReason(lens, kf) },
    opportunity: {
      label: `Opportunity: ${lens.opportunity.high ? "high" : "low"}.`,
      text: opportunityReason(lens),
    },
  };
}
