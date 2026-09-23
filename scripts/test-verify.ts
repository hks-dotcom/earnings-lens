// The quote-verification tests. No Claude call, no network: the verifier is
// a pure function of (model output, source text), which is exactly what
// makes it testable and exactly why it is the layer that decides what
// reaches the page.
//
// "Every quoted figure or passage in 'Explained from the
// filings' is found verbatim in its cited source; a deliberately altered
// quote is dropped by the check." The altered-quote case below is that
// test, run on every `npm run check`.
//
// Usage: npm run test:verify

import { verifyExplanation, RawExplanation } from "@/lib/claude/verify";
import { SourceDoc } from "@/lib/claude/sources";
import { htmlToText, normalizeForMatch, periodicSections } from "@/lib/claude/sourceText";

const SOURCE_TEXT = [
  "Note 11 - Income Taxes",
  "",
  "Income tax expense was $423.6 million for fiscal 2026, compared with an income tax",
  "benefit of $9.4 million for fiscal 2025. The increase was primarily due to a valuation",
  "allowance of $408.7 million recorded against our U.S. deferred tax assets.",
  "",
  "Other income (expense), net",
  "",
  "Other income, net was $7,772 million for the second quarter of fiscal year 2027,",
  "driven by gains on non-marketable equity securities.",
].join("\n");

const DOC: SourceDoc = {
  form: "10-K",
  filingDate: "2026-08-10",
  accessionNumber: "0000817720-26-000055",
  part: "Financial statements and notes",
  text: SOURCE_TEXT,
};

interface Case {
  name: string;
  raw: RawExplanation;
  doc: SourceDoc | undefined;
  expectSentences: number;
  /** A substring that must appear in a drop reason, when something should be dropped. */
  expectDropReason?: string;
}

const CASES: Case[] = [
  {
    name: "a true quote with a figure that is in the passage survives",
    raw: {
      trigger_key: "unusual-tax",
      source_id: "S1",
      section: "Note 11 - Income Taxes",
      sentences: [
        "The company recorded a valuation allowance of $408.7 million against its U.S. deferred tax assets.",
      ],
      passages: ["a valuation allowance of $408.7 million recorded against our U.S. deferred tax assets"],
    },
    doc: DOC,
    expectSentences: 1,
  },
  {
    name: "ALTERED QUOTE: one digit changed in the passage is dropped",
    raw: {
      trigger_key: "unusual-tax",
      source_id: "S1",
      section: "Note 11 - Income Taxes",
      sentences: [
        "The company recorded a valuation allowance of $408.8 million against its U.S. deferred tax assets.",
      ],
      // $408.7m in the filing, $408.8m here.
      passages: ["a valuation allowance of $408.8 million recorded against our U.S. deferred tax assets"],
    },
    doc: DOC,
    expectSentences: 0,
    expectDropReason: "not found in",
  },
  {
    name: "ALTERED QUOTE: a word changed in an otherwise real passage is dropped",
    raw: {
      trigger_key: "unusual-tax",
      source_id: "S1",
      section: "Note 11 - Income Taxes",
      sentences: ["A valuation allowance was recorded against deferred tax assets."],
      passages: ["a valuation allowance of $408.7 million recorded against our Irish deferred tax assets"],
    },
    doc: DOC,
    expectSentences: 0,
    expectDropReason: "not found in",
  },
  {
    name: "a converted figure is dropped: the filing says 7,772, the sentence says 7.8 billion",
    raw: {
      trigger_key: "non-operating-swing",
      source_id: "S1",
      section: "Other income (expense), net",
      sentences: ["Other income of $7.8 billion came from gains on non-marketable equity securities."],
      passages: ["Other income, net was $7,772 million for the second quarter of fiscal year 2027"],
    },
    doc: DOC,
    expectSentences: 0,
    expectDropReason: "not present in any quoted passage",
  },
  {
    name: "the same figure as filed survives",
    raw: {
      trigger_key: "non-operating-swing",
      source_id: "S1",
      section: "Other income (expense), net",
      sentences: ["Other income, net was $7,772 million, driven by gains on non-marketable equity securities."],
      passages: [
        "Other income, net was $7,772 million for the second quarter of fiscal year 2027,\ndriven by gains on non-marketable equity securities.",
      ],
    },
    doc: DOC,
    expectSentences: 1,
  },
  {
    name: "whitespace and line breaks in a quote do not matter",
    raw: {
      trigger_key: "non-operating-swing",
      source_id: "S1",
      section: "Other income (expense), net",
      sentences: ["The gain came from non-marketable equity securities."],
      passages: ["driven   by gains\n\n on non-marketable  equity securities"],
    },
    doc: DOC,
    expectSentences: 1,
  },
  {
    name: "a sentence restating the payment terms is dropped",
    raw: {
      trigger_key: "dpo-rising",
      source_id: "S1",
      section: "Note 11 - Income Taxes",
      sentences: ["Given the valuation allowance, Net 45 terms should not be offered."],
      passages: ["a valuation allowance of $408.7 million recorded against our U.S. deferred tax assets"],
    },
    doc: DOC,
    expectSentences: 0,
    expectDropReason: "restates the payment terms",
  },
  {
    name: "a sentence naming a computed metric is dropped",
    raw: {
      trigger_key: "dpo-rising",
      source_id: "S1",
      section: "Note 11 - Income Taxes",
      sentences: ["The rise in DPO reflects the timing of supplier payments."],
      passages: ["a valuation allowance of $408.7 million recorded against our U.S. deferred tax assets"],
    },
    doc: DOC,
    expectSentences: 0,
    expectDropReason: "restates a computed metric name",
  },
  {
    name: "a citation naming a source that was never sent drops everything",
    raw: {
      trigger_key: "unusual-tax",
      source_id: "S9",
      section: "Note 11 - Income Taxes",
      sentences: ["A valuation allowance was recorded."],
      passages: ["a valuation allowance of $408.7 million"],
    },
    doc: undefined,
    expectSentences: 0,
    expectDropReason: "not one of the documents sent",
  },
  {
    name: "a sentence with no supporting passage is dropped",
    raw: {
      trigger_key: "unusual-tax",
      source_id: "S1",
      section: "Note 11 - Income Taxes",
      sentences: ["The tax charge was driven by a one-off item."],
      passages: [],
    },
    doc: DOC,
    expectSentences: 0,
    expectDropReason: "no verified passage",
  },
  {
    name: "at most two sentences survive, even if more are returned",
    raw: {
      trigger_key: "unusual-tax",
      source_id: "S1",
      section: "Note 11 - Income Taxes",
      sentences: [
        "A valuation allowance was recorded against U.S. deferred tax assets.",
        "The allowance was the main reason the tax charge rose.",
        "A third sentence that should never reach the page.",
      ],
      passages: [
        "The increase was primarily due to a valuation\nallowance of $408.7 million recorded against our U.S. deferred tax assets.",
      ],
    },
    doc: DOC,
    expectSentences: 2,
  },
];

