/**
 * Builds the verdict engine's inputs for one company from the app's own
 * EDGAR data pull, as of an assessment date, with the data-integrity rules
 * of Earnings_Lens_Verdict_Rules_S5.md section 11 applied (each in its own
 * module under lib/verdict/repairs/).
 *
 * I/O comes in through the loaders the caller passes, so the same builder
 * serves a live read and an as-of read. Nothing here writes anywhere.
 */
import type { CompanyFacts } from "@/lib/edgar/companyFacts";
import type { CompanySubmissions, FilingEntry } from "@/lib/edgar/submissions";
import { periodicFilings } from "@/lib/edgar/submissions";
import type { FilingInstance } from "@/lib/edgar/xbrlInstance";
import type { FilingStatementExtract } from "@/lib/xbrl/statementExtract";
import { buildKeyFinancials, KeyFinancials } from "@/lib/xbrl/keyFinancials";
import { computeFinancialHealth } from "@/lib/metrics/health";
import { nextFilingDue } from "@/lib/metrics/deadlines";
import { computeCashPosition } from "@/lib/rules/runway";
import { findRestructuringFilings } from "@/lib/rules/restructuring";
import { inLookback } from "@/lib/verdict/layer1";
import type { CriticalFiling, CriticalItem, VerdictInputs } from "@/lib/verdict/types";
import { factsAsOf, submissionsAsOf } from "@/lib/verdict/repairs/asOf";
import { checkOcfRebuild, newerFilingNotIncorporated, RebuildCheck, withFilingFacts } from "@/lib/verdict/repairs/staleQuarter";
import { quarterFigures, quarterlyRead, QuarterlyRead } from "@/lib/verdict/repairs/quarterly";
import { FINANCE_SPLIT, netDebtAt, NetDebtPeriod } from "@/lib/verdict/repairs/netDebt";
import { eightKsToScan, filingCalendar, FilingCalendar, fiscalYearChangeSentences, FyChangeHit, requiredReport, RequiredReportResult } from "@/lib/verdict/repairs/filingCalendar";
import { financeArmSignal, FinanceArmSignal, instanceFinanceSignals, InstanceFinanceSignals } from "@/lib/verdict/repairs/financeArm";

export interface InputLoaders {
  extract: (filing: FilingEntry) => Promise<FilingStatementExtract>;
  instance: (filing: FilingEntry) => Promise<FilingInstance>;
  /** An 8-K's documents as text (lib/claude/sources.ts wholeFilingDocs in the app). */
  eightKText: (filing: FilingEntry) => Promise<{ part: string; text: string }[]>;
}

export interface InputSource {
  cik: string;
  ticker: string;
  submissions: CompanySubmissions;
  facts: CompanyFacts;
  assessmentDate: string;
  load: InputLoaders;
}

export interface InputTrace {
  assessmentDate: string;
  r5: { newer: { form: string; periodEnd: string; filingDate: string; accessionNumber: string } | null; check: RebuildCheck | null; incorporated: boolean; why: string | null };
  quarters: QuarterlyRead["periods"];
  consecutiveQuarters: number;
  rd: { tag: string | null; status: string; quarterCounts: Record<string, number>; lastFactEnd: string | null };
  netDebt: { now: NetDebtPeriod; yearAgo: NetDebtPeriod };
  calendar: FilingCalendar & { eightKsScanned: string[]; fyChangeHits: FyChangeHit[]; appProjection: { form: string; periodEnd: string } | null };
  filing: RequiredReportResult;
  financeArm: FinanceArmSignal & { split: boolean; separable: boolean | null };
  runwayCase: string;
  capex12m: { now: number | null; yearAgo: number | null };
}

const CRITICAL_ITEMS: CriticalItem[] = ["1.03", "2.04", "4.02"];

/** 8-K items 1.03, 2.04 and 4.02 in the 12 months before the assessment date. */
export function criticalFilings(subs: CompanySubmissions, assessmentDate: string): CriticalFiling[] {
  const out: CriticalFiling[] = [];
  for (const f of subs.filings) {
    if (f.form !== "8-K" || !inLookback(f.filingDate, assessmentDate)) continue;
    for (const item of f.items.split(",").map((s) => s.trim())) {
      if ((CRITICAL_ITEMS as string[]).includes(item)) out.push({ item: item as CriticalItem, filingDate: f.filingDate, accessionNumber: f.accessionNumber });
    }
  }
  return out;
}

