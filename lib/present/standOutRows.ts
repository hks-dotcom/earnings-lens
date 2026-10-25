/**
 * "What stands out" rows as the page shows them (mock V24, rules 14 D2,
 * 17.6): the findings that are still shown, each as a tag, a headline and
 * its figures line, plus the filing-status item when the engine has one.
 */
import { StandOutItem, StandOutTone, StatementTag } from "@/lib/present/standOut";
import type { FilingStatusResult } from "@/lib/verdict/types";
import { day } from "@/lib/verdict/format";

export interface StandOutRow {
  key: string;
  tag: string;
  tone: StandOutTone;
  headline: string;
  detail: string;
  statements: StatementTag[];
  /** Red flags and the filing-status item are never filtered out: a filter must never hide a reason to escalate. */
  always: boolean;
}

/**
 * Mock V24's headline for a finding where its wording holds whenever the
 * finding fires (heavy investment fires only when capital spending is above
 * operating cash flow; payables only when payables days rise). Every other
 * finding keeps its own headline, as a label without the closing stop.
 */
const V24_HEADLINE: Partial<Record<StandOutItem["kind"], string>> = {
  "heavy-investment": "Capital spending above operating cash flow",
  payables: "Payables days up",
};

/**
 * The findings the page shows. The old terms item is retired (the verdict
 * card has the terms), and so is the old missed-deadline red flag: the
 * rules 14 D2 filing-status item is the single filing-status authority
 * (rules 17.6).
 */
export function shownFindings(items: StandOutItem[]): StandOutItem[] {
  return items.filter((i) => i.kind !== "terms" && !(i.kind === "red-flag" && i.explainKey?.startsWith("red-flag:missed-deadline:")));
}

export function standOutRows(items: StandOutItem[], filingItem: FilingStatusResult["standsOut"]): StandOutRow[] {
  const rows: StandOutRow[] = shownFindings(items)
    .map((i, n) => ({
      key: `${i.kind}-${n}`,
      tag: i.tag,
      tone: i.tone,
      headline: V24_HEADLINE[i.kind] ?? i.headline.replace(/\.$/, ""),
      // Missing stays missing, in the page's words (rules 17.6).
      detail: i.figures.replace(/\bMISSING\b/g, "not available"),
      statements: i.statements ?? [],
      always: i.kind === "red-flag",
    }));
  if (filingItem) {
    const f = filingItem;
    const parts = [f.form, f.period ? `period ended ${day(f.period)}` : null];
    if (f.kind === "Overdue filing") parts.push(f.deadline ? `deadline ${day(f.deadline)}` : null);
    else parts.push(f.extendedDeadline ? `${f.kind === "Filed late" ? "applicable" : "extended"} deadline ${day(f.extendedDeadline)}` : null);
    if (f.filingDate) parts.push(`filed ${day(f.filingDate)}`);
    rows.unshift({
      key: "filing-status",
      tag: "FILING STATUS",
      tone: f.kind === "Informational" ? "info" : "watch",
      headline: f.kind,
      detail: parts.filter(Boolean).join(" · "),
      statements: ["filings"],
      always: true,
    });
  }
  return rows;
}

