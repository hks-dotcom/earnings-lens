import { CompanySubmissions } from "@/lib/edgar/submissions";

export interface RestructuringFinding {
  filingDate: string;
  accessionNumber: string;
}

/**
 * Every 8-K Item 2.05 (restructuring) in the trailing 12 months from `now`,
 * newest first.
 * Deliberately separate from lib/rules/redFlags.ts: per spec, a
 * restructuring filing is not a red flag (it doesn't question whether they
 * can pay) -- it feeds the retrenchment signal only. Same trailing-365-day
 * window convention as red flags.
 */
export function findRestructuringFilings(
  subs: CompanySubmissions,
  now: Date = new Date()
): RestructuringFinding[] {
  const windowStart = new Date(now);
  windowStart.setUTCDate(windowStart.getUTCDate() - 365);
  const windowStartIso = windowStart.toISOString().slice(0, 10);
  const nowIso = now.toISOString().slice(0, 10);

  return subs.filings
    .filter(
      (f) =>
        f.form === "8-K" &&
        f.filingDate >= windowStartIso &&
        f.filingDate <= nowIso &&
        f.items
          .split(",")
          .map((s) => s.trim())
          .includes("2.05")
    )
    .sort((a, b) => (a.filingDate < b.filingDate ? 1 : a.filingDate > b.filingDate ? -1 : 0))
    .map((f) => ({ filingDate: f.filingDate, accessionNumber: f.accessionNumber }));
}
