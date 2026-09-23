import { edgarCache, TTL } from "@/lib/cache";
import { edgarFetchJson } from "@/lib/edgar/http";

export interface FilingEntry {
  accessionNumber: string;
  filingDate: string; // YYYY-MM-DD
  reportDate: string; // period end date, "" if not applicable
  acceptanceDateTime: string;
  form: string;
  items: string; // comma-separated 8-K item numbers, "" otherwise
  primaryDocument: string;
  primaryDocDescription: string;
  isXBRL: boolean;
}

export interface CompanySubmissions {
  cik: string;
  name: string;
  tickers: string[];
  exchanges: string[];
  sic: string;
  sicDescription: string;
  /** Filer category as reported by EDGAR, e.g. "Large accelerated filer". */
  category: string | null;
  /** MMDD, e.g. "0131" for a Jan 31 fiscal year end. */
  fiscalYearEnd: string | null;
  filings: FilingEntry[];
}

interface RawRecentBlock {
  accessionNumber: string[];
  filingDate: string[];
  reportDate: string[];
  acceptanceDateTime: string[];
  form: string[];
  items: string[];
  primaryDocument: string[];
  primaryDocDescription: string[];
  isXBRL: number[];
}

interface RawSubmissions {
  cik: string;
  name: string;
  tickers: string[];
  exchanges: string[];
  sic: string;
  sicDescription: string;
  category: string;
  fiscalYearEnd: string;
  filings: {
    recent: RawRecentBlock;
    files: { name: string; filingCount: number; filingFrom: string; filingTo: string }[];
  };
}

function blockToEntries(block: RawRecentBlock): FilingEntry[] {
  const n = block.accessionNumber.length;
  const entries: FilingEntry[] = [];
  for (let i = 0; i < n; i++) {
    entries.push({
      accessionNumber: block.accessionNumber[i],
      filingDate: block.filingDate[i],
      reportDate: block.reportDate[i] ?? "",
      acceptanceDateTime: block.acceptanceDateTime?.[i] ?? "",
      form: block.form[i],
      items: block.items?.[i] ?? "",
      primaryDocument: block.primaryDocument?.[i] ?? "",
      primaryDocDescription: block.primaryDocDescription?.[i] ?? "",
      isXBRL: Boolean(block.isXBRL?.[i]),
    });
  }
  return entries;
}

const cikPadded = (cik: string) => cik.padStart(10, "0");

/**
 * Fetches the submissions JSON for a CIK, merging in enough of the older
 * paginated files (filings.files) to cover at least a 2-year lookback --
 * the recent-1000 block alone comfortably covers this for any company that
 * files quarterly, but low-activity filers can otherwise run short of the
 * 5-quarter window or the 12-month red-flag lookback.
 */
export async function getSubmissions(cik: string): Promise<CompanySubmissions> {
  const padded = cikPadded(cik);
  return edgarCache.getOrFetch(`submissions:${padded}`, TTL.submissions, async () => {
    const raw = await edgarFetchJson<RawSubmissions>(
      `https://data.sec.gov/submissions/CIK${padded}.json`
    );
    let filings = blockToEntries(raw.filings.recent);

    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    const oldestCovered = () =>
      filings.length ? filings[filings.length - 1].filingDate : new Date().toISOString().slice(0, 10);

    // Older filings live in separate per-page files, newest-first in the
    // files array. Pull additional pages only if we don't yet have 2 years
    // of history, capped so a very old/inactive filer can't blow up the
    // request count.
    const extraFiles = raw.filings.files ?? [];
    for (let i = 0; i < extraFiles.length && i < 4; i++) {
      if (new Date(oldestCovered()) <= twoYearsAgo) break;
      const page = await edgarFetchJson<RawRecentBlock>(
        `https://data.sec.gov/submissions/${extraFiles[i].name}`
      );
      filings = filings.concat(blockToEntries(page));
    }

    return {
      cik: padded,
      name: raw.name,
      tickers: raw.tickers ?? [],
      exchanges: raw.exchanges ?? [],
      sic: raw.sic,
      sicDescription: raw.sicDescription,
      category: raw.category || null,
      fiscalYearEnd: raw.fiscalYearEnd || null,
      filings,
    };
  });
}

/** 10-Q and 10-K, newest first, including amendments' primary forms. */
export function periodicFilings(subs: CompanySubmissions): FilingEntry[] {
  return subs.filings
    .filter((f) => f.form === "10-Q" || f.form === "10-K")
    .sort((a, b) => (a.reportDate < b.reportDate ? 1 : -1));
}

/**
 * The results 8-K that belongs to a reporting period: the newest Item 2.02
 * filed on or after that period ended.
 *
 * The date test is what keeps a stale release out of the Claude layer's
 * source bundle. NAII's most recent results 8-K is from 2008 -- it simply
 * stopped furnishing them -- and reading a 2008 press release to explain a
 * 2026 quarter would be worse than reading nothing. A results release
 * cannot predate the quarter it reports, so the period end is the bound.
 */
export function resultsEightKForPeriod(
  subs: CompanySubmissions,
  periodEndDate: string
): FilingEntry | undefined {
  return resultsEightKs(subs).find((f) => f.filingDate >= periodEndDate);
}

/** Most recent results 8-K (Item 2.02), newest first. */
export function resultsEightKs(subs: CompanySubmissions): FilingEntry[] {
  return subs.filings
    .filter((f) => f.form === "8-K" && f.items.split(",").includes("2.02"))
    .sort((a, b) => (a.filingDate < b.filingDate ? 1 : -1));
}
