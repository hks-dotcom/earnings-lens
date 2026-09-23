import { PageData } from "@/lib/present/buildPageData";
import { LENS_NAME } from "@/lib/present/lensNames";

/**
 * The board's four footnotes: the data, the verdict rules, the explanation
 * triggers and the limits.
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
        <b>Data.</b> Source: {page.companyName} filings, XBRL via SEC EDGAR. Free cash flow = operating cash flow
        &minus; capital expenditures, as filed in XBRL (tag shown per cell); may differ from a company&apos;s own
        non-GAAP figure. Equity includes noncontrolling interest, everywhere it is used.
      </p>
      <p>
        <b>Verdict rules.</b> Risk is Strong with Z&apos;&apos; safe (&gt; {f.zSafeAbove}), no red flags and payables
        not rising more than {f.dpoBandPct}%; Weak with Z&apos;&apos; in distress (&lt; {f.zDistressBelow}), any red
        flag, a grey zone with rising payables, or under {f.runwayWeakBelowQuarters} quarters of runway (under{" "}
        {f.runwayNeutralCapQuarters} caps at Neutral); Neutral otherwise. A distress score reads as grey for a
        profitable, cash-generating company: Z&apos;&apos; penalises accumulated deficits and buyback-driven negative
        equity. Opportunity is high when revenue is up more than {f.growthBandPct}% and R&amp;D is not down; spending
        cuts set it low for {LENS_NAME.SaaS}.
      </p>
      <p>
        <b>Explanations.</b> Triggers: a non-operating swing past {f.nonOperatingSwingPct}% of quarterly revenue; an
        income tax charge more than {f.taxDivergencePct}% of quarterly revenue away from {f.statutoryTaxRatePct}% of
        pre-tax income, when the same quarter last year was not also that far away; net income and operating income with opposite signs; spending cuts; payables past the band;
        any red flag. Daily call cap: {f.claudeDailyCap}.
      </p>
      <p>
        <b>Limits.</b> Red-flag window: trailing 12 months from today. Going concern: not checked (see Financial
        health).
      </p>
    </div>
  );
}
