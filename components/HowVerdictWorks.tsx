import { RULES } from "@/lib/verdict/rulesConfig";

const B = RULES.borrowing;
const pct = (k: number) => `${+(k * 100).toFixed(4)}%`;

/**
 * "How the verdict works" (mock V24), with the rules 17.2 additions:
 * Filing status Critical and "Not fully measurable". The potential
 * application line follows rules 14 D1 (industry code only). Thresholds
 * are read from the rules config, never typed in.
 */
export const HOW_IT_WORKS: string[] = [
  "Financial health, the same for both entities, from five areas: cash generation · near-term liquidity · operating performance · funding and leverage · filing status",
  "Resilient = no warning · Watch = warnings in one area · Fragile = severe cash burn or warnings in two areas · Critical = bankruptcy, debt-acceleration or non-reliance filing in 12 months",
  "Filing status reads Critical when an 8-K item 1.03, 2.04 or 4.02 is filed in the last 12 months · a 4.02 means past financials can’t be relied on, not necessarily that the company is insolvent",
  "Not fully measurable = no warning in an area, but at least one of its tests could not run · it lowers evidence to Limited, never the health state",
  `Funding and leverage warns when net debt is above ${B.leverageMultiple}× a year's operating cash flow, or above ${pct(B.netDebtShareOfRevenue)} of a year's sales while operating cash flow is ${pct(B.ocfShareOfRevenue)} of sales or less, or rises sharply while operating cash flow falls`,
  `CoreThread adds: R&D up or down ${RULES.coreThread.rdExpandingPct}%+ for two quarters, restructuring filings, sales and margins falling together`,
  "NexCore adds: cutting back across the business (sales and margins falling together, plus a restructuring or a cash warning)",
  "Potential application and likely route (NexCore) are a sales prompt from the industry code; they never change the verdict",
  "Net 30 baseline · Net 45 on request, only when health is Resilient with no caution · Net 60 never",
  "A favourable verdict = financially reasonable on these terms, not proof they need what we sell",
  "Source: SEC EDGAR filings (XBRL) · nothing estimated · missing stays missing · not investment advice",
];

export function HowVerdictWorks() {
  return (
    <section className="how">
      <strong>How the verdict works</strong>
      <ul>
        {HOW_IT_WORKS.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </section>
  );
}
