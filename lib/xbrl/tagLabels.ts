/**
 * Plain-English names for the XBRL tags this app reads.
 *
 * "Footnotes use plain labels ('operating cash flow − capital
 * expenditures'), never XBRL tag names; tag names stay in each cell's
 * provenance, shown on hover, not in text a reader has to parse."
 *
 * A reader checking whether to trust a derived figure needs to know what
 * was subtracted from what. "NetCashProvidedByUsedInOperatingActivities −
 * PaymentsToAcquireProductiveAssets" answers that only for someone who
 * already reads XBRL; for everyone else it is a wall. The tag is still the
 * authoritative answer to "which fact exactly", so it stays on the cell.
 */
const TAG_LABELS: Record<string, string> = {
  // Revenue and cost
  Revenues: "revenue",
  RevenueFromContractWithCustomerExcludingAssessedTax: "revenue",
  RevenueFromContractWithCustomerIncludingAssessedTax: "revenue",
  SalesRevenueNet: "revenue",
  CostOfRevenue: "cost of revenue",
  CostOfGoodsAndServicesSold: "cost of revenue",
  CostOfGoodsAndServicesSoldExcludingDepreciationDepletionAndAmortization:
    "cost of revenue (excluding depreciation and amortisation)",
  GrossProfit: "gross profit",

  // Operating expenses
  ResearchAndDevelopmentExpense: "R&D",
  SellingGeneralAndAdministrativeExpense: "selling, general and administrative",
  GeneralAndAdministrativeExpense: "general and administrative",
  SellingAndMarketingExpense: "selling and marketing",
  SellingExpense: "selling",
  MarketingExpense: "marketing",
  OperatingIncomeLoss: "operating income",
  NetIncomeLoss: "net income",
  ProfitLoss: "net income",

  // Cash flow
  NetCashProvidedByUsedInOperatingActivities: "operating cash flow",
  NetCashProvidedByUsedInOperatingActivitiesContinuingOperations:
    "operating cash flow (continuing operations)",
  PaymentsToAcquirePropertyPlantAndEquipment: "capital expenditures",
  PaymentsToAcquireProductiveAssets: "capital expenditures",
  PaymentsForCapitalImprovements: "capital expenditures",

  // Balance sheet
  CashAndCashEquivalentsAtCarryingValue: "cash & equivalents",
  CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents:
    "cash, equivalents and restricted cash",
  AccountsReceivableNetCurrent: "receivables",
  ReceivablesNetCurrent: "receivables",
  AccountsPayableCurrent: "payables",
  AccountsPayableTradeCurrent: "trade payables",
  AssetsCurrent: "current assets",
  LiabilitiesCurrent: "current liabilities",
  Assets: "total assets",
  Liabilities: "total liabilities",
  StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest: "total equity",
  StockholdersEquity: "total equity",
  RetainedEarningsAccumulatedDeficit: "retained earnings",
  LongTermDebt: "long-term debt",
  LongTermDebtNoncurrent: "long-term debt (noncurrent)",
  LongTermDebtCurrent: "long-term debt due this year",
  DebtCurrent: "debt due this year",
  ShortTermBorrowings: "short-term borrowings",
};

/** De-camel-case as a last resort, so an unmapped tag still reads as words. */
function humanise(tag: string): string {
  return tag
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase();
}

export function plainLabel(tag: string): string {
  return TAG_LABELS[tag] ?? humanise(tag);
}

/**
 * Turns a cell's concept string into plain words. Composites carry the
 * arithmetic that produced them ("A+B", "A-B"); both sides are translated
 * and the operator is kept, since the operator is the informative part.
 */
export function plainFormula(concept: string, minus = "−"): string {
  const plus = concept.split("+");
  if (plus.length === 2) return `${plainLabel(plus[0])} + ${plainLabel(plus[1])}`;
  // Split only on a "-" between two tag names, not a hyphen inside one.
  const diff = concept.split(/-(?=[A-Za-z])/);
  if (diff.length === 2) return `${plainLabel(diff[0])} ${minus} ${plainLabel(diff[1])}`;
  return plainLabel(concept);
}
