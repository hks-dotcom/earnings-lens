import { resolveTicker } from "@/lib/edgar/tickers";
import { FilingEntry, getSubmissions, periodicFilings } from "@/lib/edgar/submissions";
import { getCompanyFacts } from "@/lib/edgar/companyFacts";
import { buildKeyFinancials } from "@/lib/xbrl/keyFinancials";
import { extractFilingStatement, FilingStatementExtract } from "@/lib/xbrl/statementExtract";
import { buildStatements, statementFilings, Statements } from "@/lib/xbrl/statements";
import { readFilingStatement, writeFilingStatement } from "@/lib/db/store";

/**
 * Loads each filing's extracted statements: from the store when it has
 * them, otherwise from the filing itself, stored for next time. One filing
 * is independent of every other, so a caller can load them one request at
 * a time (see the statements route) and never hold a whole company's
 * extraction inside a single function call.
 */

export interface ExtractStats {
  accessionNumber: string;
  form: string;
  fromStore: boolean;
  ms: number;
  requests: number;
  instanceBytes: number;
}

export async function loadFilingExtract(
  cik: string,
  ticker: string,
  filing: FilingEntry
): Promise<{ extract: FilingStatementExtract; stats: ExtractStats }> {
  const started = Date.now();
  const stored = await readFilingStatement(filing.accessionNumber);
  if (stored) {
    return {
      extract: stored,
      stats: {
        accessionNumber: filing.accessionNumber,
        form: filing.form,
        fromStore: true,
        ms: Date.now() - started,
        requests: 0,
        instanceBytes: stored.instanceBytes,
      },
    };
  }
  const extract = await extractFilingStatement(cik, filing);
  await writeFilingStatement(extract, cik, ticker);
  return {
    extract,
    stats: {
      accessionNumber: filing.accessionNumber,
      form: filing.form,
      fromStore: false,
      ms: Date.now() - started,
      requests: extract.requests,
      instanceBytes: extract.instanceBytes,
    },
  };
}

export interface LoadedStatements {
  ticker: string;
  statements: Statements;
  stats: ExtractStats[];
}

/** Everything for one ticker, in one call -- for scripts and tests. The page loads filings one per request instead. */
export async function loadStatements(rawTicker: string): Promise<LoadedStatements> {
  const record = await resolveTicker(rawTicker);
  if (!record) throw new Error(`Ticker "${rawTicker}" not found`);
  const subs = await getSubmissions(record.cik);
  const facts = await getCompanyFacts(record.cik);
  const periodic = periodicFilings(subs);
  const kf = buildKeyFinancials(facts, periodic, subs.fiscalYearEnd);

  const extracts = new Map<string, FilingStatementExtract>();
  const stats: ExtractStats[] = [];
  for (const filing of statementFilings(kf, periodic)) {
    const { extract, stats: s } = await loadFilingExtract(record.cik, record.ticker, filing);
    extracts.set(filing.accessionNumber, extract);
    stats.push(s);
  }
  return { ticker: record.ticker, statements: buildStatements(facts, kf, periodic, extracts), stats };
}
