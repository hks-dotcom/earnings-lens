/**
 * Filed HTML to plain text, and the section slicing that keeps a 10-Q down
 * to the parts a trigger can actually be answered from.
 *
 * Two hard requirements shape this module:
 *
 * 1. The text produced here is the text every quote is verified against.
 *    So the extraction has to be stable and lossless within a section: if
 *    a sentence of filed prose survives to the prompt, the exact same
 *    characters have to survive to the verifier, or a true quote would be
 *    rejected as fabricated.
 * 2. "Send only the relevant sections." A 10-Q is 100+ pages of which the
 *    management discussion and the notes are the parts that explain a
 *    figure. The rest -- cover page, controls, exhibits index, signatures,
 *    and the face financial statements the app already reads as XBRL --
 *    is not sent.
 */

const BLOCK_TAGS =
  "p|div|br|tr|td|th|li|h1|h2|h3|h4|h5|h6|table|tbody|thead|section|article|header|footer|blockquote";

/** Named and numeric entities that actually turn up in EDGAR HTML. */
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  bull: "•",
  middot: "·",
  sect: "§",
  reg: "®",
  copy: "©",
  trade: "™",
  deg: "°",
  plusmn: "±",
  times: "×",
  minus: "−",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith("#")) {
      const code = parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    const named = ENTITIES[body.toLowerCase()];
    return named ?? whole;
  });
}

/**
 * HTML (or a plain-text EDGAR document) to readable text.
 *
 * Block-level tags become newlines so a heading stays on its own line --
 * the section regexes below need that. Inline tags are simply dropped,
 * because inline XBRL wraps individual numbers in <span> tags and dropping
 * them without inserting a space is what keeps "$7,772" one token instead
 * of three.
 */
export function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(new RegExp(`<\\s*(?:${BLOCK_TAGS})\\b[^>]*>`, "gi"), "\n");
  s = s.replace(new RegExp(`<\\s*/\\s*(?:${BLOCK_TAGS})\\s*>`, "gi"), "\n");
  s = s.replace(/<[^>]*>/g, "");
  s = decodeEntities(s);
  // Non-breaking and zero-width characters, normalised so a quote typed from
  // the rendered filing still matches.
  s = s.replace(/[   ]/g, " ").replace(/[​-‍﻿]/g, "");
  // Collapse runs of spaces/tabs, then runs of blank lines. Newlines are
  // kept (one per block) because headings and table rows read as lines.
  s = s.replace(/[ \t]+/g, " ");
  s = s
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/** The whitespace-insensitive form both the prompt text and a quote are compared in. */
export function normalizeForMatch(s: string): string {
  return s
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export interface Section {
  /** Human name shown in a citation, e.g. "Item 2 — Management's Discussion and Analysis". */
  name: string;
  text: string;
}

/**
 * Heading candidates: a match that starts its own line, on a short line.
 *
 * Both tests are there to reject the same thing -- a filing that mentions
 * a section rather than starting one. "Item 7. Management's Discussion and
 * Analysis of Financial Conditions and Results of Operations" appears
 * inside a sentence in a 10-K as a cross-reference to last year's
 * filing; a real heading is its own block, so it begins a line and that
 * line ends shortly after. Without both tests the slicer anchors on the
 * cross-reference and the citation on screen names a section the quote did
 * not come from.
 */
const MAX_HEADING_LINE = 220;

function headingMatches(text: string, re: RegExp): number[] {
  const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  const hits: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text))) {
    if (rx.lastIndex === m.index) rx.lastIndex++;
    const lineStart = text.lastIndexOf("\n", m.index - 1) + 1;
    if (m.index !== lineStart) continue;
    const lineEnd = text.indexOf("\n", m.index);
    const lineLength = (lineEnd === -1 ? text.length : lineEnd) - m.index;
    if (lineLength > MAX_HEADING_LINE) continue;
    hits.push(m.index);
  }
  return hits;
}

/** The real heading is the last candidate: the table of contents comes first. */
function lastHeading(text: string, re: RegExp, before = text.length): number {
  const hits = headingMatches(text, re).filter((i) => i < before);
  return hits.length ? hits[hits.length - 1] : -1;
}

