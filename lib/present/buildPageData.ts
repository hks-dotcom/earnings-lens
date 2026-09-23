import { resolveTicker } from "@/lib/edgar/tickers";
import { getSubmissions, periodicFilings, resultsEightKs } from "@/lib/edgar/submissions";
import { getCompanyFacts } from "@/lib/edgar/companyFacts";
import { getFilingInstance } from "@/lib/edgar/xbrlInstance";
import { buildKeyFinancials, KeyFinancials } from "@/lib/xbrl/keyFinancials";
import { computeFinancialHealth, FinancialHealth } from "@/lib/metrics/health";
import { nextFilingDue, NextFilingDue } from "@/lib/metrics/deadlines";
import { extractSegmentRevenueForPeriod, SegmentRevenue } from "@/lib/xbrl/segments";
import { evaluateLens, LensResult } from "@/lib/rules/evaluateLens";
import { buildAnnualFigures, AnnualFigures } from "@/lib/present/annualFigures";
import {
  ALTMAN_CAP_RATIONALE,
  ALTMAN_ZONES,
  CASH_CASE_RULE,
  CLAUDE_DAILY_CAP,
  COSTS_VS_REVENUE_POINTS,
  DPO_BAND_PCT,
  GROSS_MARGIN_MOVE_PTS,
  GROWTH_FLAT_BAND_PCT,
  OPERATING_INCOME_FAST_MOVE_PCT,
  OPERATING_INCOME_MOVE_PCT,
  RUNWAY_NEUTRAL_CAP_QUARTERS,
  RUNWAY_WEAK_BELOW_QUARTERS,
  NON_OPERATING_SWING_PCT_OF_REVENUE,
  PAYMENT_TERMS_BASELINE_DAYS,
  PAYMENT_TERMS_CEILING_DAYS,
  STATUTORY_TAX_RATE_PCT,
  TAX_DIVERGENCE_PCT_OF_REVENUE,
} from "@/lib/rules/declaredValues";
import { buildExplanationTriggers } from "@/lib/rules/explanationTriggers";
import { buildStandOut } from "@/lib/present/standOut";
import { shownByExplainKey } from "@/lib/present/findingExplanations";
import { ExplainedItem, explainFlaggedItems, ExplainDiagnostics } from "@/lib/claude/explain";
import { readSegments, writeSegments } from "@/lib/db/store";

export interface HeaderLine {
  periodEndDate: string;
  fiscalQuarterLabel: string;
  dueBy: NextFilingDue | undefined;
  newResultsAnnounced: { date: string } | undefined;
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
  lenses: {
    Services: LensResult;
    SaaS: LensResult;
  };
  /**
   * The flagged items, explained from filed text. Shared by both lenses:
   * the triggers are the same figures and the same filings either way, so
   * explaining them twice would be two calls for one answer. The one
   * lens-specific trigger (retrenchment sets the SaaS lens's opportunity to
   * low, but fires for both) is already the same fact.
   */
  explained: ExplainedItem[];
  claudeDiagnostics: ExplainDiagnostics;
  footer: {
    zSafeAbove: number;
    zDistressBelow: number;
    altmanCapRationale: string;
    growthBandPct: number;
    dpoBandPct: number;
    paymentBaselineDays: number;
    paymentCeilingDays: number;
    runwayNeutralCapQuarters: number;
    runwayWeakBelowQuarters: number;
    cashCaseRule: string;
    costsVsRevenuePoints: number;
    operatingIncomeMovePct: number;
    operatingIncomeFastMovePct: number;
    grossMarginMovePts: number;
    nonOperatingSwingPct: number;
    taxDivergencePct: number;
    statutoryTaxRatePct: number;
    claudeDailyCap: number;
  };
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

  // "New results announced" -- a results 8-K (Item 2.02) newer than the latest 10-Q/10-K.
  const newestResults8K = resultsEightKs(subs)[0];
  const newResultsAnnounced =
    newestResults8K && (!latestFiledPeriod || newestResults8K.filingDate > latestFiledPeriod.filing.filingDate)
      ? { date: newestResults8K.filingDate }
      : undefined;

  const header: HeaderLine = {
    periodEndDate: kf.quarters[0]?.periodEnd ?? "",
    fiscalQuarterLabel: kf.quarters[0]?.label ?? "",
    dueBy,
    newResultsAnnounced,
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

  const services = evaluateLens("Services", kf, health, subs, now);
  const saas = evaluateLens("SaaS", kf, health, subs, now);

  // The triggers are read off the Services-lens evaluation because every
  // trigger input -- the figures, the DPO trend, retrenchment, the red
  // flags -- is lens-independent. Only what the matrix does with them
  // differs by lens.
  //
  // Each explanation closes a "What stands out" finding, so each trigger
  // carries the text its finding already shows, for the prompt to exclude.
  // Those findings read the same lens-independent inputs on both lenses.
  const shown = shownByExplainKey(buildStandOut(services, kf, health));
  const triggers = buildExplanationTriggers(kf, services, subs).map((t) => ({ ...t, shown: shown.get(t.key) }));
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
    lenses: { Services: services, SaaS: saas },
    explained,
    claudeDiagnostics,
    footer: {
      zSafeAbove: ALTMAN_ZONES.safeAbove,
      zDistressBelow: ALTMAN_ZONES.distressBelow,
      altmanCapRationale: ALTMAN_CAP_RATIONALE,
      growthBandPct: GROWTH_FLAT_BAND_PCT,
      dpoBandPct: DPO_BAND_PCT,
      paymentBaselineDays: PAYMENT_TERMS_BASELINE_DAYS,
      paymentCeilingDays: PAYMENT_TERMS_CEILING_DAYS,
      runwayNeutralCapQuarters: RUNWAY_NEUTRAL_CAP_QUARTERS,
      runwayWeakBelowQuarters: RUNWAY_WEAK_BELOW_QUARTERS,
      cashCaseRule: CASH_CASE_RULE,
      costsVsRevenuePoints: COSTS_VS_REVENUE_POINTS,
      operatingIncomeMovePct: OPERATING_INCOME_MOVE_PCT,
      operatingIncomeFastMovePct: OPERATING_INCOME_FAST_MOVE_PCT,
      grossMarginMovePts: GROSS_MARGIN_MOVE_PTS,
      nonOperatingSwingPct: NON_OPERATING_SWING_PCT_OF_REVENUE,
      taxDivergencePct: TAX_DIVERGENCE_PCT_OF_REVENUE,
      statutoryTaxRatePct: STATUTORY_TAX_RATE_PCT,
      claudeDailyCap: CLAUDE_DAILY_CAP,
    },
  };
}
