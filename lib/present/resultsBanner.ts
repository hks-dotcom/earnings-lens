import { FilingEntry } from "@/lib/edgar/submissions";
import { addDays, NextFilingDue } from "@/lib/metrics/deadlines";

/**
 * "New results announced": a results 8-K (Item 2.02) for a quarter newer
 * than the one on screen.
 *
 * Item 2.02 carries more than results releases. FedEx filed one the day
 * after its FY26 10-K to announce a fiscal-year change, with recast
 * history attached: filed after the 10-K, but about no newer quarter. A
 * release can't come before the quarter it reports ends, so an 8-K counts
 * only when it is filed after the latest 10-Q or 10-K AND after the end of
 * the next period: nextFilingDue's estimated period end, or about 12 weeks
 * after the shown period's end when that isn't known.
 */
export const NEXT_PERIOD_FALLBACK_DAYS = 84;

export interface NewResultsAnnounced {
  date: string;
  accessionNumber: string;
  /** The form the full figures arrive in: the next periodic filing's. Undefined when it can't be projected. */
  form: "10-Q" | "10-K" | undefined;
}

export function newResultsAnnounced(
  resultsEightKs: FilingEntry[],
  latestFiled: FilingEntry | undefined,
  dueBy: NextFilingDue | undefined
): NewResultsAnnounced | undefined {
  const nextPeriodEnd = dueBy?.estimatedPeriodEnd ?? (latestFiled ? addDays(latestFiled.reportDate, NEXT_PERIOD_FALLBACK_DAYS) : undefined);
  const release = resultsEightKs.find(
    (k) =>
      (!latestFiled || k.filingDate > latestFiled.filingDate) && (nextPeriodEnd === undefined || k.filingDate > nextPeriodEnd)
  );
  return release ? { date: release.filingDate, accessionNumber: release.accessionNumber, form: dueBy?.form } : undefined;
}
