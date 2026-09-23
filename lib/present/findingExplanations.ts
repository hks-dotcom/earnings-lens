import type { ExplainedItem } from "@/lib/claude/explain";
import type { Citation } from "@/lib/claude/verify";
import { StandOutItem } from "@/lib/present/standOut";

/**
 * Claude's explanations, placed where they belong: as the closing
 * sentence(s) of the finding they explain.
 *
 * A finding names the explanation it can take by trigger key, and only an
 * item that came back explained -- at least one sentence through the
 * verbatim check -- contributes anything. A filing that doesn't explain
 * the item, a disabled or capped layer, a failed call: in every one of
 * those the finding ends at its own rule-based sentence and reads
 * complete, because it always did.
 */

export interface FindingExplanation {
  sentences: string[];
  passages: string[];
  citation: Citation | undefined;
}

/**
 * The dollar figures a finding already shows ("$53.4B", "$27,461M"), as the
 * digits a sentence would repeat them with: "53.4", "27,461" and "27461".
 */
function shownDollarFigures(shown: string): string[] {
  const out = new Set<string>();
  for (const m of shown.matchAll(/\$\s?([\d,]+(?:\.\d+)?)/g)) {
    out.add(m[1]);
    out.add(m[1].replace(/,/g, ""));
  }
  return [...out].filter((f) => /\d/.test(f));
}

/**
 * Drops an explanation sentence that repeats a dollar figure the finding
 * already shows in its own sentence or figures line, by string match on the
 * figure's digits ("$53.4 billion" repeats "$53.4B"). The prompt asks for
 * this already; this is the check that holds when it isn't followed.
 */
export function withoutRepeatedDollars(sentences: string[], shown: string): { kept: string[]; dropped: string[] } {
  const figures = shownDollarFigures(shown);
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const s of sentences) {
    const repeats = figures.some((f) => new RegExp(`(?<![\\d.,])${f.replace(/[.,]/g, (c) => `\\${c}`)}(?![\\d]|[.,]\\d)`).test(s));
    (repeats ? dropped : kept).push(s);
  }
  return { kept, dropped };
}

/** What the finding shows before its explanation: the rule-based sentence and the figures line. */
export function findingShownText(item: StandOutItem): string {
  return [item.sentence, ...(item.more ?? []).map((m) => m.sentence), item.figures].join(" ");
}

export function explanationFor(
  key: string | undefined,
  explained: ExplainedItem[],
  shown = ""
): FindingExplanation | undefined {
  if (!key) return undefined;
  const item = explained.find((e) => e.trigger.key === key);
  if (!item || item.state !== "explained" || item.sentences.length === 0) return undefined;
  const { kept } = withoutRepeatedDollars(item.sentences, shown);
  if (kept.length === 0) return undefined;
  return { sentences: kept, passages: item.passages, citation: item.citation };
}

/**
 * A short name for where in the filing the passage was read: "MD&A",
 * "Notes", or the exhibit type. A filing's own body needs no name beyond
 * its form.
 */
function shortPart(c: Citation): string | undefined {
  if (c.part === "Management's Discussion and Analysis") return "MD&A";
  if (c.part === "Financial statements and notes") return "Notes";
  if (c.part === `${c.form} body`) return undefined;
  return c.part;
}

/** "10-Q, MD&A" -- the small citation after the sentence. */
export function citationLabel(c: Citation): string {
  const part = shortPart(c);
  return part ? `${c.form}, ${part}` : c.form;
}

/**
 * "MD&A, Other Income (Expense), Net" -- the part and the section, as
 * named in the filing where it was found. A filing's own body has no part
 * name worth giving, so only its section shows.
 */
export function citationSection(c: Citation): string {
  const part = shortPart(c);
  if (!part) return c.section ?? "main document";
  return c.section ? `${part}, ${c.section}` : part;
}

/** "10-Q filed 2026-07-31 · MD&A, Other Income (Expense), Net · accession 0001018724-26-000026" */
export function citationDetail(c: Citation): string {
  return `${c.form} filed ${c.filingDate} · ${citationSection(c)} · accession ${c.accessionNumber}`;
}

/**
 * For each trigger key, what its finding already shows the reader before
 * the explanation: the headline, the rule-based sentence the explanation
 * will follow, and the figures line. The Claude layer is told to leave all
 * of it out.
 */
export function shownByExplainKey(items: StandOutItem[]): Map<string, string> {
  const out = new Map<string, string>();
  const figures = (item: StandOutItem) => (item.figures ? ` Figures: ${item.figures}` : "");
  for (const item of items) {
    if (item.explainKey) out.set(item.explainKey, `${item.headline} ${item.sentence}${figures(item)}`);
    for (const key of item.alsoExplainKeys ?? []) out.set(key, `${item.headline} ${item.sentence}${figures(item)}`);
    for (const m of item.more ?? []) out.set(m.explainKey, `${item.headline} ${m.sentence}${figures(item)}`);
  }
  return out;
}

/**
 * The finding's running text as one string: the rule-based sentence, the
 * explanation that closes it with its citation in brackets (for spending
 * cuts, one per restructuring filing), and for the one-off item each
 * further sentence with its own. The Copy brief's
 * version of what the board shows.
 */
export function findingProse(item: StandOutItem, explained: ExplainedItem[]): string {
  const shown = findingShownText(item);
  const closing = (key: string | undefined) => {
    const e = explanationFor(key, explained, shown);
    if (!e) return "";
    const cite = e.citation ? ` [${citationLabel(e.citation)}: ${citationDetail(e.citation)}]` : "";
    return ` ${e.sentences.join(" ")}${cite}`;
  };
  const withExplanation = (sentence: string, key: string | undefined) => `${sentence}${closing(key)}`;
  return [
    `${withExplanation(item.sentence, item.explainKey)}${(item.alsoExplainKeys ?? []).map(closing).join("")}`,
    ...(item.more ?? []).map((m) => withExplanation(m.sentence, m.explainKey)),
  ].join(" ");
}
