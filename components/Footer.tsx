import { PageData } from "@/lib/present/buildPageData";
import { LENS_NAME } from "@/lib/present/lensNames";

/**
 * The board's footnotes: the data, the verdict rules, the display-only
 * findings, the health benchmarks, the explanation triggers and the limits.
 *
 * The thresholds each "What stands out" finding fires on are printed on
 * the finding itself, as its rule line; what is here is everything that
 * decides the verdict and everything that decides what gets explained.
 * The † derivation legend is NOT here: it is generated per ticker under
 * the key-financials table, from the cells' own provenance.
 *
 * Every number below is read from lib/rules/declaredValues.ts through
 * page.footer, never typed in here: a threshold a rule uses and a
 * threshold the footnote prints have to be the same threshold.
 */
export function Footer({ page }: { page: PageData }) {
  const f = page.footer;
  return (
    <div className="board-footnotes">
      <p>
        <b>Data.</b> Source: {page.companyName} filings, XBRL via SEC EDGAR. Statement tabs show standard lines as
        filed; nothing is estimated or plugged, and missing stays missing. Free cash flow = operating cash flow
        &minus; capital expenditures, as filed in XBRL (tag shown per cell); may differ from a company&apos;s own
        non-GAAP figure. Equity includes noncontrolling interest, everywhere it is used.
      </p>
      <p>
        <b>Verdict rules.</b> Risk is low with Z&apos;&apos; safe (&gt; {f.zSafeAbove}), no red flags and payables
        not rising more than {f.dpoBandPct}%; high with Z&apos;&apos; in distress (&lt; {f.zDistressBelow}), any red
        flag, a grey zone with rising payables, or under {f.runwayWeakBelowQuarters} quarters of runway (under{" "}
        {f.runwayNeutralCapQuarters} caps at medium); medium otherwise. Medium or high risk, or spending cuts, put a
        company in the higher-risk half of the matrix. A distress score reads as grey for a profitable,
        cash-generating company: Z&apos;&apos; penalises accumulated deficits and buyback-driven negative equity.
        Opportunity is high when revenue is up more than {f.growthBandPct}% and R&amp;D is not down; spending cuts set
        it low for {LENS_NAME.SaaS}. Spending cuts raise a low risk reading to medium, and Net {f.paymentCeilingDays} is
        offered only when the reading is low.
      </p>
      <p>
        <b>Display-only findings</b>, shown only when their rule fires; none of them affects risk or the Summary.
        Borrowing: net new debt above{" "}
        {f.borrowingPct}% of quarterly revenue while free cash flow is negative or buybacks and dividends exceed it.
        Acquisitions and investments: above {f.acquisitionsPct}% of quarterly revenue. Returns: buybacks plus
        dividends over the last four quarters above free cash flow over the same quarters, and above {f.returnsPct}%
        of quarterly revenue.
      </p>
      <p>
        <b>Benchmarks.</b> Current ratio above {f.benchmarks.currentRatioAbove.toFixed(1)}x; debt / equity below{" "}
        {f.benchmarks.debtToEquityBelow.toFixed(1)}; DSO within {f.benchmarks.dsoWithinDays} days; DPO within{" "}
        {f.benchmarks.dpoWithinDays} days; Altman Z&apos;&apos; above {f.benchmarks.altmanZAbove}. {f.benchmarksNote}
      </p>
      <p>
        <b>Explanations.</b> Triggers: a non-operating swing past {f.nonOperatingSwingPct}% of quarterly revenue; an
        income tax charge more than {f.taxDivergencePct}% of quarterly revenue away from {f.statutoryTaxRatePct}% of
        pre-tax income, when the same quarter last year was not also that far away; net income and operating income with opposite signs; spending cuts, each restructuring filing on its own; payables past the band;
        any red flag; acquisitions and investments past {f.acquisitionsPct}% of quarterly revenue. Daily call cap:{" "}
        {f.claudeDailyCap}.
      </p>
      <p>
        <b>Limits.</b> Red-flag window: trailing 12 months from today. Going concern: not checked (see Financial
        health).
      </p>
    </div>
  );
}
