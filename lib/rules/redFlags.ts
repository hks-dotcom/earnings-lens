import { CompanySubmissions, FilingEntry } from "@/lib/edgar/submissions";
import { addDays, nextFilingDue } from "@/lib/metrics/deadlines";
import { FilingPeriod } from "@/lib/xbrl/periods";

export type RedFlagType =
  | "late-filing-12b25"
  | "8-K-1.03" // bankruptcy
  | "8-K-2.04" // debt called early
  | "8-K-4.01" // change of auditor
  | "8-K-4.02" // non-reliance / restatement
  | "missed-deadline";
// 8-K Item 2.05 (restructuring) is deliberately NOT a red-flag type: red
// flags question whether they can pay; a restructuring means spending is
// under review, which is the retrenchment signal instead (detected by
// lib/rules/restructuring.ts, scored in lib/rules/signals.ts). It never
// forces "escalate before signing" on its own.

export interface RedFlagFinding {
  type: RedFlagType;
  /** Form, date, and what followed -- e.g. "NT 10-Q filed 18 May 2026; 10-Q filed 19 May 2026." */
  detail: string;
  date: string;
}

export interface RedFlagsResult {
  findings: RedFlagFinding[];
  windowStart: string;
  windowEnd: string;
  /**
   * A going-concern warning is one of the spec's enumerated red-flag types.
   * Per spec it is detected only from a tagged disclosure in the filing's
   * own XBRL instance, never from scanning filed prose -- and that
   * detection isn't built yet. Never guessed as true or false; the
   * red-flags tile must say "not checked" everywhere this is shown,
   * never presented as clear. See lib/rules/README notes on the tag
   * investigation (no dedicated going-concern tag found in practice).
   */
  goingConcernChecked: false;
}

const EIGHT_K_ITEM_LABELS: Record<string, RedFlagType> = {
  "1.03": "8-K-1.03",
  "2.04": "8-K-2.04",
  "4.01": "8-K-4.01",
  "4.02": "8-K-4.02",
};

const EIGHT_K_ITEM_DESCRIPTIONS: Record<string, string> = {
  "1.03": "bankruptcy",
  "2.04": "debt called early",
  "4.01": "change of auditor",
  "4.02": "non-reliance on previously issued financials / restatement",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-05-18" -> "18 May 2026", matching the spec's own example format. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function isNT(form: string): boolean {
  return form === "NT 10-Q" || form === "NT 10-K";
}

/** The next periodic (10-Q/10-K) filing after a given date, if any -- "what followed" an NT. */
function nextPeriodicAfter(filings: FilingEntry[], afterDate: string): FilingEntry | undefined {
  return filings
    .filter((f) => (f.form === "10-Q" || f.form === "10-K") && f.filingDate > afterDate)
    .sort((a, b) => (a.filingDate < b.filingDate ? -1 : 1))[0];
}

/**
 * Red-flag filings in the trailing 12 months from today (not from the
 * reporting period) -- a live "has anything gone wrong recently" check, so
 * results can and do change over time for the same quarter. Structurally
 * detectable types only: late-filing notices, the four named 8-K items
 * (1.03, 2.04, 4.01, 4.02 -- NOT 2.05, which feeds retrenchment only), and
 * a missed filing deadline (with the 12b-25 grace period applied when an
 * NT was actually filed). Going-concern is explicitly left unchecked.
 */
export function computeRedFlags(
  subs: CompanySubmissions,
  latestPeriod: FilingPeriod | undefined,
  annualPeriodEndsForFloatDetection: string[],
  now: Date = new Date()
): RedFlagsResult {
  const windowStart = new Date(now);
  windowStart.setUTCDate(windowStart.getUTCDate() - 365);
  const windowStartIso = windowStart.toISOString().slice(0, 10);
  const nowIso = now.toISOString().slice(0, 10);

  const findings: RedFlagFinding[] = [];

  for (const filing of subs.filings) {
    if (filing.filingDate < windowStartIso || filing.filingDate > nowIso) continue;

    if (isNT(filing.form)) {
      const expectedForm = filing.form === "NT 10-Q" ? "10-Q" : "10-K";
      const followedBy = nextPeriodicAfter(subs.filings, filing.filingDate);
      const followedText = followedBy
        ? `${followedBy.form} filed ${formatDate(followedBy.filingDate)}`
        : `no ${expectedForm} filed since`;
      findings.push({
        type: "late-filing-12b25",
        detail: `${filing.form} filed ${formatDate(filing.filingDate)}; ${followedText}.`,
        date: filing.filingDate,
      });
      continue;
    }

    if (filing.form === "8-K" && filing.items) {
      for (const item of filing.items.split(",").map((s) => s.trim())) {
        const type = EIGHT_K_ITEM_LABELS[item];
        if (type) {
          findings.push({
            type,
            detail: `8-K Item ${item} (${EIGHT_K_ITEM_DESCRIPTIONS[item]}) filed ${formatDate(filing.filingDate)}.`,
            date: filing.filingDate,
          });
        }
      }
    }
  }

  // Missed deadline: project the due date from the latest filing found. If
  // an NT was filed for the report that's now due (i.e. after the latest
  // filing's own filing date), grant the 12b-25 extension -- 5 calendar
  // days for a 10-Q, 15 for a 10-K -- before deciding it's actually missed.
  //
  // An unplaced period is not a date to project from. If the filing could
  // not be located in a fiscal calendar, the next due date is a guess, and
  // a guessed due date that has "passed" is exactly how a company that
  // filed on time gets accused of missing a deadline. No period, no check.
  const due = latestPeriod?.placed
    ? nextFilingDue(latestPeriod, subs.category, annualPeriodEndsForFloatDetection)
    : undefined;
  if (due) {
    const expectedNTForm = due.form === "10-K" ? "NT 10-K" : "NT 10-Q";
    const pendingNT = subs.filings.find(
      (f) => f.form === expectedNTForm && f.filingDate > latestPeriod!.filing.filingDate
    );
    const extensionDays = pendingNT ? (due.form === "10-K" ? 15 : 5) : 0;
    const effectiveDueDate = extensionDays > 0 ? addDays(due.dueDate, extensionDays) : due.dueDate;

    if (effectiveDueDate < nowIso) {
      const extensionNote = pendingNT
        ? ` (extended ${extensionDays} days by ${pendingNT.form} filed ${formatDate(pendingNT.filingDate)})`
        : "";
      findings.push({
        type: "missed-deadline",
        detail: `Next ${due.form} was due by ${formatDate(due.dueDate)}${extensionNote}, effectively ${formatDate(effectiveDueDate)}, and has not been filed as of ${formatDate(nowIso)}.`,
        date: effectiveDueDate,
      });
    }
  }

  return { findings, windowStart: windowStartIso, windowEnd: nowIso, goingConcernChecked: false };
}
