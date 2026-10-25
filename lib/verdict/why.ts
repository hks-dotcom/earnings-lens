/**
 * The Why bullets (rules 17.4) and the Financial health summary bullets
 * (rules 17.5), worded from the engine
 * result. Deterministic; every number is the engine's own computed value,
 * and a missing number is never filled in.
 *
 * Where the rules offer alternatives ("<operating cash flow fell | net
 * debt rose>") and more than one applies, each one that applies is given,
 * in the order the rules list them. Net debt and net cash are worded from
 * both balances (rules 17.6).
 */
import { RULES } from "@/lib/verdict/rulesConfig";
import { criticalInWindow } from "@/lib/verdict/layer1";
import { restructuringInWindow } from "@/lib/verdict/sellers";
import { day, money, plain, signed } from "@/lib/verdict/format";
import { balanceWords, listWords, netMovement, plainInputs } from "@/lib/verdict/plain";
import type { FlagName, Seller, Verdict, VerdictResult } from "@/lib/verdict/types";

const TIMES = "×";

/** Bullet 3, fixed per verdict (rules 17.4). */
export const WHAT_IT_MEANS: Record<Seller, Record<Verdict, string>> = {
  CoreThread: {
    Pursue: "Supports engineering work on standard terms",
    "Pursue with guardrails": "Smaller funded milestones and capped unbilled work, per Terms",
    Monitor: "Short funded discovery or a small prepaid milestone only",
    "Limit exposure": "No new unsecured work; funds or security before delivery",
  },
  NexCore: {
    Pursue: "Supports subscription and usage commitments on standard terms",
    "Pursue with guardrails": "Cash before material activation; usage alerts or prepaid credits, per Terms",
    Monitor: "Small funded pilot only, collected before activation",
    "Limit exposure": "No material service before collection or security",
  },
};

const CRITICAL_WORDS = { "1.03": "bankruptcy", "2.04": "debt acceleration", "4.02": "reporting reliability, not necessarily insolvency" } as const;

/**
 * One fired Layer 1 warning in the words of rules 17.4 bullet 1, or null
 * when a number the wording needs is missing.
 */
export function warningPhrase(flag: FlagName, r: VerdictResult): string | null {
  const x = r.inputs;
  const v = r.layer1.values;
  switch (flag) {
    case "SEVERE BURN":
      return `operating cash flow negative for two 12-month periods, under ${RULES.cash.severeRunwayMonths} months of cash`;
    case "CAUTION BURN":
      return `operating cash flow negative for two 12-month periods, ${RULES.cash.severeRunwayMonths}–${RULES.cash.cautionRunwayMonths} months of cash`;
    case "PERSISTENT BURN, RUNWAY UNKNOWN":
      return "operating cash flow negative for two 12-month periods; runway cannot be measured";
    case "INVESTMENT CASH PRESSURE": {
      const legs: string[] = [];
      if (x.ocf12m.now !== null && x.ocf12m.yearAgo !== null && x.ocf12m.now < x.ocf12m.yearAgo) legs.push("operating cash flow fell");
      const { now: nd, yearAgo: ndYA } = x.netDebt;
      if (nd !== null && ndYA !== null && nd > ndYA) {
        // Rules 17.6: worded from both balances.
        if (nd > 0 && ndYA > 0) legs.push("net debt rose");
        else if (nd < 0 && ndYA < 0) legs.push("net cash fell");
        else legs.push(`it ${netMovement(nd, ndYA)}`);
      }
      return legs.length ? `free cash flow negative for two 12-month periods while ${legs.join(" and ")}` : null;
    }
    case "WEAK LIQUIDITY":
      return x.currentRatio === null ? null : `current ratio ${x.currentRatio.toFixed(1)}x with negative operating cash flow`;
    case "OPERATING DETERIORATION": {
      const a = x.revenueYoYPct[0];
      const b = x.operatingMarginChangePts;
      return a === null || b === null ? null : `sales ${signed(a)}% and operating margin ${signed(b)} points on a year ago`;
    }
    case "LEVERAGE":
      return v.leverageMultiple === null ? null : `net debt ${v.leverageMultiple.toFixed(2)}${TIMES} operating cash flow, above ${RULES.borrowing.leverageMultiple}${TIMES}`;
    case "LOW-CASH DEBT": {
      const ocf = x.ocf12m.now;
      const nd = x.netDebt.now;
      const rev = x.revenue12m;
      if (ocf === null || nd === null || rev === null || rev === 0) return null;
      return `operating cash flow ${plain((ocf / rev) * 100)}% of sales with net debt at ${plain((nd / rev) * 100)}% of sales`;
    }
    case "FUNDING SUBSTITUTION":
      return x.netDebt.now === null || x.netDebt.yearAgo === null ? null : `${netMovement(x.netDebt.now, x.netDebt.yearAgo)} while operating cash flow fell`;
    case "MISSED FILING": {
      const f = x.filing;
      if (!f.measurable || !f.form || !f.periodEnd) return null;
      const deadline = f.extendedDeadline ?? f.deadline;
      return deadline ? `${f.form} for ${day(f.periodEnd)} overdue since ${day(deadline)}` : null;
    }
  }
}

