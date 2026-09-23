import { edgarCache, TTL } from "@/lib/cache";
import { edgarFetchJson } from "@/lib/edgar/http";

// SEC publishes this on www.sec.gov (not data.sec.gov) as a flat ticker ->
// CIK/name map. It's the standard way to resolve a ticker without scraping.
const TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json";

interface RawTickerEntry {
  cik_str: number;
  ticker: string;
  title: string;
}

export interface TickerRecord {
  cik: string; // zero-padded to 10 digits, as EDGAR APIs expect
  ticker: string;
  title: string;
}

async function loadTickerMap(): Promise<Map<string, TickerRecord>> {
  return edgarCache.getOrFetch("ticker-map", TTL.tickerMap, async () => {
    const raw = await edgarFetchJson<Record<string, RawTickerEntry>>(TICKER_MAP_URL);
    const map = new Map<string, TickerRecord>();
    for (const entry of Object.values(raw)) {
      map.set(entry.ticker.toUpperCase(), {
        cik: String(entry.cik_str).padStart(10, "0"),
        ticker: entry.ticker.toUpperCase(),
        title: entry.title,
      });
    }
    return map;
  });
}

/**
 * Share-class separators differ by data source: SEC writes Berkshire's B
 * shares "BRK-B", most quote sites write "BRK.B", and people type either.
 * Comparing with separators stripped makes both find the same company.
 * This is punctuation, not fuzzy matching -- "BRKB" and "BRK-B" are the
 * same string of letters in the same order, which is the whole test.
 */
function normaliseTicker(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/[.\-\s]/g, "");
}

export async function resolveTicker(ticker: string): Promise<TickerRecord | undefined> {
  const map = await loadTickerMap();
  const exact = map.get(ticker.trim().toUpperCase());
  if (exact) return exact;
  const normalised = normaliseTicker(ticker);
  if (!normalised) return undefined;
  for (const record of map.values()) {
    if (normaliseTicker(record.ticker) === normalised) return record;
  }
  return undefined;
}

export interface CompanyMatch {
  ticker: string;
  title: string;
  cik: string;
}

export const SEARCH_LIMIT = 8;

/** Lower rank sorts first. Prefix and whole-word matches only -- no fuzzy guessing. */
function rankMatch(record: TickerRecord, query: string, normalisedQuery: string): number | undefined {
  const ticker = record.ticker;
  const title = record.title.toUpperCase();
  // Separator-insensitive, so "BRK.B" finds SEC's "BRK-B".
  if (normaliseTicker(ticker) === normalisedQuery) return 0; // "An exact ticker match always ranks first"
  if (ticker.startsWith(query) || normaliseTicker(ticker).startsWith(normalisedQuery)) return 1;
  if (title.startsWith(query)) return 2;
  // A word inside the name: "airbnb" should find "Airbnb, Inc.", and
  // "micro" should find "Advanced Micro Devices". Split on anything that
  // isn't a letter or digit so "AT&T" and "J.P." behave.
  if (title.split(/[^A-Z0-9]+/).some((word) => word.length > 0 && word.startsWith(query))) return 3;
  return undefined;
}

/**
 * "The ticker box accepts a ticker or a company name. It searches EDGAR's
 * official ticker-to-company list (the same file the app already uses to
 * find a company's SEC ID), so it needs no other service."
 *
 * Companies with several listed share classes appear once per ticker,
 * deliberately: GOOGL and GOOG are different securities and the user has
 * to pick one, so collapsing them would hide the choice.
 */
export async function searchCompanies(rawQuery: string, limit = SEARCH_LIMIT): Promise<CompanyMatch[]> {
  const query = rawQuery.trim().toUpperCase();
  if (!query) return [];
  const normalisedQuery = normaliseTicker(query);
  const map = await loadTickerMap();

  const scored: { rank: number; record: TickerRecord }[] = [];
  for (const record of map.values()) {
    const rank = rankMatch(record, query, normalisedQuery);
    if (rank !== undefined) scored.push({ rank, record });
  }

  scored.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    // Within a rank, shorter tickers first (ABNB before ABNBX), then
    // alphabetical, so the order is stable run to run.
    if (a.record.ticker.length !== b.record.ticker.length) {
      return a.record.ticker.length - b.record.ticker.length;
    }
    return a.record.ticker.localeCompare(b.record.ticker);
  });

  return scored.slice(0, limit).map(({ record }) => ({
    ticker: record.ticker,
    title: record.title,
    cik: record.cik,
  }));
}
