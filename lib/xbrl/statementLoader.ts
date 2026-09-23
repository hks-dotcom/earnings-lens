import { resolveTicker } from "@/lib/edgar/tickers";
import { FilingEntry, getSubmissions, periodicFilings } from "@/lib/edgar/submissions";
import { getCompanyFacts } from "@/lib/edgar/companyFacts";
import { buildKeyFinancials } from "@/lib/xbrl/keyFinancials";
import { extractFilingStatement, FilingStatementExtract } from "@/lib/xbrl/statementExtract";
import { buildStatements, statementFilings, Statements } from "@/lib/xbrl/statements";
import { readFilingStatement, storeConfigured, writeFilingStatement } from "@/lib/db/store";

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

/** The company-level inputs every statements request starts from: cached per process like the rest of EDGAR. */
async function companyInputs(rawTicker: string) {
  const record = await resolveTicker(rawTicker);
  if (!record) throw new StatementsTickerNotFound(`Ticker "${rawTicker}" not found`);
  const subs = await getSubmissions(record.cik);
  const facts = await getCompanyFacts(record.cik);
  const periodic = periodicFilings(subs);
  const kf = buildKeyFinancials(facts, periodic, subs.fiscalYearEnd);
  return { record, facts, periodic, kf, filings: statementFilings(kf, periodic) };
}

export class StatementsTickerNotFound extends Error {}

export interface StatementFilingStatus {
  accessionNumber: string;
  form: string;
  reportDate: string;
  stored: boolean;
}

/**
 * The statement tabs' first request: the assembled statements when every
 * filing they read is already extracted, or otherwise the list of filings
 * and which of them still need reading. Nothing here reads a filing, so it
 * answers in the time a store lookup takes.
 */
export async function statementsOrWork(
  rawTicker: string
): Promise<
  | { status: "ready"; ticker: string; statements: Statements }
  | { status: "needs"; ticker: string; filings: StatementFilingStatus[] }
> {
  const { record, facts, periodic, kf, filings } = await companyInputs(rawTicker);
  // With no store there is nowhere to keep a filing between requests, so
  // this one request reads them all -- slower, but it finishes.
  if (!storeConfigured()) {
    const extracts = new Map<string, FilingStatementExtract>();
    for (const f of filings) extracts.set(f.accessionNumber, await extractFilingStatement(record.cik, f));
    return { status: "ready", ticker: record.ticker, statements: buildStatements(facts, kf, periodic, extracts) };
  }
  const stored = await Promise.all(filings.map((f) => readFilingStatement(f.accessionNumber)));
  if (stored.every(Boolean)) {
    const extracts = new Map(stored.map((x) => [x!.accessionNumber, x!]));
    return { status: "ready", ticker: record.ticker, statements: buildStatements(facts, kf, periodic, extracts) };
  }
  return {
    status: "needs",
    ticker: record.ticker,
    filings: filings.map((f, i) => ({
      accessionNumber: f.accessionNumber,
      form: f.form,
      reportDate: f.reportDate,
      stored: Boolean(stored[i]),
    })),
  };
}

/**
 * Reads one filing for the statement tabs and stores it: one filing per
 * request, so no single request does a whole company's reading. Only a
 * filing the tabs actually read for this ticker is accepted.
 */
export async function readOneStatementFiling(rawTicker: string, accessionNumber: string): Promise<ExtractStats> {
  const { record, filings } = await companyInputs(rawTicker);
  const filing = filings.find((f) => f.accessionNumber === accessionNumber);
  if (!filing) throw new StatementsTickerNotFound(`${accessionNumber} is not one of ${record.ticker}'s statement filings`);
  return (await loadFilingExtract(record.cik, record.ticker, filing)).stats;
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
