/**
 * Finance-arm signal: does the filer consolidate a financing business
 * whose debt sits in its total debt?
 *
 * The rules name Ford and GM (11 R3), whose debt the filings split by
 * business. For any other filer the signal below decides whether evidence
 * carries "finance-arm debt not separable" (rules section 8). It is the
 * signal the S4 simulation used to produce the locked regression fixtures:
 * a financing-receivable, finance cash-flow or finance-revenue tag at the
 * current period ends, a finance-named member on the business-segment
 * axis, or a finance-named entity member on a debt concept.
 */
import type { CompanyFacts } from "@/lib/edgar/companyFacts";
import { getConceptPoints } from "@/lib/edgar/companyFacts";
import type { FilingInstance } from "@/lib/edgar/xbrlInstance";
import { DURATION_CONCEPTS } from "@/lib/xbrl/concepts";
import { DURATION_WINDOWS, FilingPeriod } from "@/lib/xbrl/periods";

const FIN_RECEIVABLE_TAGS = [
  "FinancingReceivableExcludingAccruedInterestAfterAllowanceForCreditLoss",
  "FinancingReceivableExcludingAccruedInterestAfterAllowanceForCreditLossCurrent",
  "FinancingReceivableExcludingAccruedInterestAfterAllowanceForCreditLossNoncurrent",
  "FinancingReceivableExcludingAccruedInterestBeforeAllowanceForCreditLoss",
  "FinancingReceivableAfterAllowanceForCreditLossCurrent",
  "FinancingReceivableAfterAllowanceForCreditLossNoncurrent",
  "NotesAndLoansReceivableNetCurrent",
  "NotesAndLoansReceivableNetNoncurrent",
  "LoansAndLeasesReceivableNetReportedAmount",
  "LoansAndLeasesReceivableNetOfDeferredIncome",
  "SalesTypeAndDirectFinancingLeasesLeaseReceivable",
  "NetInvestmentInLease",
];
const FIN_CASHFLOW_TAGS = ["PaymentsToAcquireFinanceReceivables", "ProceedsFromCollectionOfFinanceReceivables", "ProceedsFromSaleOfFinanceReceivables", "IncreaseDecreaseInFinanceReceivables"];
const FIN_REVENUE_TAGS = ["FinancialServicesRevenue", "RevenueFromFinancialServices", "InterestAndFeeIncomeLoansAndLeases"];

const FIN_NAME = /financ|credit|capital|leasing/i;
// Debt-instrument members are not entities: a credit facility is not a finance arm.
const INSTRUMENT_NAME = /CreditFacilit|LineOfCredit|RevolvingCredit|LetterOfCredit|CreditAgreement|TermLoan|CommercialPaper|Notes?Member|Bond|Debenture|CapitalLease|WorkingCapital|CapitalStock|AdditionalPaidInCapital|CapitalUnits|VentureCapital|CapitalExpenditure/i;
// Axes that describe the instrument rather than who owes it.
const INSTRUMENT_AXIS = /DebtInstrument|LongtermDebtType|ShortTermDebtType|DebtType|LineOfCredit|CreditFacility|Instrument|Range|Maturity|Award|Plan|Counterparty|Hedg|Derivative|FairValue|Measurement|PortfolioSegment|ClassOfFinancingReceivable|Lessee|Lessor|Lease|VariableRate|EquityMethod|Investee|Spread/i;
const NOT_AN_ENTITY_HIT = /VariableRate|EquityMethod|Investee|Spread|SecuredOvernightFinancingRate/i;
const DEBT_CONCEPT = /Debt|Borrowings|NotesPayable|CommercialPaper|LongTermLoans/;
const SEGMENT_AXIS = "us-gaap:StatementBusinessSegmentsAxis";
/** Entity hits kept per instance (in fact order) before the entity filter. */
const ENTITY_HITS_KEPT = 12;

export interface InstanceFinanceSignals {
  segmentMembersOnRevenue: string[];
  financeSegmentMembers: string[];
  financeEntityDebtHits: string[];
}

export function instanceFinanceSignals(inst: FilingInstance, period: FilingPeriod): InstanceFinanceSignals {
  const end = period.filing.reportDate;
  const window = period.fp === "FY" ? DURATION_WINDOWS.FY : DURATION_WINDOWS.Q1;
  const revenue = DURATION_CONCEPTS.revenue.map((c) => `us-gaap:${c}`);
  const segMembers = new Set<string>();
  const finSegments = new Set<string>();
  const finEntity = new Set<string>();
  for (const f of inst.facts) {
    const ctx = inst.contexts.get(f.contextRef);
    if (!ctx) continue;
    for (const [axis, member] of Object.entries(ctx.members)) {
      if (axis === SEGMENT_AXIS && FIN_NAME.test(member) && !INSTRUMENT_NAME.test(member)) finSegments.add(member);
      if (DEBT_CONCEPT.test(f.concept) && !INSTRUMENT_AXIS.test(axis) && FIN_NAME.test(member) && !INSTRUMENT_NAME.test(member)) finEntity.add(`${axis}=${member} on ${f.concept}`);
    }
    if (!revenue.includes(f.concept) || !ctx.start || ctx.end !== end) continue;
    const d = Math.round((Date.parse(ctx.end) - Date.parse(ctx.start)) / 86_400_000);
    if (d < window[0] || d > window[1]) continue;
    const extra = Object.keys(ctx.members).filter((a) => a !== "srt:ConsolidationItemsAxis");
    if (extra.length === 1 && extra[0] === SEGMENT_AXIS) segMembers.add(ctx.members[SEGMENT_AXIS]);
  }
  return {
    segmentMembersOnRevenue: [...segMembers],
    financeSegmentMembers: [...finSegments],
    financeEntityDebtHits: [...finEntity].slice(0, ENTITY_HITS_KEPT).filter((h) => !NOT_AN_ENTITY_HIT.test(h.split(" on ")[0])),
  };
}

export interface FinanceArmSignal {
  signal: boolean;
  financingReceivables: string[];
  financeCashFlow: string[];
  financeRevenue: string[];
  financeSegmentMembers: string[];
  financeEntityDebtHits: string[];
}

/** Tags with a non-zero value at one of the current period ends. */
function tagsAtCurrent(facts: CompanyFacts, tags: string[], currentEnds: string[]): string[] {
  return tags.filter((t) => (getConceptPoints(facts, t) ?? []).some((p) => currentEnds.includes(p.end) && p.val !== 0));
}

export function financeArmSignal(facts: CompanyFacts, currentEnds: string[], instances: InstanceFinanceSignals[]): FinanceArmSignal {
  const financingReceivables = tagsAtCurrent(facts, FIN_RECEIVABLE_TAGS, currentEnds);
  const financeCashFlow = tagsAtCurrent(facts, FIN_CASHFLOW_TAGS, currentEnds);
  const financeRevenue = tagsAtCurrent(facts, FIN_REVENUE_TAGS, currentEnds);
  const financeSegmentMembers = [...new Set(instances.flatMap((i) => i.financeSegmentMembers))];
  const financeEntityDebtHits = instances.flatMap((i) => i.financeEntityDebtHits);
  return {
    signal: [financingReceivables, financeCashFlow, financeRevenue, financeSegmentMembers, financeEntityDebtHits].some((x) => x.length > 0),
    financingReceivables,
    financeCashFlow,
    financeRevenue,
    financeSegmentMembers,
    financeEntityDebtHits,
  };
}
