import { normalizeForMatch } from "@/lib/claude/sourceText";
import { SourceDoc } from "@/lib/claude/sources";

/**
 * The check that decides whether a sentence is allowed on screen.
 *
 * "Claude may cite a figure only if it appears verbatim in the cited
 * passage. The app checks every quoted figure and passage against the
 * source text by string match; a sentence that fails the check is dropped,
 * never shown."
 *
 * Three gates, in order:
 *
 *  1. Every quoted passage must appear in the cited source document,
 *     whitespace-normalised. A passage that doesn't is discarded.
 *  2. Every figure in a sentence must appear in one of that item's
 *     surviving passages. This is the gate that stops the model doing
 *     arithmetic: if it converts "7,772" into "$7.8 billion", the figure
 *     it wrote is not in the filing and the sentence goes.
 *  3. No sentence may use the app's own vocabulary -- the quadrant names,
 *     the payment-terms ladder, the metric names. "Claude never restates
 *     the verdict, the terms or any computed number; the page already
 *     shows them."
 *
 * Failing sentences are dropped rather than corrected, and the reason is
 * kept so the report can show what was rejected. If nothing survives, the
 * item reads "Not explained in the filing." -- a filing that doesn't
 * explain something is a normal, reportable outcome.
 */

export interface RawExplanation {
  trigger_key: string;
  /** The model's own "the filing does not say" answer, which is a correct answer. */
  not_explained?: boolean;
  /** The source document the passages come from, by the id the prompt gave it. */
  source_id: string;
  /** A note or sub-heading inside that document. Verified; dropped if absent. */
  section?: string;
  sentences: string[];
  passages: string[];
}

export interface Citation {
  form: string;
  filingDate: string;
  accessionNumber: string;
  /** The exhibit type or document section, e.g. "EX-99.2" or "Management's Discussion and Analysis". */
  part: string;
  /** A note or sub-heading, only when it was found verbatim in the source. */
  section?: string;
}

export interface DroppedSentence {
  text: string;
  reason: string;
}

export interface VerifiedExplanation {
  triggerKey: string;
  sentences: string[];
  passages: string[];
  citation: Citation | undefined;
  dropped: DroppedSentence[];
}

/**
 * The app's own words. A sentence containing any of these is restating
 * something the page already decided, so it is dropped regardless of
 * whether it is true.
 *
 * The list is deliberately made of terms no filer writes about itself --
 * quadrant names as a whole phrase, the Net-30/45/60 ladder, the metric
 * abbreviations, the Altman score. Single common words ("strong", "weak",
 * "monitor") are NOT here: filings use them about their own business all
 * the time, and banning them would drop true explanations to catch a
 * paraphrase the figure check already blocks.
 */
const APP_VOCABULARY: { re: RegExp; what: string }[] = [
  { re: /pursue with guardrails/i, what: "the verdict quadrant" },
  { re: /limit exposure/i, what: "the verdict quadrant" },
  { re: /\bNet\s*(?:30|45|60)\b/i, what: "the payment terms" },
  { re: /escalate before signing/i, what: "the terms escalation" },
  { re: /\bAltman\b|\bZ['’]{2}\b/i, what: "the Altman score" },
  { re: /\bDSO\b|\bDPO\b/, what: "a computed metric name" },
  { re: /days (?:sales|payables) outstanding/i, what: "a computed metric" },
  { re: /counterparty risk|relationship opportunity/i, what: "a matrix axis" },
  { re: /credit exposure/i, what: "the deal structure" },
  { re: /retrenchment/i, what: "a signal name" },
  { re: /red[- ]flag/i, what: "a signal name" },
];

/** Every figure-like token in a sentence: 1,234 / 3.5 / 21 / 2026. */
function figureTokens(sentence: string): string[] {
  return sentence.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
}

/** "1,234" and "1234" both match a passage that writes it either way. */
function numberVariants(token: string): string[] {
  const stripped = token.replace(/,/g, "");
  return stripped === token ? [token] : [token, stripped];
}

function containsFigure(haystack: string, haystackNoCommas: string, token: string): boolean {
  return numberVariants(token).some((v) => haystack.includes(v) || haystackNoCommas.includes(v));
}

export interface VerifyInput {
  raw: RawExplanation;
  /** The document the raw explanation's source_id resolved to. */
  doc: SourceDoc | undefined;
}

export function verifyExplanation({ raw, doc }: VerifyInput): VerifiedExplanation {
  const dropped: DroppedSentence[] = [];

  if (!doc) {
    // The model named a source that was never sent. Nothing here can be
    // checked against anything, so nothing is shown.
    return {
      triggerKey: raw.trigger_key,
      sentences: [],
      passages: [],
      citation: undefined,
      dropped: (raw.sentences ?? []).map((text) => ({
        text,
        reason: `cited source "${raw.source_id}" is not one of the documents sent`,
      })),
    };
  }

  const sourceNorm = normalizeForMatch(doc.text);

  const passages: string[] = [];
  for (const passage of raw.passages ?? []) {
    const norm = normalizeForMatch(passage);
    if (norm.length < 12) {
      dropped.push({ text: passage, reason: "quoted passage too short to verify" });
      continue;
    }
    if (!sourceNorm.includes(norm)) {
      dropped.push({ text: passage, reason: `quoted passage not found in ${doc.part}` });
      continue;
    }
    passages.push(passage);
  }

  const passageHaystack = passages.map(normalizeForMatch).join(" ‖ ");
  const passageHaystackNoCommas = passageHaystack.replace(/,/g, "");

  const sentences: string[] = [];
  for (const sentence of raw.sentences ?? []) {
    const banned = APP_VOCABULARY.find((v) => v.re.test(sentence));
    if (banned) {
      dropped.push({ text: sentence, reason: `restates ${banned.what}` });
      continue;
    }
    if (passages.length === 0) {
      dropped.push({ text: sentence, reason: "no verified passage to support it" });
      continue;
    }
    const unsupported = figureTokens(sentence).filter(
      (t) => !containsFigure(passageHaystack, passageHaystackNoCommas, t)
    );
    if (unsupported.length > 0) {
      dropped.push({
        text: sentence,
        reason: `figure(s) ${unsupported.join(", ")} not present in any quoted passage`,
      });
      continue;
    }
    sentences.push(sentence);
  }

  // Only the sub-section name is optional: it is Claude's own words about
  // where in the document it read, so it is shown only when those words
  // are in the document.
  const section =
    raw.section && sourceNorm.includes(normalizeForMatch(raw.section)) ? raw.section : undefined;

  return {
    triggerKey: raw.trigger_key,
    sentences: sentences.slice(0, 2), // "one or two sentences"
    passages,
    citation:
      sentences.length > 0
        ? {
            form: doc.form,
            filingDate: doc.filingDate,
            accessionNumber: doc.accessionNumber,
            part: doc.part,
            section,
          }
        : undefined,
    dropped,
  };
}
