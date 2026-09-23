// XBRL us-gaap tag names, in fallback order, per logical line item. Filers
// change tags over time (e.g. NVIDIA moved off
// RevenueFromContractWithCustomerExcludingAssessedTax onto plain Revenues
// around FY2023) and use different tags for the same concept (a combined
// "Selling, general and administrative" line vs. separate G&A / S&M lines).
// We never invent a number: if none of a line item's tags have data for a
// period, that period's value stays undefined (missing) for that line.

export const DURATION_CONCEPTS = {
  revenue: [
    "Revenues",
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "SalesRevenueNet",
  ],
  costOfRevenue: [
    "CostOfRevenue",
    "CostOfGoodsAndServicesSold",
    "CostOfGoodsAndServicesSoldExcludingDepreciationDepletionAndAmortization",
  ],
  grossProfit: ["GrossProfit"],
  researchAndDevelopment: ["ResearchAndDevelopmentExpense"],
  sgaCombined: ["SellingGeneralAndAdministrativeExpense"],
  sgaGeneralAndAdministrative: ["GeneralAndAdministrativeExpense"],
  sgaSellingAndMarketing: ["SellingAndMarketingExpense", "SellingExpense", "MarketingExpense"],
  operatingIncome: ["OperatingIncomeLoss"],
  netIncome: ["NetIncomeLoss", "ProfitLoss"],
  // Pre-tax income and the tax charge are read for the two explanation
  // triggers only -- they are never displayed as rows and never feed a
  // lens signal. The "...AndIncomeLossFromEquityMethodInvestments" variant
  // is the one filers with equity-method investees use (NVDA), and the
  // plain "...MinorityInterest" variant is the general case.
  pretaxIncome: [
    "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
    "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
    "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterest",
  ],
  incomeTaxExpense: ["IncomeTaxExpenseBenefit", "IncomeTaxExpenseBenefitContinuingOperations"],
  operatingCashFlow: [
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
  ],
  // Priority order matters: tried per cell (not once per whole row), so a
  // filer that switches tags mid-window (or stops tagging one entirely,
  // like UFPT after Q2 FY25) still resolves whichever quarters the winning
  // tag actually covers, cell by cell -- see resolveDurationSeries.
  capitalExpenditures: [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PaymentsToAcquireProductiveAssets",
    "PaymentsForCapitalImprovements",
  ],
} as const;

export const INSTANT_CONCEPTS = {
  cash: [
    "CashAndCashEquivalentsAtCarryingValue",
    "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
  ],
  accountsReceivable: ["AccountsReceivableNetCurrent", "ReceivablesNetCurrent"],
  accountsPayable: ["AccountsPayableCurrent", "AccountsPayableTradeCurrent"],
  currentAssets: ["AssetsCurrent"],
  currentLiabilities: ["LiabilitiesCurrent"],
  totalAssets: ["Assets"],
  totalLiabilities: ["Liabilities"],
  // Including-NCI first: total equity is the correct match for a total-assets
  // vs. total-liabilities balance-sheet identity (used by the totalLiabilities
  // fallback) and for Altman Z'' X4 and debt/equity. Parent-only
  // StockholdersEquity is the fallback for filers with no NCI line at all.
  equity: [
    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    "StockholdersEquity",
  ],
  retainedEarnings: ["RetainedEarningsAccumulatedDeficit"],
  // Long-term debt, in the three shapes filers report it: a total, a
  // noncurrent balance, and the current portion. The row is "long-term
  // debt including the part due this year", so each list holds only tags
  // that measure that -- commercial paper and other short-term borrowings
  // are a different concept and are deliberately absent.
  //
  // The extra tags past the obvious ones are all cases found in real
  // filings. Coca-Cola stopped tagging LongTermDebtNoncurrent after Q1
  // 2024 and reports LongTermDebtAndCapitalLeaseObligations instead, so a
  // company with $39bn of debt was reading as having tagged none at all.
  // Pinterest and Unity finance themselves with convertible notes, which
  // the taxonomy keeps under its own elements; without them a company with
  // $2.2bn of convertibles also read as untagged. Oracle reports its
  // $122bn as LongTermNotesPayable and NotesPayableCurrent.
  //
  // SeniorNotes is deliberately NOT here: filers use it for per-instrument
  // disclosure, so reading it as a balance would double-count a company
  // that lists each note separately.
  longTermDebtTotal: ["LongTermDebt", "ConvertibleNotesPayable"],
  longTermDebtNoncurrent: [
    "LongTermDebtNoncurrent",
    "LongTermDebtAndCapitalLeaseObligations",
    "ConvertibleDebtNoncurrent",
    "ConvertibleLongTermNotesPayable",
    "LongTermNotesPayable",
  ],
  longTermDebtCurrent: [
    "LongTermDebtCurrent",
    "LongTermDebtAndCapitalLeaseObligationsCurrent",
    "DebtCurrent",
    "ConvertibleDebtCurrent",
    "ConvertibleNotesPayableCurrent",
    "NotesPayableCurrent",
  ],
  shortTermBorrowings: ["ShortTermBorrowings"],
  // Short-term investments: the runway's second term, and a balance-sheet
  // row. Candidate order from the fixture coverage work.
  shortTermInvestments: [
    "ShortTermInvestments",
    "MarketableSecuritiesCurrent",
    "AvailableForSaleSecuritiesDebtSecuritiesCurrent",
    "OtherShortTermInvestments",
  ],
} as const;

// Anchor concepts used purely to read a filing's own (fy, fp) label off of
// company facts -- tried in order, first hit wins. NetIncomeLoss and Assets
// are close to universal across US GAAP filers.
export const ANCHOR_CONCEPTS = ["NetIncomeLoss", "OperatingIncomeLoss", "Assets", "Liabilities"];

export type DurationMetric = keyof typeof DURATION_CONCEPTS;
export type InstantMetric = keyof typeof INSTANT_CONCEPTS;