/** Extraction tests: what the verifier compares against has to be stable. */
function extractionTests(): { name: string; ok: boolean; detail: string }[] {
  const out: { name: string; ok: boolean; detail: string }[] = [];

  // Inline XBRL wraps individual numbers in spans. Dropping an inline tag
  // must not split the number it wrapped.
  const inline = htmlToText('<p>Other income, net was $<span class="x">7,772</span> million.</p>');
  out.push({
    name: "inline tags inside a number do not split it",
    ok: inline.includes("$7,772 million"),
    detail: JSON.stringify(inline),
  });

  const entities = htmlToText("<p>Revenue&nbsp;rose&nbsp;18&#37; &amp; margins improved&mdash;materially.</p>");
  out.push({
    name: "entities decode and non-breaking spaces become spaces",
    ok: entities === "Revenue rose 18% & margins improved—materially.",
    detail: JSON.stringify(entities),
  });

  const curly = normalizeForMatch("the Company’s “non-marketable” — assets");
  out.push({
    name: "smart quotes and dashes normalise for matching",
    ok: curly === `the Company's "non-marketable" - assets`,
    detail: JSON.stringify(curly),
  });

  // A cross-reference to a section must not be mistaken for the section.
  const crossRef = [
    "TABLE OF CONTENTS",
    "Item 7. Management's Discussion and Analysis of Financial Condition and Results of Operations",
    "",
    "See the discussion under Item 7. Management's Discussion and Analysis of Financial Condition and Results of Operations in our fiscal 2025 Annual Report for prior-year commentary, which is not repeated here and remains subject to the forward-looking statements caveat set out above.",
    "",
    "Item 7. Management's Discussion and Analysis of Financial Condition and Results of Operations",
    "",
    "Revenue for fiscal 2026 was $1,234 million.",
    "",
    "Item 7A. Quantitative and Qualitative Disclosures About Market Risk",
  ].join("\n");
  const sections = periodicSections(crossRef, "10-K", { mda: 100_000, notes: 100_000 });
  out.push({
    name: "a mid-sentence cross-reference is not taken as the MD&A heading",
    ok:
      sections.length === 1 &&
      sections[0].text.includes("Revenue for fiscal 2026 was $1,234 million.") &&
      !sections[0].text.includes("prior-year commentary"),
    detail: sections.map((s) => `${s.name}:${s.text.length}`).join(", ") || "no sections",
  });

  return out;
}

function main() {
  let failures = 0;

  console.log("Quote verification\n");
  for (const c of CASES) {
    const result = verifyExplanation({ raw: c.raw, doc: c.doc });
    const gotSentences = result.sentences.length;
    let ok = gotSentences === c.expectSentences;
    let note = `${gotSentences} sentence(s) survived, expected ${c.expectSentences}`;

    if (ok && c.expectDropReason) {
      const matched = result.dropped.some((d) => d.reason.includes(c.expectDropReason!));
      if (!matched) {
        ok = false;
        note += `; no drop reason contained "${c.expectDropReason}" (got: ${result.dropped.map((d) => d.reason).join(" | ") || "none"})`;
      } else {
        note += `; dropped: ${result.dropped.map((d) => d.reason).join(" | ")}`;
      }
    }
    if (ok && c.expectSentences > 0 && !result.citation) {
      ok = false;
      note += "; no citation produced for a surviving sentence";
    }

    console.log(`  ${ok ? "PASS" : "FAIL"}  ${c.name}`);
    console.log(`        ${note}`);
    if (!ok) failures++;
  }

  console.log("\nSource extraction\n");
  for (const t of extractionTests()) {
    console.log(`  ${t.ok ? "PASS" : "FAIL"}  ${t.name}`);
    if (!t.ok) {
      console.log(`        got ${t.detail}`);
      failures++;
    }
  }

  const total = CASES.length + extractionTests().length;
  console.log(`\n${total - failures}/${total} passed.`);
  if (failures > 0) process.exit(1);
}

main();
