import { FilingEntry } from "@/lib/edgar/submissions";
import { KeyFinancials } from "@/lib/xbrl/keyFinancials";
import { FilingStatementExtract } from "@/lib/xbrl/statementExtract";
import { LiquidityDebt, LiquidityPeriod, readBalanceSheetPeriod, unavailablePeriod } from "@/lib/present/liquidityDebt";

/**
 * Which filing each of the strip's two periods is read from: the
 * latest-filed filing whose balance sheet presents that date -- the same
 * latest-presentation rule the income statement uses.
 *
 * A balance sheet presents its own period end and the prior fiscal year
 * end, so a date can only be presented by the filing for that period, or,
 * when the date is a fiscal year end, by the filings of the year after it.
 * Those are the candidates, newest filed first; each is confirmed against
 * the dates its extracted balance sheet actually carries.
 */
export function candidateFilings(date: string, kf: KeyFinancials): FilingEntry[] {
  const filings = kf.lookbackPeriods.map((p) => p.filing);
  const yearEnd = filings.some((f) => f.form.startsWith("10-K") && f.reportDate === date);
  const yearAfter = shiftYear(date, 1);
  return filings
    .filter((f) => f.reportDate === date || (yearEnd && f.reportDate > date && f.reportDate <= yearAfter))
    .sort((a, b) => (a.filingDate === b.filingDate ? b.accessionNumber.localeCompare(a.accessionNumber) : b.filingDate.localeCompare(a.filingDate)));
}

/** One year on, plus a week for a 52/53-week fiscal year. */
function shiftYear(date: string, years: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

export async function loadLiquidityDebt(
  kf: KeyFinancials,
  load: (filing: FilingEntry) => Promise<FilingStatementExtract>
): Promise<LiquidityDebt> {
  const revenue = kf.revenue.values[0]?.value;
  const period = async (i: number): Promise<LiquidityPeriod> => {
    const q = kf.quarters[i];
    if (!q) return unavailablePeriod("", "", "no quarter a year earlier in the filings read", revenue);
    let failed = false;
    for (const filing of candidateFilings(q.periodEnd, kf)) {
      let extract: FilingStatementExtract;
      try {
        extract = await load(filing);
      } catch {
        failed = true;
        continue;
      }
      if (extract.balanceSheet?.dates.includes(q.periodEnd)) return readBalanceSheetPeriod(extract, q.periodEnd, q.label, revenue);
    }
    return unavailablePeriod(
      q.label,
      q.periodEnd,
      failed ? "the filing's balance sheet could not be read" : "no filing's balance sheet presents this date",
      revenue
    );
  };
  // The two periods are independent; a filing both need is loaded once by the caller's loader.
  const [latest, yearAgo] = await Promise.all([period(0), period(4)]);
  return { latest, yearAgo };
}
