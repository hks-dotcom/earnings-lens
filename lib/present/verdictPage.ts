/**
 * The page model for the S5 verdict (Earnings_Lens_Verdict_Rules_S5.md,
 * mock V24): everything the verdict card, the Financial health section and
 * "How the verdict works" show, read off one engine result.
 *
 * Nothing here decides anything. Verdicts, evidence, terms, protections,
 * flags, areas, the potential application and its route are the engine's;
 * this module only lays them out and formats the engine's own numbers. A
 * missing number stays missing.
 */
import { areaDisplays, AreaDisplay } from "@/lib/verdict/display";
import { ROUTES } from "@/lib/verdict/potentialApplication";
import { healthSummaryBullets, rdUnknownWords, whyBullets } from "@/lib/verdict/why";
import { RULES } from "@/lib/verdict/rulesConfig";
import { balanceWords, TEST_NAME } from "@/lib/verdict/plain";
import { areaTip, AreaTip, NOT_AVAILABLE } from "@/lib/present/verdictTips";
import type {
  EvidenceLevel,
  FilingStatusResult,
  FlagName,
  HealthState,
  LikelyRoute,
  Seller,
  Verdict,
  VerdictResult,
} from "@/lib/verdict/types";
import { MINUS } from "@/lib/present/format";

export const VERDICT_STEPS: Verdict[] = ["Pursue", "Pursue with guardrails", "Monitor", "Limit exposure"];
export const HEALTH_STEPS: HealthState[] = ["Resilient", "Watch", "Fragile", "Critical"];

export interface SellerPanel {
  seller: Seller;
  verdict: Verdict;
  /** Rules 17.4: exactly three. */
  why: [string, string, string];
  /**
   * Rules 8. `reasons` are the engine's; `shown` is the line under the
   * kicker: "Limited · R&D not separately disclosed".
   */
  evidence: { level: EvidenceLevel; reasons: string[]; assessedOn: string | null; shown: string };
  /** "Net 30 ✓ · Net 45 on request · Net 60 ✕" (rules 7.1). */
  terms: string;
  /** Rules 7.2, one row per contract component, "Same" resolved. */
  protections: { component: string; lines: string[] }[];
  /** Rules 7.3, NexCore Fragile only. */
  condition: string | null;
}

export interface Discovery {
  line: string;
  route: LikelyRoute;
  routes: LikelyRoute[];
  sic: number;
  /** "Rough guide from the industry code · Industry-based · SIC 5961 · Commercial discovery, not part of the verdict" (rules 16). */
  caption: string;
}

export interface AreaCard extends AreaDisplay {
  /** The headline figure; "—" when it is missing, with `valueNote` "Not available". */
  value: string;
  valueNote: string | null;
  bullets: string[];
  tip: AreaTip;
}

export interface RatioTile {
  key: "currentRatio" | "debtToEquity" | "dso" | "dpo" | "altmanZ";
  label: string;
  /** "—" when missing, with `valueNote` "Not available". */
  value: string;
  valueNote: string | null;
  formula: string;
  means: string;
  foot: string;
}

export interface VerdictPage {
  assessmentDate: string;
  periodLabel: string | null;
  state: HealthState;
  /** "Same for both entities · No warning thresholds triggered", or the triggered areas. */
  subtitle: string;
  /** Rules 17.5: the bullets under the state bar; the count varies. */
  summary: string[];
  areas: AreaCard[];
  ratios: RatioTile[];
  liquidity: { liquidity: number | null; debt: number | null; netDebt: number | null; netDebtYearAgo: number | null; notes: string[] };
  coreThread: SellerPanel;
  nexCore: SellerPanel & { discovery: Discovery | null };
  /** The D2 What-stands-out item (rules 14), or null. */
  filingItem: FilingStatusResult["standsOut"];
}

// ------------------------------------------------------------------ formats

export { NOT_AVAILABLE };

/** "$161.4B", "−$11.6B", "$812.0M"; "—" when missing (rules 17.6). */
export function money(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const a = Math.abs(v);
  const sign = v < 0 ? MINUS : "";
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  return `${sign}$${Math.round(a).toLocaleString("en-US")}`;
}

/** "$9.56B": the net-debt figure before rounding to one decimal (mock V24 strip). */
export function moneyUnrounded(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? MINUS : "";
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  return `${sign}$${Math.round(a).toLocaleString("en-US")}`;
}

/** "+19.6%", "−3.1%". */
function signedPct(v: number, digits = 1): string {
  return `${v > 0 ? "+" : v < 0 ? MINUS : ""}${Math.abs(v).toFixed(digits)}%`;
}

/** "+2.3 pts". */
function signedPts(v: number): string {
  return `${v > 0 ? "+" : v < 0 ? MINUS : ""}${Math.abs(v).toFixed(1)} pts`;
}

