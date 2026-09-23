import { LensResult } from "@/lib/rules/evaluateLens";
import { PageData } from "@/lib/present/buildPageData";
import { termsCeilingDays } from "@/lib/rules/ladder";
import { computeNetIncomeGap } from "@/lib/present/netIncomeGap";
import { chooseUnit, formatMoneyInline } from "@/lib/present/format";
import { buildStandOut, paymentTimingCaveat, StandOutItem } from "@/lib/present/standOut";
import { summaryText } from "@/lib/present/summary";
import { ALTMAN_CAP_NOTE } from "@/lib/metrics/health";
import { LENS_NAME } from "@/lib/present/lensNames";
import { findingProse } from "@/lib/present/findingExplanations";
import type { ExplainedItem } from "@/lib/claude/explain";
import { heroSubline, whyThisVerdict } from "@/lib/present/verdictReasons";
import { riskWord } from "@/lib/present/riskWords";
import { liquidityBriefLine } from "@/lib/present/liquidityDebt";

/**
 * Deterministic "Copy brief" text -- no Claude call. Per spec: company,
 * period and lens; the verdict and the signals behind it; the terms
 * envelope (with the billing assumption); the filed figures; the source
 * line.
 *
 * It follows the page it came off, in the page's own order: the Summary,
 * then what stands out, then the terms envelope. Two things on the brief
 * are deliberately NOT on the page, because the reader who needs them is
 * not the reader looking at the screen:
 *
 * - **credit exposure**, which the deal desk works from, and which differs
 *   by lens because the billing does (monthly in arrears vs. annual in
 *   advance);
 * - **"Use case and product: GTM's call"**, because finance answers
 *   whether we can do business and on what terms, and the page would
 *   otherwise be silent on a question its reader will be asked next.
 */
