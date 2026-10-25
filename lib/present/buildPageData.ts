import { resolveTicker } from "@/lib/edgar/tickers";
import { getSubmissions, periodicFilings, resultsEightKs } from "@/lib/edgar/submissions";
import { getCompanyFacts } from "@/lib/edgar/companyFacts";
import { getFilingInstance } from "@/lib/edgar/xbrlInstance";
import { buildKeyFinancials, KeyFinancials } from "@/lib/xbrl/keyFinancials";
import { computeFinancialHealth, FinancialHealth } from "@/lib/metrics/health";
import { nextFilingDue, NextFilingDue } from "@/lib/metrics/deadlines";
import { extractSegmentRevenueForPeriod, SegmentRevenue } from "@/lib/xbrl/segments";
import { evaluateLens, LensResult } from "@/lib/rules/evaluateLens";
import { assessmentDateFor, companyVerdict } from "@/lib/present/verdictSource";
import type { VerdictPage } from "@/lib/present/verdictPage";
import type { RdStatus } from "@/lib/verdict/types";
import { buildAnnualFigures, AnnualFigures } from "@/lib/present/annualFigures";
import { buildExplanationTriggers } from "@/lib/rules/explanationTriggers";
import { buildStandOut } from "@/lib/present/standOut";
import { shownByExplainKey } from "@/lib/present/findingExplanations";
import { ExplainedItem, explainFlaggedItems, ExplainDiagnostics } from "@/lib/claude/explain";
import { readSegments, writeSegments } from "@/lib/db/store";
import { buildStatements } from "@/lib/xbrl/statements";
import { buildFlowFacts, FlowFacts } from "@/lib/present/flowFacts";
import { loadFilingExtract } from "@/lib/xbrl/statementLoader";
import { FilingStatementExtract } from "@/lib/xbrl/statementExtract";
import { LiquidityDebt } from "@/lib/present/liquidityDebt";
import { loadLiquidityDebt } from "@/lib/present/liquiditySources";
import { newResultsAnnounced, NewResultsAnnounced } from "@/lib/present/resultsBanner";
import { FilingEntry } from "@/lib/edgar/submissions";
import { ACQUISITIONS_PCT_OF_REVENUE } from "@/lib/rules/declaredValues";

export interface HeaderLine {
  periodEndDate: string;
  fiscalQuarterLabel: string;
  dueBy: NextFilingDue | undefined;
  newResultsAnnounced: NewResultsAnnounced | undefined;
  /** A periodic filing EDGAR lists but has not published figures for yet. The board shows the last published quarter until it does. */
  awaitingFigures: { form: string; filingDate: string; periodEnd: string } | undefined;
}

export interface PageData {
  ticker: string;
  companyName: string;
  cik: string;
  filerCategory: string | null;
  header: HeaderLine;
  keyFinancials: KeyFinancials;
  health: FinancialHealth;
  segments: SegmentRevenue | null;
  annual: AnnualFigures | null;
  /**
   * The S5 verdict (Earnings_Lens_Verdict_Rules_S5.md): health, both
   * sellers' verdicts, terms, evidence and the potential application, as
   * the page shows them. The only verdict on the page.
   */
  verdict: VerdictPage;
  /** R&D as the verdict read it (rules 11 R6): the Key financials row says "Not separately disclosed" when it is not filed quarterly. */
  rdStatus: RdStatus;
  /**
   * The filed-figure signals behind "What stands out" and the Claude
   * layer's triggers: red flags, cash position, spending cuts, payables.
   * Lens-independent; never a verdict.
   */
  signals: LensResult;
  /**
   * The flagged items, explained from filed text. Shared by both lenses:
   * the triggers are the same figures and the same filings either way.
   */
  explained: ExplainedItem[];
  claudeDiagnostics: ExplainDiagnostics;
  /** Cash-flow figures behind the borrowing, acquisitions and returns findings. */
  flows: FlowFacts;
  /** The liquidity vs debt strip under the health tiles. Display only. */
  liquidity: LiquidityDebt;
}

export class TickerNotFoundError extends Error {}