const multiple = (v: number) => `${v.toFixed(2)}×`;
const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Jul 31, 2026". */
function day(iso: string): string {
  if (!ISO.test(iso)) return iso;
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

// ------------------------------------------------------------------ health

/**
 * "Last 12 months, up 33% on the prior 12 months" -- the mock's wording,
 * the engine's figures; in dollars when the prior value is zero or
 * negative or the signs differ (rules 17.6).
 */
function changeOnPrior(now: number | null, prior: number | null): string | null {
  if (now === null || prior === null) return null;
  if (prior <= 0 || now * prior < 0) return `Last 12 months, from ${money(prior)} the prior 12 months`;
  const pct = ((now - prior) / prior) * 100;
  if (Math.round(pct) === 0) return "Last 12 months, level with the prior 12 months";
  return `Last 12 months, ${pct > 0 ? "up" : "down"} ${Math.abs(pct).toFixed(0)}% on the prior 12 months`;
}

type CardText = { value: string; valueNote: string | null; bullets: string[] };
const missingValue = (bullets: string[]): CardText => ({ value: "—", valueNote: NOT_AVAILABLE, bullets });

function cardText(r: VerdictResult, a: AreaDisplay): CardText {
  const x = r.inputs;
  const v = r.layer1.values;
  switch (a.area) {
    case "cash-generation": {
      const bullets: string[] = [];
      const ch = changeOnPrior(x.ocf12m.now, x.ocf12m.yearAgo);
      if (ch) bullets.push(ch);
      const fcf = x.fcf12m.now;
      if (fcf !== null) bullets.push(fcf < 0 ? `Free cash flow ${money(fcf)}: capital spending above operating cash` : `Free cash flow ${money(fcf)}`);
      if (v.runwayMonths !== null) bullets.push(`Runway ${v.runwayMonths} months`);
      return x.ocf12m.now === null ? missingValue(bullets) : { value: money(x.ocf12m.now), valueNote: null, bullets };
    }
    case "near-term-liquidity": {
      const bullets = ["Cash and marketable securities", ...x.supporting.liquidityNotes.map(capital)];
      bullets.push(x.currentRatio === null ? `Current ratio — ${NOT_AVAILABLE}` : `Current ratio ${x.currentRatio.toFixed(1)}x`);
      return x.supporting.liquidityNow === null ? missingValue(bullets) : { value: money(x.supporting.liquidityNow), valueNote: null, bullets };
    }
    case "operating-performance": {
      const [q0, q1] = x.revenueYoYPct;
      const bullets: string[] = [];
      if (x.operatingMarginChangePts !== null) bullets.push(`Operating margin ${signedPts(x.operatingMarginChangePts)} on the same quarter a year ago`);
      if (q1 !== null) bullets.push(`Sales ${signedPct(q1)} the quarter before`);
      return q0 === null ? missingValue(bullets) : { value: `${signedPct(q0)} sales`, valueNote: null, bullets };
    }
    case "funding-and-leverage": {
      const bullets: string[] = [];
      const year = `${RULES.windows.quartersPerYear * RULES.cash.monthsPerQuarter}-month`;
      if (v.leverageMultiple !== null) {
        bullets.push(`Net debt ÷ ${year} operating cash flow: ${multiple(v.leverageMultiple)} (warning above ${RULES.borrowing.leverageMultiple}×)`);
      } else if (x.ocf12m.now !== null && x.revenue12m !== null && x.revenue12m > 0) {
        bullets.push(`Operating cash flow ${((x.ocf12m.now / x.revenue12m) * 100).toFixed(1).replace("-", MINUS)}% of ${year} sales`);
      }
      if (x.netDebt.yearAgo !== null) bullets.push(`${capital(balanceWords(x.netDebt.yearAgo))} a year ago`);
      return x.netDebt.now === null ? missingValue(bullets) : { value: capital(balanceWords(x.netDebt.now)), valueNote: null, bullets };
    }
    case "filing-status": {
      const f = x.filing;
      const bullets: string[] = [];
      if (f.measurable) {
        const period = f.periodEnd && f.periodEnd === x.periodEnd && x.periodLabel ? `${x.periodLabel.split(" ")[0]} ` : "";
        const what = `${period}${f.form ?? "Report"}${period ? "" : f.periodEnd ? ` for ${day(f.periodEnd)}` : ""}`;
        if (f.filedOn) bullets.push(`${what} filed ${day(f.filedOn)}`);
        else if (f.extendedDeadline) bullets.push(`${what} · extended deadline ${day(f.extendedDeadline)}`);
        else if (f.deadline) bullets.push(`${what} · deadline ${day(f.deadline)}`);
      }
      if (a.critical.length) bullets.push(...a.critical);
      else bullets.push("No bankruptcy, debt-acceleration or non-reliance filing in 12 months");
      return { value: r.filingStatus.card.text, valueNote: null, bullets };
    }
  }
}

/** The "What it means" lines of mock V24's Other ratios tips. */
const RATIO_MEANS: Record<RatioTile["key"], string> = {
  currentRatio: "What they’ll turn into cash within a year, compared with what they have to pay within a year",
  debtToEquity: "How much they’ve borrowed for every $1 of their own money",
  dso: "How many days of sales their customers still owe them",
  dpo: "Their unpaid bills in days of cost of sales · Compare with their own past, not with other companies",
  altmanZ: "A standard financial-strength score · Above 2.6 safe, below 1.1 distress",
};

const RATIO_LABEL: Record<RatioTile["key"], string> = {
  currentRatio: "Current ratio",
  debtToEquity: "Debt / equity",
  dso: "DSO",
  dpo: "DPO",
  altmanZ: "Altman Z″",
};

function ratioValue(key: RatioTile["key"], v: number | null): string {
  if (v === null) return "—";
  if (key === "currentRatio") return `${v.toFixed(1)}x`;
  if (key === "dso" || key === "dpo") return `${v.toFixed(1)} days`;
  return v.toFixed(2);
}

// ------------------------------------------------------------------ the model

/** CoreThread's own tests, by plain name (rules 17.6). */
const CORETHREAD_TEST: Record<string, string> = {
  EXPANDING: "engineering spend growth test",
  "R&D CAUTION": "engineering spend cut test",
  CAUTION: "engineering spend caution test",
};

/**
 * The evidence reasons in plain words (rules 17.6). R&D unknown carries the
 * CoreThread R&D tests it makes not measurable, so those read as the one
 * R&D reason; a not-measurable test reads "<test> could not run".
 */
function evidenceShown(r: VerdictResult, which: "coreThread" | "nexCore"): string {
  const s = r[which];
  const rdUnknown = which === "coreThread" && r.coreThread.condition.rdUnknown;
  const out: string[] = [];
  const add = (t: string) => {
    if (!out.includes(t)) out.push(t);
  };
  for (const reason of s.evidence.reasons) {
    if (reason === "R&D unknown") add(rdUnknownWords(r.coreThread.condition.rdUnknownReason));
    else if (rdUnknown && /^not measurable: CoreThread /.test(reason)) continue;
    else if (reason === "not measurable: NexCore CAUTION") add("cutting-back test could not run");
    else if (reason.startsWith("not measurable: CoreThread ")) add(`${CORETHREAD_TEST[reason.slice("not measurable: CoreThread ".length)] ?? "engineering spend test"} could not run`);
    else if (reason.startsWith("not measurable: ")) add(`${TEST_NAME[reason.slice("not measurable: ".length) as FlagName] ?? "a health test"} could not run`);
    else if (reason === "Critical filing 8-K 4.02") add("non-reliance filing (8-K 4.02)");
    else add(reason);
  }
  const assessedOn = s.evidence.staleQualification?.assessedOn;
  if (assessedOn) add(assessedOn);
  return [s.evidence.level, ...out].join(" · ");
}

function seller(r: VerdictResult, which: "coreThread" | "nexCore"): SellerPanel {
  const s = r[which];
  return {
    seller: s.seller,
    verdict: s.verdict,
    why: whyBullets(r, s.seller),
    evidence: {
      level: s.evidence.level,
      reasons: s.evidence.reasons,
      assessedOn: s.evidence.staleQualification?.assessedOn ?? null,
      shown: evidenceShown(r, which),
    },
    terms: s.terms.display,
    protections: s.protections.map((p) => ({ component: p.component, lines: p.lines })),
    condition: s.contractCondition,
  };
}

export function verdictPage(r: VerdictResult): VerdictPage {
  const displays = areaDisplays(r);
  const areas: AreaCard[] = displays.map((a) => ({ ...a, ...cardText(r, a), tip: areaTip(r, a) }));

  const order: RatioTile["key"][] = ["currentRatio", "debtToEquity", "dso", "dpo", "altmanZ"];
  const ratios: RatioTile[] = order.map((key) => {
    const o = r.explanations.otherRatios.find((x) => x.ratio === key)!;
    return {
      key,
      label: RATIO_LABEL[key],
      value: ratioValue(key, o.value),
      valueNote: o.value === null ? NOT_AVAILABLE : null,
      formula: o.formula,
      means: RATIO_MEANS[key],
      foot: o.note,
    };
  });

  const p = r.potentialApplication;
  const discovery: Discovery | null =
    p.shown && p.line && p.route && p.sic !== null && p.source
      ? { line: p.line, route: p.route, routes: ROUTES, sic: p.sic, caption: `Rough guide from the industry code · ${p.source}` }
      : null;

  return {
    assessmentDate: r.assessmentDate,
    periodLabel: r.inputs.periodLabel,
    state: r.layer1.state,
    subtitle: r.layer1.subtitle,
    summary: healthSummaryBullets(r),
    areas,
    ratios,
    liquidity: {
      liquidity: r.inputs.supporting.liquidityNow,
      debt: r.inputs.supporting.totalDebtNow,
      netDebt: r.inputs.netDebt.now,
      netDebtYearAgo: r.inputs.netDebt.yearAgo,
      notes: r.inputs.supporting.liquidityNotes,
    },
    coreThread: seller(r, "coreThread"),
    nexCore: { ...seller(r, "nexCore"), discovery },
    filingItem: r.filingStatus.standsOut,
  };
}