async function rebuildStale(facts: CompanyFacts, subs: CompanySubmissions, load: InputLoaders): Promise<{ facts: CompanyFacts; trace: InputTrace["r5"]; kf: KeyFinancials }> {
  const kf = buildKeyFinancials(facts, periodicFilings(subs), subs.fiscalYearEnd);
  const newer = newerFilingNotIncorporated(kf);
  if (!newer) return { facts, kf, trace: { newer: null, check: null, incorporated: false, why: null } };
  const n = newer.filing;
  const newerTrace = { form: n.form, periodEnd: n.reportDate, filingDate: n.filingDate, accessionNumber: n.accessionNumber };
  let x: FilingStatementExtract;
  try {
    x = await load.extract(n);
  } catch (e) {
    return { facts, kf, trace: { newer: newerTrace, check: null, incorporated: false, why: `the filing could not be read: ${e instanceof Error ? e.message : String(e)}` } };
  }
  const check = checkOcfRebuild(facts, x, newer, kf.lookbackPeriods);
  if (!check.ok) return { facts, kf, trace: { newer: newerTrace, check, incorporated: false, why: check.reasons.join("; ") } };
  const rebuilt = withFilingFacts(facts, x, newer);
  const kfR = buildKeyFinancials(rebuilt, periodicFilings(subs), subs.fiscalYearEnd);
  const q0 = kfR.publishedPeriods[0];
  const ocf0 = kfR.operatingCashFlow.values[0]?.value;
  if (!q0 || q0.filing.accessionNumber !== n.accessionNumber) return { facts, kf, trace: { newer: newerTrace, check, incorporated: false, why: "the rebuilt quarter is not the newest published period" } };
  if (ocf0 !== check.quarter) return { facts, kf, trace: { newer: newerTrace, check, incorporated: false, why: `rebuilt quarterly operating cash flow ${ocf0} does not reconcile to ${check.quarter}` } };
  return { facts: rebuilt, kf: kfR, trace: { newer: newerTrace, check, incorporated: true, why: null } };
}