export function buildCopyBrief(page: PageData, lens: LensResult): string {
  const standOut = buildStandOut(lens, page.keyFinancials, page.health, page.flows, page.ticker);
  const lines: string[] = [];

  lines.push(`${page.companyName} (${page.ticker}) — ${page.header.fiscalQuarterLabel} — ${LENS_NAME[lens.lens]} lens`);
  lines.push("");
  lines.push(`Verdict: ${lens.quadrant}`);
  lines.push(heroSubline(lens));
  lines.push(summaryText(lens, page.keyFinancials, page.health, standOut));
  lines.push("");
  // The Why box's two lines, in the page's own words: risk as low, medium
  // or high, never the rules' internal rung names.
  const why = whyThisVerdict(lens, page.keyFinancials);
  lines.push("Behind the verdict:");
  lines.push(`- ${why.risk.label} ${why.risk.text}`);
  lines.push(`- ${why.opportunity.label} ${why.opportunity.text}`);
  lines.push(
    `- Payment behaviour: ${lens.paymentBehavior.state} (DPO ${lens.paymentBehavior.dpoCurrent?.toFixed(1) ?? "MISSING"} vs ${lens.paymentBehavior.dpoYearAgo?.toFixed(1) ?? "MISSING"} a year ago)`
  );
  lines.push(
    `- Spending cuts: ${lens.retrenchment.triggered ? "signaled — " + lens.retrenchment.causes.join("; ") : "none in figures"}`
  );
  lines.push("");
  lines.push("What stands out:");
  for (const item of standOut) lines.push(`- ${briefLine(item, page.explained)}`);
  lines.push("");
  lines.push(`Terms finance will accept:`);
  lines.push(
    `- Payment terms: Net 30 ${lens.ladder.net30 ? "✓" : "✕"}${lens.ladder.escalateBeforeSigning ? " (escalate before signing)" : ""}, Net 45 ${lens.ladder.net45 ? "✓" : "✕"}, Net 60 ✕ (risk ${lens.risk.reading}, so the ceiling is Net ${termsCeilingDays(lens.risk.reading)}; Net 45 is offered only when risk is ${riskWord("Strong")})`
  );
  lines.push(`- Credit exposure: ${lens.dealStructure.creditExposure} (${lens.dealStructure.billingAssumption})`);
  lines.push(`- ${lens.negotiationNote}`);
  const caveat = paymentTimingCaveat(lens, page.keyFinancials);
  if (caveat) lines.push(`- ${caveat}`);
  if (lens.dealStructure.contractStructure) {
    lines.push(`- Contract structure: ${lens.dealStructure.contractStructure}.`);
  }
  lines.push(`- Use case and product: GTM's call.`);
  lines.push("");
  lines.push("Filed figures behind this:");
  // "The Copy brief carries the unit on every figure" -- the same unit and
  // precision the table is showing, so a pasted line can't be read as a
  // different scale from the screen it came off.
  const unit = chooseUnit(page.keyFinancials.revenue.values[0]?.value);
  const rev = page.keyFinancials.revenue.values[0];
  const opInc = page.keyFinancials.operatingIncome.values[0];
  const netInc = page.keyFinancials.netIncome.values[0];
  lines.push(
    `- Revenue: ${formatMoneyInline(rev?.value, unit)} (${page.header.fiscalQuarterLabel}, quarter ended ${page.header.periodEndDate}, Y/Y ${lens.revenue.yoyPct?.toFixed(1) ?? "MISSING"}%)`
  );
  lines.push(`- Operating income: ${formatMoneyInline(opInc?.value, unit)}`);
  lines.push(`- Net income: ${formatMoneyInline(netInc?.value, unit)} — ${computeNetIncomeGap(page.keyFinancials).note}`);
  lines.push(
    `- Altman Z'': ${lens.altmanZPrime?.toFixed(2) ?? "MISSING"}${lens.altmanZone.capped ? ` — ${ALTMAN_CAP_NOTE}` : ""}`
  );
  const cash = lens.cashPosition;
  if (cash.case === "burn") {
    lines.push(
      `- Runway: ${cash.quarters ?? "MISSING"} quarters — ${
        cash.liquidityBasis === "cash-and-short-term-investments"
          ? `cash ${formatMoneyInline(cash.cash, unit)} + short-term investments ${formatMoneyInline(cash.shortTermInvestments, unit)}`
          : `cash ${formatMoneyInline(cash.cash, unit)}${cash.liquidityBasis === "cash-only-missing-this-quarter" ? " (short-term investments not filed for this quarter)" : ""}`
      } ÷ ${cash.burnBasis ?? "MISSING"} burn ${formatMoneyInline(cash.burnUsed, unit)} (this quarter ${formatMoneyInline(cash.latestBurn, unit)}, four-quarter average ${formatMoneyInline(cash.averageBurn, unit)})`
    );
  } else if (cash.case === "heavy-investment") {
    lines.push(
      `- Heavy investment: capex ${formatMoneyInline(cash.capitalExpenditure, unit)} against operating cash flow ${formatMoneyInline(cash.operatingCashFlow, unit)}. Operations funded the quarter, so no runway applies and the terms ladder is untouched.`
    );
  }
  lines.push(`- ${liquidityBriefLine(page.liquidity)}`);
  lines.push(
    `- Red flags (12mo): ${lens.redFlags.findings.length === 0 ? "none" : lens.redFlags.findings.map((f) => f.detail).join(" | ")}`
  );
  lines.push("");
  lines.push(`Source: ${page.companyName} filings via SEC EDGAR XBRL, as of ${page.header.periodEndDate}.`);
  return lines.join("\n");
}

/**
 * One "What stands out" item as a single pasted line: tag, headline, the
 * finding's text -- closed, as on the board, by the filing's explanation
 * and its citation where there is one -- then the figures behind it.
 */
function briefLine(item: StandOutItem, explained: ExplainedItem[]): string {
  const marks = item.terms ? `${item.terms.map((t) => `${t.label} ${t.ok ? "✓" : "✕"}`).join(" · ")} — ` : "";
  const figures = item.figures ? ` (${item.figures})` : "";
  return `${item.tag}: ${marks}${item.headline} ${findingProse(item, explained)}${figures}`;
}
