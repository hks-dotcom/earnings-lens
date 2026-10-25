import { PageData } from "@/lib/present/buildPageData";
import { formatPeriodEnd } from "@/lib/present/format";
import type { Seller } from "@/lib/verdict/types";

/**
 * Deterministic "Copy brief" text, no Claude call: the verdict card as
 * paste-ready bullets, in the card's order. Company and period; the
 * verdict and its evidence; the health state; the three Why bullets; the
 * terms and protections; for NexCore the potential application and likely
 * route. Only what the page shows, and no figure the page does not show.
 */
export function buildCopyBrief(page: PageData, seller: Seller): string {
  const v = page.verdict;
  const s = seller === "CoreThread" ? v.coreThread : v.nexCore;
  const lines: string[] = [];
  lines.push(`- ${page.companyName} (${page.ticker}) · ${page.header.fiscalQuarterLabel}, quarter ended ${formatPeriodEnd(page.header.periodEndDate)} · ${seller}`);
  lines.push(`- Verdict: ${s.verdict}`);
  lines.push(`- Evidence: ${s.evidence.shown}`);
  lines.push(`- Financial health: ${v.state} · ${v.subtitle}`);
  for (const w of s.why) lines.push(`- Why: ${w}`);
  lines.push(`- Terms: ${s.terms}`);
  for (const p of s.protections) lines.push(`- ${p.component}: ${p.lines.join(" · ")}`);
  if (s.condition) lines.push(`- Condition: ${s.condition}`);
  if (seller === "NexCore" && v.nexCore.discovery) {
    const d = v.nexCore.discovery;
    lines.push(`- Potential application: ${d.line}`);
    lines.push(`- Likely route: ${d.route} · ${d.caption}`);
  }
  lines.push("- Source: SEC EDGAR filings (XBRL) · nothing estimated · missing stays missing · not investment advice");
  return lines.join("\n");
}
