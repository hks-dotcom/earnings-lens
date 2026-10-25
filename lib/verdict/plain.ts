/**
 * Plain words for the engine's internal names (rules 17.6): what a reader
 * sees instead of a flag name in capitals or an input's technical name.
 * Display only; nothing here is read by a rule.
 */
import { day, money } from "@/lib/verdict/format";
import type { FlagName } from "@/lib/verdict/types";

/** Each Layer 1 test by a plain name, as it reads after "could not run". */
export const TEST_NAME: Record<FlagName, string> = {
  "SEVERE BURN": "severe cash burn test",
  "CAUTION BURN": "cash burn test",
  "PERSISTENT BURN, RUNWAY UNKNOWN": "persistent cash burn test",
  "INVESTMENT CASH PRESSURE": "investment cash test",
  "WEAK LIQUIDITY": "liquidity test",
  "OPERATING DETERIORATION": "sales and margin test",
  LEVERAGE: "leverage test",
  "FUNDING SUBSTITUTION": "borrowing to fund operations test",
  "LOW-CASH DEBT": "low cash with debt test",
  "MISSED FILING": "filing deadline test",
};

/**
 * The explanation inputs a test can lack, by plain label. Computed values
 * (bars, multiples, the increase) are not listed: they are missing only
 * because one of these is.
 */
const INPUT_NAME: Record<string, string> = {
  "12-month operating cash flow": "operating cash flow (last 12 months)",
  "12-month operating cash flow a year ago": "operating cash flow (12 months before)",
  "12-month free cash flow": "free cash flow (last 12 months)",
  "12-month free cash flow a year ago": "free cash flow (12 months before)",
  "12-month revenue": "sales (last 12 months)",
  "Net debt": "net debt",
  "Net debt a year ago": "net debt a year ago",
  Runway: "runway",
  "Current ratio": "current ratio",
  "Current assets": "current assets",
  "Current liabilities": "current liabilities",
  "Revenue Y/Y (latest quarter)": "sales vs the same quarter a year ago",
  "Operating margin change (latest quarter)": "operating margin change vs the same quarter a year ago",
};

/** The base inputs among `names`, in plain words; computed values dropped. */
export function plainInputs(names: string[]): string[] {
  const out: string[] = [];
  for (const n of names) {
    const p = INPUT_NAME[n];
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

const ISO = /\d{4}-\d{2}-\d{2}/g;

/** The filing calendar's reason (rules 11 R1–R2) in plain words. */
export function plainFilingReason(reason: string | null): string {
  if (!reason) return "the filing calendar could not be read";
  const out: string[] = [];
  const fyDates: string[] = [];
  // Reasons are joined with "; ", and the fiscal-year-change reason lists its 8-Ks with "; " too.
  let inFyList = false;
  for (const r of reason.replace(/^not measurable: /, "").split("; ")) {
    if (r.startsWith("8-K text announces a fiscal-year change")) {
      inFyList = true;
      const d = r.match(ISO)?.[0];
      if (d) fyDates.push(d);
      if (!out.includes("FY")) out.push("FY");
      continue;
    }
    if (inFyList && /^\d{4}-\d{2}-\d{2} /.test(r)) {
      fyDates.push(r.slice(0, 10));
      continue;
    }
    inFyList = false;
    let p = "the filing calendar could not be read";
    if (r.startsWith("transition-period form filed")) p = "a transition-period report was filed";
    else if (r.startsWith("10-K period ends")) p = "the last two annual periods are not a year apart";
    else if (r.startsWith("latest 10-K period end")) p = "the latest annual period does not end on the stated fiscal-year end";
    else if (r.startsWith("latest two period ends")) p = "the last two quarters are not a quarter apart";
    else if (r.startsWith("filed-history projection")) p = "the next report can't be projected consistently";
    else if (r === "filer category unknown") p = "the filer category is not known";
    else if (r === "no periodic filing") p = "no 10-Q or 10-K on file";
    else if (r === "latest filed report could not be classified") p = "the latest report could not be placed in the calendar";
    if (!out.includes(p)) out.push(p);
  }
  const fy = `an 8-K announces a fiscal-year change${fyDates.length ? ` (filed ${[...new Set(fyDates)].map(day).join(" · ")})` : ""}`;
  return out.map((p) => (p === "FY" ? fy : p)).join("; ");
}

/** "a", "a and b", "a, b and c". */
export function listWords(parts: string[]): string {
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** Rules 17.6: a balance in words. Negative net debt is net cash; zero is neither. */
export function balanceWords(v: number): string {
  if (v > 0) return `net debt ${money(v)}`;
  if (v < 0) return `net cash ${money(-v)}`;
  return "net debt of zero";
}

/**
 * Rules 17.6: a year's movement in net debt, worded from both balances so
 * it never contradicts them. Both net debt: "net debt up $X"; both net
 * cash: "net cash down $X"; otherwise "moved from <then> to <now>".
 */
export function netMovement(now: number, yearAgo: number): string {
  if (now > 0 && yearAgo > 0) return now === yearAgo ? `net debt unchanged at ${money(now)}` : `net debt ${now > yearAgo ? "up" : "down"} ${money(Math.abs(now - yearAgo))}`;
  if (now < 0 && yearAgo < 0) {
    const cashNow = -now;
    const cashThen = -yearAgo;
    return cashNow === cashThen ? `net cash unchanged at ${money(cashNow)}` : `net cash ${cashNow > cashThen ? "up" : "down"} ${money(Math.abs(cashNow - cashThen))}`;
  }
  return `moved from ${balanceWords(yearAgo)} to ${balanceWords(now)}`;
}