export async function buildPageData(rawTicker: string, now: Date = new Date()): Promise<PageData> {
  const record = await resolveTicker(rawTicker);
  if (!record) throw new TickerNotFoundError(`Ticker "${rawTicker}" not found in SEC's ticker map.`);

  const subs = await getSubmissions(record.cik);
  const facts = await getCompanyFacts(record.cik);
  const periodic = periodicFilings(subs);
  const kf = buildKeyFinancials(facts, periodic, subs.fiscalYearEnd);
  const health = computeFinancialHealth(kf);

  const annualEnds = kf.lookbackPeriods.filter((p) => p.fp === "FY").map((p) => p.filing.reportDate);

  // Two different "latest". The deadline is about what the company FILED,
  // so it projects from the newest filing; everything that describes the
  // figures on screen -- the segment breakdown, the flagged items Claude
  // explains -- belongs to the newest quarter EDGAR has actually published.
  // They are the same filing except in the days right after a company
  // reports.
  const latestFiledPeriod = kf.lookbackPeriods[0];
  const latestPeriod = kf.publishedPeriods[0];
  const dueBy =
    latestFiledPeriod?.placed ? nextFilingDue(latestFiledPeriod, subs.category, annualEnds) : undefined;

  // A filing EDGAR lists but has not aggregated yet. Saying so is the
  // whole point: without it the board shows last quarter's figures under
  // this quarter's date and nobody can tell.
  const awaitingFigures =
    latestFiledPeriod && latestFiledPeriod !== latestPeriod
      ? {
          form: latestFiledPeriod.filing.form,
          filingDate: latestFiledPeriod.filing.filingDate,
          periodEnd: latestFiledPeriod.filing.reportDate,
        }
      : undefined;

  // "New results announced" -- a results 8-K (Item 2.02) for a quarter
  // newer than the one shown: filed after the latest 10-Q/10-K and after
  // the next period ends. See lib/present/resultsBanner.ts.
  const newResults = newResultsAnnounced(resultsEightKs(subs), latestFiledPeriod?.filing, dueBy);

  const header: HeaderLine = {
    periodEndDate: kf.quarters[0]?.periodEnd ?? "",
    fiscalQuarterLabel: kf.quarters[0]?.label ?? "",
    dueBy,
    newResultsAnnounced: newResults,
    awaitingFigures,
  };

  // Segment revenue comes out of a filing's own XBRL instance document --
  // megabytes of XML per filing, parsed to a handful of facts. A filing
  // never changes, so the extracted result is stored permanently against
  // its accession number and the instance is never fetched twice.
  let segments: SegmentRevenue | null = null;
  if (latestPeriod) {
    const accession = latestPeriod.filing.accessionNumber;
    const stored = await readSegments(accession);
    if (stored) {
      segments = stored;
    } else {
      try {
        segments = await extractSegmentRevenueForPeriod(latestPeriod, kf.lookbackPeriods, (period) =>
          getFilingInstance(record.cik, period.filing.accessionNumber, period.filing.primaryDocument)
        );
        await writeSegments(accession, record.cik, record.ticker, segments);
      } catch {
        // A parse or fetch failure is not a cacheable answer: the filing
        // still has whatever it has, so nothing is written and the next
        // request tries again.
        segments = null;
      }
    }
  }

  const annual = buildAnnualFigures(facts, kf, periodic);

  // The filed-figure signals for "What stands out" and the explanation
  // triggers. They read the same inputs on either lens; the S5 verdict
  // below is the only verdict the page shows.
  const services = evaluateLens("Services", kf, health, subs, now);

  // The display-only cash-flow findings read the Cash flow tab's own rows,
  // built here from company facts. The tab's filings are read later, by
  // the tab; the board only reads the latest filing, and only when the
  // acquisitions finding fires and needs the company's caption for the line.
  const baseStatements = buildStatements(facts, kf, periodic, new Map());
  let flows = buildFlowFacts(baseStatements, kf);

  // Filings the board reads itself -- the strip's two balance sheets, the
  // acquisitions caption -- are loaded once each: from the store when they
  // are there, otherwise extracted and stored.
  const loaded = new Map<string, Promise<FilingStatementExtract>>();
  const loadExtract = (filing: FilingEntry) => {
    let p = loaded.get(filing.accessionNumber);
    if (!p) {
      p = loadFilingExtract(record.cik, record.ticker, filing).then((r) => r.extract);
      loaded.set(filing.accessionNumber, p);
    }
    return p;
  };

  // The liquidity vs debt strip reads each period from a filing's own
  // balance sheet, not from the Key financials rows.
  const liquidity = await loadLiquidityDebt(kf, loadExtract);

  // The S5 verdict, as of today, from the same submissions and facts.
  const verdict = await companyVerdict({
    cik: record.cik,
    ticker: record.ticker,
    submissions: subs,
    facts,
    assessmentDate: assessmentDateFor(now),
    loadExtract,
  });
  const revenueNow = kf.revenue.values[0]?.value;
  const acquisitionsFire =
    flows.acquisitions !== undefined &&
    revenueNow !== undefined &&
    revenueNow > 0 &&
    flows.acquisitions > (revenueNow * ACQUISITIONS_PCT_OF_REVENUE) / 100;
  if (acquisitionsFire && latestPeriod) {
    try {
      const extract = await loadExtract(latestPeriod.filing);
      const extracts = new Map<string, FilingStatementExtract>([[extract.accessionNumber, extract]]);
      flows = buildFlowFacts(buildStatements(facts, kf, periodic, extracts), kf);
    } catch {
      // No caption: the finding names the line generically. Never a reason to fail the board.
    }
  }

  // The triggers are read off the Services-lens evaluation because every
  // trigger input -- the figures, the DPO trend, retrenchment, the red
  // flags -- is lens-independent. Only what the matrix does with them
  // differs by lens.
  //
  // Each explanation closes a "What stands out" finding, so each trigger
  // carries the text its finding already shows, for the prompt to exclude.
  // Those findings read the same lens-independent inputs on both lenses.
  const shown = shownByExplainKey(buildStandOut(services, kf, health, flows, record.ticker));
  const triggers = buildExplanationTriggers(kf, services, subs, { acquisitions: acquisitionsFire }).map((t) => ({
    ...t,
    shown: shown.get(t.key),
  }));
  const { items: explained, diagnostics: claudeDiagnostics } = await explainFlaggedItems(triggers, {
    ticker: record.ticker,
    cik: record.cik,
    subs,
    latestPeriod,
  });

  return {
    ticker: record.ticker,
    companyName: record.title,
    cik: record.cik,
    filerCategory: subs.category,
    header,
    keyFinancials: kf,
    health,
    segments,
    annual,
    verdict: verdict.page,
    rdStatus: verdict.result.inputs.rdStatus,
    signals: services,
    explained,
    claudeDiagnostics,
    flows,
    liquidity,
  };
}