/** The deciding Critical filings in the rules 17.4 Critical wording, one per filing in the window. */
export function criticalPhrases(r: VerdictResult): string[] {
  return criticalInWindow(r.inputs).map((c) => `Critical filing: 8-K ${c.item} on ${day(c.filingDate)} (${CRITICAL_WORDS[c.item]})`);
}

/** Bullet 1: financial health, the same for both sellers. */
export function healthBullet(r: VerdictResult): string {
  const l1 = r.layer1;
  if (l1.state === "Critical") return criticalPhrases(r).join(" · ");
  if (l1.state === "Resilient") {
    const fcf = r.inputs.fcf12m.now;
    return `Financial health Resilient: no warning thresholds triggered${fcf !== null && fcf < 0 ? " · capital spending above operating cash flow" : ""}`;
  }
  const phrases = l1.fired.map((f) => warningPhrase(f, r)).filter((p): p is string => p !== null);
  return `Financial health ${l1.state}: ${phrases.join(" · ")}`;
}

const restructuringReasons = (r: VerdictResult) => restructuringInWindow(r.inputs).map((d) => `restructuring filing ${day(d)}`);

/** Bullet 2, CoreThread: engineering spend (rules 17.4). */
export function coreThreadBullet(r: VerdictResult): string {
  const c = r.coreThread.condition;
  const [a, b] = r.inputs.rdYoYPct;
  const opDet = c.legs.some((l) => l.kind === "operating-deterioration");
  if (c.direction === "CAUTION" && c.mixed && a !== null && b !== null) {
    const but = [...restructuringReasons(r), ...(opDet ? ["sales and operating margin falling together"] : [])];
    return `Mixed signals: R&D up ${plain(Math.abs(a))}% / ${plain(Math.abs(b))}%, but ${but.join(" · ")}`;
  }
  if (c.direction === "CAUTION") {
    const reasons: string[] = [];
    for (const leg of c.legs) {
      if (leg.kind === "rd-caution") reasons.push(`R&D ${signed(leg.rdYoYPct[0])}% / ${signed(leg.rdYoYPct[1])}%`);
      if (leg.kind === "restructuring") reasons.push(...leg.filingDates.map((d) => `restructuring filing ${day(d)}`));
      if (leg.kind === "operating-deterioration") reasons.push("sales and operating margin falling together");
    }
    return `Engineering spend under pressure: ${reasons.join(" · ")}`;
  }
  if (c.direction === "EXPANDING" && a !== null && b !== null) return `Engineering spend expanding: R&D ${signed(a)}% and ${signed(b)}% on a year ago`;
  if (c.direction === "FLAT") {
    // FLAT can be read with one quarter missing when the other already rules out both tests; the missing one is left out.
    const known = [a, b].filter((v): v is number => v !== null).map((v) => `${signed(v)}%`);
    return `Engineering spend steady: R&D ${known.join(" / ")} on a year ago`;
  }
  return rdUnknownWords(c.rdUnknownReason);
}

