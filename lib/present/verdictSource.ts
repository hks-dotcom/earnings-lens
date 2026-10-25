/**
 * The S5 verdict for one company, from the app's own data pull: the
 * engine's inputs built as of a date (lib/verdict/inputs.ts, with the
 * data-integrity repairs), the engine run on them, and the page model.
 *
 * The page calls this with today's date; the page tests call the same
 * function as of a fixed date, so what is checked is what is shown.
 */
import type { CompanyFacts } from "@/lib/edgar/companyFacts";
import type { CompanySubmissions, FilingEntry } from "@/lib/edgar/submissions";
import { getFilingInstance } from "@/lib/edgar/xbrlInstance";
import { wholeFilingDocs } from "@/lib/claude/sources";
import type { FilingStatementExtract } from "@/lib/xbrl/statementExtract";
import { buildVerdictInputs } from "@/lib/verdict/inputs";
import { runVerdict } from "@/lib/verdict/engine";
import type { VerdictResult } from "@/lib/verdict/types";
import { verdictPage, VerdictPage } from "@/lib/present/verdictPage";

export interface VerdictSource {
  cik: string;
  ticker: string;
  submissions: CompanySubmissions;
  facts: CompanyFacts;
  /** YYYY-MM-DD: today for the live page. */
  assessmentDate: string;
  /** The page's statement-extract loader (stored extracts first). */
  loadExtract: (filing: FilingEntry) => Promise<FilingStatementExtract>;
}

export async function companyVerdict(src: VerdictSource): Promise<{ result: VerdictResult; page: VerdictPage }> {
  const { inputs } = await buildVerdictInputs({
    cik: src.cik,
    ticker: src.ticker,
    submissions: src.submissions,
    facts: src.facts,
    assessmentDate: src.assessmentDate,
    load: {
      extract: src.loadExtract,
      instance: (f) => getFilingInstance(src.cik, f.accessionNumber, f.primaryDocument),
      eightKText: async (f) => (await wholeFilingDocs(src.cik, f)).map((d) => ({ part: d.part, text: d.text })),
    },
  });
  const result = runVerdict(inputs);
  return { result, page: verdictPage(result) };
}

/** Today as YYYY-MM-DD in US Eastern time, the calendar SEC deadlines are counted in. */
export function assessmentDateFor(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
