// The Claude layer, end to end, for one or more tickers.
//
// Prints, per ticker: the Summary as a reader sees it, every trigger that
// fired with the computed fact behind it, the filed text that was read
// (including which exhibits the results 8-K carries), the explanation and
// its citation, the passages it was verified against, what the verifier
// dropped and why, and whether each answer came from the store or a call.
//
// Usage: npm run explain-report -- NVDA MSFT
//        CLAUDE_ENABLED=false npm run explain-report -- NVDA   (no calls)

import { buildPageData } from "@/lib/present/buildPageData";
import { summaryText } from "@/lib/present/summary";
import { claudeCallsToday, storeCounts, storeConfigured } from "@/lib/db/store";
import { resolveTicker } from "@/lib/edgar/tickers";
import { getSubmissions, periodicFilings, resultsEightKForPeriod } from "@/lib/edgar/submissions";
import { filingDocuments } from "@/lib/claude/sources";
import { claudeEnabled, claudeDisabledReason, claudeModel, claudeDailyCap } from "@/lib/config";
import { edgarRequestCount } from "@/lib/edgar/http";

const AS_OF = new Date("2026-09-21T12:00:00Z");

function indent(text: string, pad = "        "): string {
  return text
    .split("\n")
    .map((l) => pad + l)
    .join("\n");
}

async function reportOne(ticker: string) {
  console.log(`\n${"=".repeat(72)}\n${ticker}\n${"=".repeat(72)}`);

  const page = await buildPageData(ticker, AS_OF);
  const d = page.claudeDiagnostics;

  console.log(`  ${page.companyName} (${page.ticker}) · ${page.header.fiscalQuarterLabel}, quarter ended ${page.header.periodEndDate}`);
  console.log(`  Ladder: ${page.lenses.Services.ladder.rung} · Services ${page.lenses.Services.quadrant} · SaaS ${page.lenses.SaaS.quadrant}`);

  console.log(`\n  SUMMARY (Services lens)`);
  console.log(indent(summaryText(page.lenses.Services, page.keyFinancials, page.health), "    "));
  console.log(`\n  SUMMARY (SaaS lens)`);
  console.log(indent(summaryText(page.lenses.SaaS, page.keyFinancials, page.health), "    "));

  // What filed text exists for this ticker, listed whether or not a call
  // was needed -- a cached answer still has to be attributable to a source.
  const record = (await resolveTicker(ticker))!;
  const subs = await getSubmissions(record.cik);
  const periodic = periodicFilings(subs)[0];
  const results8K = periodic ? resultsEightKForPeriod(subs, periodic.reportDate) : undefined;
  console.log(`\n  FILED TEXT AVAILABLE`);
  if (results8K) {
    const docs = await filingDocuments(record.cik, results8K.accessionNumber);
    console.log(`    results 8-K ${results8K.accessionNumber} filed ${results8K.filingDate} (items ${results8K.items})`);
    console.log(`      all documents: ${docs.map((x) => x.type).join(", ")}`);
    const exhibits = docs.filter((x) => /^EX-99/i.test(x.type));
    console.log(`      exhibits read: ${exhibits.length ? exhibits.map((x) => `${x.type} (${x.filename})`).join(", ") : "none"}`);
  } else {
    console.log(`    results 8-K: none filed on or after ${periodic?.reportDate ?? "?"}`);
  }
  console.log(`    latest periodic: ${periodic?.form} ${periodic?.accessionNumber} filed ${periodic?.filingDate}`);

  console.log(`\n  TRIGGERS (${page.explained.length})`);
  if (page.explained.length === 0) console.log("    none");
  for (const item of page.explained) {
    console.log(`\n    [${item.trigger.kind}] ${item.trigger.title}`);
    console.log(`      fact:  ${item.trigger.detail}`);
    console.log(`      state: ${item.state}${item.fromCache ? " (from store)" : ""}${item.unavailableReason ? ` -- ${item.unavailableReason}` : ""}`);
    if (item.sentences.length) {
      console.log(`      explanation:`);
      console.log(indent(item.sentences.join(" "), "        "));
      const c = item.citation!;
      console.log(`      citation: ${c.form} filed ${c.filingDate} · ${c.part}${c.section ? ` · ${c.section}` : ""} · accession ${c.accessionNumber}`);
      console.log(`      passages verified (${item.passages.length}):`);
      for (const p of item.passages) console.log(indent(`"${p.replace(/\n/g, " ")}"`, "        "));
    }
    if (item.dropped.length) {
      console.log(`      dropped by verification (${item.dropped.length}):`);
      for (const dr of item.dropped) {
        console.log(indent(`- ${dr.reason}`, "        "));
        console.log(indent(`  "${dr.text.replace(/\n/g, " ").slice(0, 200)}"`, "        "));
      }
    }
  }

  console.log(`\n  CLAUDE LAYER`);
  console.log(`    enabled: ${d.enabled}${d.disabledReason ? ` (${d.disabledReason})` : ""}`);
  console.log(`    cache hits: ${d.cacheHits} · calls made this run: ${d.calls.length} · calls today: ${d.callsToday ?? "n/a"} / cap ${d.dailyCap}`);
  for (const call of d.calls) {
    const tok = call.inputTokens === undefined ? "n/a" : `${call.inputTokens} in / ${call.outputTokens} out`;
    console.log(`    call on ${call.anchorAccession}: ${call.triggerKeys.join(", ")}`);
    console.log(`      sources: ${call.parts.join(" | ")}`);
    console.log(`      source chars: ${call.sourceChars.toLocaleString("en-US")} · tokens: ${tok}${call.error ? ` · ERROR: ${call.error}` : ""}`);
  }
  return d.calls.length;
}

async function main() {
  const tickers = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  if (tickers.length === 0) {
    console.error("Usage: npm run explain-report -- TICKER [TICKER...]");
    process.exit(1);
  }

  console.log(`Model: ${claudeModel()} · enabled: ${claudeEnabled()}${claudeDisabledReason() ? ` (${claudeDisabledReason()})` : ""} · cap: ${claudeDailyCap()}`);
  console.log(`Store configured: ${storeConfigured()} · calls today before this run: ${(await claudeCallsToday()) ?? "n/a"}`);

  let calls = 0;
  for (const t of tickers) {
    try {
      calls += await reportOne(t);
    } catch (err) {
      console.log(`\n${t}: FAILED -- ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\n${"=".repeat(72)}`);
  console.log(`Calls made this run: ${calls}`);
  console.log(`Calls today after this run: ${(await claudeCallsToday()) ?? "n/a"}`);
  console.log(`EDGAR requests this run: ${edgarRequestCount()}`);
  const counts = await storeCounts();
  console.log(`Store row counts: ${counts ? JSON.stringify(counts) : "n/a"}`);
}

main();