export async function buildVerdictInputs(src: InputSource): Promise<{ inputs: VerdictInputs; trace: InputTrace }> {
  const date = src.assessmentDate;
  // H: nothing filed after the assessment date.
  const subs = submissionsAsOf(src.submissions, date);
  const asOfFacts = factsAsOf(src.facts, date);

  // R5: a newer filing company facts has not aggregated yet.
  const r5 = await rebuildStale(asOfFacts, subs, src.load);
  const facts = r5.facts;

  // Quarterly series (R6 inside) and the quarter's figures.
  const q = quarterlyRead(facts, subs);
  const kf = q.kf;
  const fig = quarterFigures(q);

  // Net debt now and a year earlier (R3, R4, D, M).
  const now = await netDebtAt(src.cik, kf, facts, 0, src.load);
  const yearAgo = await netDebtAt(src.cik, kf, facts, 4, src.load);

  // R1 / R2.
  const latestFiled = kf.lookbackPeriods[0];
  const annualEnds = kf.lookbackPeriods.filter((p) => p.fp === "FY").map((p) => p.filing.reportDate);
  const due = latestFiled?.placed ? nextFilingDue(latestFiled, subs.category, annualEnds) : undefined;
  const appProjection = due ? { form: due.form, periodEnd: due.estimatedPeriodEnd } : null;
  const latestPeriodEnd = filingCalendar({ filings: subs.filings, fiscalYearEnd: subs.fiscalYearEnd, assessmentDate: date, appProjection: null, fyChangeHits: [] }).latest?.reportDate ?? date;
  const scan = eightKsToScan(subs.filings, latestPeriodEnd, date);
  const hits: FyChangeHit[] = [];
  for (const f of scan) {
    let docs: { part: string; text: string }[] = [];
    try {
      docs = await src.load.eightKText(f);
    } catch {
      continue;
    }
    for (const d of docs) for (const sentence of fiscalYearChangeSentences(d.text)) hits.push({ accessionNumber: f.accessionNumber, filingDate: f.filingDate, items: f.items, part: d.part, sentence });
  }
  const calendar = filingCalendar({ filings: subs.filings, fiscalYearEnd: subs.fiscalYearEnd, assessmentDate: date, appProjection, fyChangeHits: hits });
  const filing = requiredReport({ filings: subs.filings, category: subs.category, assessmentDate: date, calendar });

  // Finance arm: Ford and GM by the split (R3); any other filer by the signal.
  const latestPub = kf.publishedPeriods[0];
  const latestK = kf.publishedPeriods.find((p) => p.fp === "FY");
  const currentEnds = [latestPub?.filing.reportDate, latestK?.filing.reportDate].filter((d): d is string => !!d);
  const instSignals: InstanceFinanceSignals[] = [];
  if (latestPub) {
    try {
      const s = instanceFinanceSignals(await src.load.instance(latestPub.filing), latestPub);
      instSignals.push(s);
      // A 10-Q may tag segments only in the annual note: read the latest 10-K too when the 10-Q has none.
      if (latestK && latestK !== latestPub && s.segmentMembersOnRevenue.length === 0) {
        try {
          instSignals.push(instanceFinanceSignals(await src.load.instance(latestK.filing), latestK));
        } catch {
          // the 10-K instance is supplementary; the 10-Q's own signals stand
        }
      }
    } catch {
      // no instance: the signal reads company facts only
    }
  }
  const signal = financeArmSignal(facts, currentEnds, instSignals);
  const split = !!FINANCE_SPLIT[src.cik.padStart(10, "0")];
  const separable = split ? !!now.financeScope?.separable && !!yearAgo.financeScope?.separable : null;
  const financeArmDebtNotSeparable = split ? !separable : signal.signal;

  const cash = computeCashPosition(kf);
  const health = computeFinancialHealth(kf);
  const sic = Number(subs.sic);
  const stale = !!newerFilingNotIncorporated(kf);
  const newer = stale ? kf.lookbackPeriods[0] : null;
  const restricted = (p: NetDebtPeriod) => !!p.restricted?.notSeparated;

  const inputs: VerdictInputs = {
    ticker: src.ticker,
    assessmentDate: date,
    periodLabel: kf.quarters[0]?.label ?? null,
    periodEnd: kf.quarters[0]?.periodEnd ?? null,
    sic: sic && !Number.isNaN(sic) && sic > 0 ? sic : null,
    revenueYoYPct: fig.revenueYoYPct,
    operatingMarginChangePts: fig.operatingMarginChangePts,
    rdYoYPct: fig.rdYoYPct,
    rdStatus: q.rd.status,
    rdTag: q.rd.tag,
    ocf12m: fig.ocf12m,
    fcf12m: fig.fcf12m,
    revenue12m: fig.revenue12m,
    currentRatio: fig.currentRatio,
    netDebt: { now: now.net, yearAgo: yearAgo.net },
    runwayQuarters: cash.case === "burn" && cash.quarters !== undefined ? cash.quarters : null,
    criticalFilings: criticalFilings(subs, date),
    restructuringFilings: findRestructuringFilings(subs, new Date(`${date}T23:59:59Z`)).map((f) => ({ filingDate: f.filingDate, accessionNumber: f.accessionNumber })),
    filing: filing.observation,
    stale: {
      stale,
      assessedPeriodLabel: stale ? (kf.quarters[0]?.label ?? null) : null,
      newerFiling: newer ? { form: newer.filing.form, periodEnd: newer.filing.reportDate, filingDate: newer.filing.filingDate } : null,
    },
    dataQuality: { financeArmDebtNotSeparable, restrictedCashNotSeparated: restricted(now) || restricted(yearAgo) },
    otherRatios: {
      altmanZ: health.altmanZDoublePrime[0] ?? null,
      dso: health.dso[0] ?? null,
      dpo: health.dpo[0] ?? null,
      debtToEquity: health.debtToEquity[0] ?? null,
    },
    supporting: {
      liquidityNow: now.liquidity,
      totalDebtNow: now.debt,
      currentAssets: fig.currentAssets,
      currentLiabilities: fig.currentLiabilities,
      liquidityNotes: [...new Set([...now.notes, ...yearAgo.notes])],
    },
  };
  return {
    inputs,
    trace: {
      assessmentDate: date,
      r5: r5.trace,
      quarters: q.periods,
      consecutiveQuarters: q.consecutive,
      rd: { tag: q.rd.tag, status: q.rd.status, quarterCounts: q.rd.quarterCounts, lastFactEnd: q.rd.lastFactEnd },
      netDebt: { now, yearAgo },
      calendar: { ...calendar, eightKsScanned: scan.map((f) => `${f.form} ${f.filingDate} ${f.accessionNumber} (${f.items})`), fyChangeHits: hits, appProjection },
      filing,
      financeArm: { ...signal, split, separable },
      runwayCase: cash.case,
      capex12m: fig.capex12m,
    },
  };
}