/** The first candidate at or after `from` -- used for a section's END boundary. */
function firstHeading(text: string, re: RegExp, from: number): number {
  const hit = headingMatches(text, re).find((i) => i >= from);
  return hit === undefined ? -1 : hit;
}

const MDA_HEADING = /Item\s*[27][.:\s]{0,4}\s*Management'?[\u2019']?s\s+Discussion\s+and\s+Analysis/i;
/** What follows the management discussion: Item 3 or 4 in a 10-Q, Item 7A or 8 in a 10-K. */
const AFTER_MDA_HEADING = /Item\s*(?:3|4|7A)[.:\s]{0,4}\s*(?:Quantitative|Controls)/i;

/**
 * Where the statements and notes live, by form.
 *
 * Anchoring on the filing's own item structure rather than on the words
 * "Notes to Consolidated Financial Statements" is what makes this reliable:
 * that phrase appears in a filing's table of contents, as a running page
 * header on every note page ("... (Continued)"), and inside MD&A
 * cross-references, so it names the section far more often than it starts
 * it. The item heading appears exactly twice -- contents, then the section.
 */
// The qualifier chain matters: filers write "Financial Statements",
// "Condensed Consolidated Financial Statements", "Consolidated Financial
// Statements" and "Unaudited Condensed Consolidated Financial
// Statements" for the same item, and an item number followed by a
// different title (Part II's "Item 1. Legal Proceedings") must not match.
const STATEMENTS_TITLE = "(?:Unaudited\\s+)?(?:Condensed\\s+)?(?:Consolidated\\s+)?Financial\\s+Statements";
const STATEMENTS_10Q = new RegExp(`Item\\s*1[.:\\s]{0,4}\\s*${STATEMENTS_TITLE}`, "i");
const STATEMENTS_10K = new RegExp(`Item\\s*8[.:\\s]{0,4}\\s*${STATEMENTS_TITLE}`, "i");
const AFTER_STATEMENTS_10K = /Item\s*9[.:\s]{0,4}/i;

/**
 * Trims a section to a character budget from its START.
 *
 * Truncation is the one place this module can make a true quote
 * unverifiable, so it is done in one place and cut at a line boundary. The
 * front is kept because that is where a filer puts the discussion.
 */
function capSection(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.lastIndexOf("\n", maxChars);
  return text.slice(0, cut > maxChars * 0.8 ? cut : maxChars);
}

/**
 * The management discussion and the statements-and-notes section, out of a
 * 10-Q or 10-K.
 *
 * Returns whatever it finds. A filing whose headings don't match either
 * pattern yields no sections rather than a guessed slice: sending the wrong
 * part of a filing and citing it as MD&A would put a false citation on
 * screen, which is worse than no explanation at all.
 */
export function periodicSections(
  text: string,
  form: string,
  budget: { mda: number; notes: number }
): Section[] {
  const sections: Section[] = [];
  const isAnnual = form.startsWith("10-K");

  const mdaStart = lastHeading(text, MDA_HEADING);
  if (mdaStart >= 0) {
    const end = firstHeading(text, AFTER_MDA_HEADING, mdaStart + 200);
    sections.push({
      name: "Management's Discussion and Analysis",
      text: capSection(text.slice(mdaStart, end > mdaStart ? end : text.length), budget.mda),
    });
  }

  // In a 10-Q the statements come before MD&A (Item 1 then Item 2); in a
  // 10-K they come after it (Item 7 then Item 8).
  let notesStart = -1;
  let notesEnd = text.length;
  if (isAnnual) {
    notesStart = lastHeading(text, STATEMENTS_10K);
    if (notesStart >= 0) {
      const end = firstHeading(text, AFTER_STATEMENTS_10K, notesStart + 200);
      if (end > notesStart) notesEnd = end;
    }
  } else {
    notesStart = mdaStart > 0 ? lastHeading(text, STATEMENTS_10Q, mdaStart) : lastHeading(text, STATEMENTS_10Q);
    if (notesStart >= 0 && mdaStart > notesStart) notesEnd = mdaStart;
  }

  if (notesStart >= 0 && notesEnd - notesStart > 2000) {
    sections.push({
      name: "Financial statements and notes",
      text: capSection(text.slice(notesStart, notesEnd), budget.notes),
    });
  }

  return sections;
}
