// Independent audit of everything stored in claude_explanations.
//
// It makes no Claude call. For every stored row it re-fetches the cited
// filing from EDGAR, finds the exact document the citation names, and
// re-checks the whole row from scratch:
//
//   - the cited document exists and is the one named
//   - every stored passage is in that document, verbatim
//   - every figure in every stored sentence is in a stored passage
//   - no sentence uses the app's own vocabulary
//
// The point of re-running it here rather than trusting the verifier's own
// verdict is that this checks what a reader would actually be shown,
// against the source as it stands now, from a different code path.
//
// Usage: npm run audit-explanations

import { readAllExplanations } from "@/lib/db/store";
import { resolveTicker } from "@/lib/edgar/tickers";
import { getSubmissions } from "@/lib/edgar/submissions";
import { periodicDocs, wholeFilingDocs, SourceDoc } from "@/lib/claude/sources";
import { normalizeForMatch } from "@/lib/claude/sourceText";
import { verifyExplanation } from "@/lib/claude/verify";

async function docsForFiling(cik: string, accessionNumber: string, form: string): Promise<SourceDoc[]> {
  const subs = await getSubmissions(cik);
  const filing = subs.filings.find((f) => f.accessionNumber === accessionNumber);
  if (!filing) return [];
  if (form === "10-Q" || form === "10-K") return periodicDocs(cik, filing);
  return wholeFilingDocs(cik, filing);
}

async function main() {
  const rows = await readAllExplanations();
  if (rows.length === 0) {
    console.log("No stored explanations to audit.");
    return;
  }

  console.log(`Auditing ${rows.length} stored explanation(s). No Claude calls.\n`);
  let failures = 0;
  let sentencesChecked = 0;
  let figuresChecked = 0;

  for (const row of rows) {
    const label = `${row.ticker} · ${row.triggerKey}`;
    if (row.status === "not-explained") {
      const ok = row.sentences.length === 0;
      console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: not explained in the filing, ${row.sentences.length} sentence(s) stored`);
      if (!ok) failures++;
      continue;
    }

    const c = row.citation;
    if (!c) {
      console.log(`  FAIL  ${label}: stored as explained with no citation`);
      failures++;
      continue;
    }

    const record = await resolveTicker(row.ticker);
    if (!record) {
      console.log(`  FAIL  ${label}: ticker no longer resolves`);
      failures++;
      continue;
    }

    const docs = await docsForFiling(record.cik, c.accessionNumber, c.form);
    const doc = docs.find((d) => d.part === c.part);
    if (!doc) {
      console.log(`  FAIL  ${label}: cited document "${c.part}" not found in ${c.form} ${c.accessionNumber}`);
      failures++;
      continue;
    }

    // Re-run the verifier over the stored row, as though it had just come
    // back from the model.
    const reverified = verifyExplanation({
      raw: {
        trigger_key: row.triggerKey,
        source_id: "S1",
        section: c.section,
        sentences: row.sentences,
        passages: row.passages,
      },
      doc,
    });

    const sameSentences =
      reverified.sentences.length === row.sentences.length &&
      reverified.sentences.every((s, i) => s === row.sentences[i]);
    const samePassages =
      reverified.passages.length === row.passages.length &&
      reverified.passages.every((p, i) => p === row.passages[i]);

    sentencesChecked += row.sentences.length;
    const haystack = row.passages.map(normalizeForMatch).join(" | ");
    const haystackNoCommas = haystack.replace(/,/g, "");
    const badFigures: string[] = [];
    for (const sentence of row.sentences) {
      for (const tok of sentence.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) {
        figuresChecked++;
        const stripped = tok.replace(/,/g, "");
        if (!haystack.includes(tok) && !haystackNoCommas.includes(stripped)) badFigures.push(tok);
      }
    }

    const ok = sameSentences && samePassages && badFigures.length === 0 && Boolean(reverified.citation);
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
    console.log(
      `        ${row.sentences.length} sentence(s), ${row.passages.length} passage(s) re-found in ${c.form} ${c.part}${c.section ? ` (${c.section})` : ""}; ${(row.sentences.join(" ").match(/\d[\d,]*(?:\.\d+)?/g) ?? []).length} figure(s) checked`
    );
    if (!ok) {
      failures++;
      if (!sameSentences) console.log(`        sentences changed on re-verification: ${reverified.dropped.map((d) => d.reason).join(" | ")}`);
      if (!samePassages) console.log(`        passages changed on re-verification: ${reverified.dropped.map((d) => d.reason).join(" | ")}`);
      if (badFigures.length) console.log(`        figures not found in any stored passage: ${badFigures.join(", ")}`);
    }
  }

  console.log(
    `\n${rows.length - failures}/${rows.length} rows passed. ${sentencesChecked} sentence(s) and ${figuresChecked} figure(s) checked.`
  );

  // The verbatim-quote check against a real filing rather than a
  // fixture: take a passage that genuinely is in an SEC document, change
  // one character of it, and confirm the check rejects it. The unit tests
  // in scripts/test-verify.ts prove the same thing against a fixture; this
  // proves it against the live source the app actually reads.
  const explained = rows.find((r) => r.status === "explained" && r.passages.length > 0);
  if (explained && explained.citation) {
    const c = explained.citation;
    const record = (await resolveTicker(explained.ticker))!;
    const docs = await docsForFiling(record.cik, c.accessionNumber, c.form);
    const doc = docs.find((d) => d.part === c.part)!;

    const real = explained.passages[0];
    // Change one digit if there is one, otherwise one letter.
    const altered = /\d/.test(real)
      ? real.replace(/\d/, (d) => String((Number(d) + 1) % 10))
      : real.replace(/[a-z]/, (ch) => (ch === "z" ? "y" : String.fromCharCode(ch.charCodeAt(0) + 1)));

    const result = verifyExplanation({
      raw: {
        trigger_key: explained.triggerKey,
        source_id: "S1",
        section: c.section,
        sentences: explained.sentences,
        passages: [altered],
      },
      doc,
    });
    const dropped = result.sentences.length === 0 && result.dropped.some((d) => d.reason.includes("not found in"));
    console.log(`\nAltered-quote test against the live source (${explained.ticker} ${c.form} ${c.part}):`);
    console.log(`  original: "${real.replace(/\n/g, " ").slice(0, 120)}"`);
    console.log(`  altered:  "${altered.replace(/\n/g, " ").slice(0, 120)}"`);
    console.log(`  ${dropped ? "PASS" : "FAIL"}  ${result.sentences.length} sentence(s) survived; ${result.dropped.map((d) => d.reason).join(" | ") || "nothing dropped"}`);
    if (!dropped) failures++;
  }

  if (failures > 0) process.exit(1);
}

main();