/** Why R&D direction is unknown, in the rules 17.4 words for its actual reason. */
export function rdUnknownWords(reason: string | null): string {
  switch (reason) {
    case "not filed":
      return "R&D not separately disclosed";
    case "annual only":
      return "R&D reported annually only; quarterly trend cannot be determined";
    case "not filed in the window":
      return `No R&D reported in the last ${RULES.window.quarters} quarters`;
    default:
      return "Quarterly R&D trend cannot be determined from the available filings";
  }
}

/** The inputs a not-measurable NexCore caution test lacks, by the explanations' names. */
function nexCoreMissing(r: VerdictResult): string[] {
  const l1 = r.layer1;
  const flags: FlagName[] = [];
  if (l1.flags["OPERATING DETERIORATION"] === null) flags.push("OPERATING DETERIORATION");
  if (l1.anyCashFlag === null) flags.push(...(["SEVERE BURN", "CAUTION BURN", "PERSISTENT BURN, RUNWAY UNKNOWN", "INVESTMENT CASH PRESSURE"] as FlagName[]).filter((f) => l1.flags[f] === null));
  const names: string[] = [];
  for (const a of r.explanations.areas)
    for (const f of a.flags)
      if (flags.includes(f.flag)) for (const i of f.inputs) if (i.value === null && !names.includes(i.name)) names.push(i.name);
  return names;
}

/** Bullet 2, NexCore: cutting back across the business (rules 17.4). */
export function nexCoreBullet(r: VerdictResult): string {
  const n = r.nexCore.condition;
  const a = r.inputs.revenueYoYPct[0];
  const b = r.inputs.operatingMarginChangePts;
  if (n.caution === null) return `Cutting-back warning not fully measurable: ${listWords(plainInputs(nexCoreMissing(r)))}`;
  if (n.caution === true) {
    const plus = [...restructuringReasons(r), ...(r.layer1.anyCashFlag === true ? ["cash-generation warning"] : [])];
    return `Cutting-back warning triggered: sales ${signed(a as number)}%, operating margin ${signed(b as number)} points on a year ago, plus ${plus.join(" · ")}`;
  }
  const parts: string[] = [];
  if (a !== null) parts.push(`sales ${signed(a)}% year over year`);
  if (b !== null) parts.push(`operating margin ${signed(b)} points`);
  return `Cutting-back warning not triggered: ${parts.join(", ")}`;
}

/** The three Why bullets for one seller, in order (rules 17.4). */
export function whyBullets(r: VerdictResult, seller: Seller): [string, string, string] {
  const verdict = seller === "CoreThread" ? r.coreThread.verdict : r.nexCore.verdict;
  return [healthBullet(r), seller === "CoreThread" ? coreThreadBullet(r) : nexCoreBullet(r), WHAT_IT_MEANS[seller][verdict]];
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The bullets under the health state bar (rules 17.5): for a Critical
 * classification the deciding Critical filing first; then one per fired
 * Layer 1 warning in the bullet 1 words; then operating cash flow, free
 * cash flow and net debt. A bullet whose value is missing is dropped, so
 * the count varies.
 */
export function healthSummaryBullets(r: VerdictResult): string[] {
  const x = r.inputs;
  const out: string[] = r.layer1.state === "Critical" ? criticalPhrases(r) : [];
  for (const f of r.layer1.fired) {
    const p = warningPhrase(f, r);
    if (p) out.push(capital(p));
  }
  const { now: ocf, yearAgo: ocfYA } = x.ocf12m;
  if (ocf !== null && ocfYA !== null) {
    // Rules 17.6: dollars, not a percentage, when the prior value is zero or negative or the two have opposite signs.
    const dollars = ocfYA <= 0 || ocf * ocfYA < 0;
    out.push(
      `Operating cash flow ${money(ocf)} over the last 12 months (${dollars ? `from ${money(ocfYA)} the prior 12` : `${signed(((ocf - ocfYA) / ocfYA) * 100)}% on the prior 12`})`
    );
  }
  if (x.fcf12m.now !== null) out.push(`Free cash flow ${money(x.fcf12m.now)} over the last 12 months (Earnings Lens basis)`);
  const { now: nd, yearAgo: ndYA } = x.netDebt;
  if (nd !== null && ndYA !== null) out.push(`${capital(balanceWords(nd))} (${balanceWords(ndYA)} a year ago)`);
  return out;
}
