import { CompanySubmissions } from "@/lib/edgar/submissions";

export interface RestructuringFinding {
  filingDate: string;
  accessionNumber: string;
}

/**
 * 8-K Item 2.05 (restructuring) in the trailing 12 months from `now`.
 * Deliberately separate from lib/rules/redFlags.ts: per spec, a
 * restructuring filing is not a red flag (it doesn't question whether they
 * can pay) -- it feeds the retrenchment signal only. Same trailing-365-day
 * window convention as red flags.
 */
export function findRestructuringFiling(
  subs: CompanySubmissions,
  now: Date = new Date()
): RestructuringFinding | undefined {
  const windowStart = new Date(now);
  windowStart.setUTCDate(windowStart.getUTCDate() - 365);
  const windowStartIso = windowStart.toISOString().slice(0, 10);
  const nowIso = now.toISOString().slice(0, 10);

  const match = subs.filings.find(
    (f) =>
      f.form === "8-K" &&
      f.filingDate >= windowStartIso &&
      f.filingDate <= nowIso &&
      f.items
        .split(",")
        .map((s) => s.trim())
        .includes("2.05")
  );
  return match ? { filingDate: match.filingDate, accessionNumber: match.accessionNumber } : undefined;
}
