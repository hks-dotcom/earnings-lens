/**
 * Filing status (rules section 14 D2 and 11 R2).
 *
 * classifyRequiredReport places the most recent required periodic report
 * in one of the five D2 cases, using only what was known on the
 * assessment date: a report filed after that date is treated as not
 * filed, so a later filing never clears an earlier MISSED FILING.
 *
 * filingStatus turns the classified case into the MISSED FILING flag, the
 * Filing status card, the What-stands-out item and the evidence effect.
 */
import type { FilingCase, FilingObservation, FilingStatusResult } from "@/lib/verdict/types";
import type { T3 } from "@/lib/verdict/logic";

export interface RequiredReportFacts {
  form: "10-Q" | "10-K";
  periodEnd: string;
  /** The original deadline, already rolled forward to a business day. */
  deadline: string;
  /** The 12b-25 extended deadline, when a valid 12b-25 was filed for this report. */
  extendedDeadline: string | null;
  /** Filing date of the report, if any (may be after the assessment date). */
  filedOn: string | null;
}

/**
 * The D2 case for one required report as of `assessmentDate`, or null
 * when the report is not yet required (its deadline has not passed and it
 * has not been filed).
 */
export function classifyRequiredReport(r: RequiredReportFacts, assessmentDate: string): FilingObservation | null {
  const filedOn = r.filedOn !== null && r.filedOn <= assessmentDate ? r.filedOn : null;
  let kind: FilingCase;
  if (filedOn !== null) {
    if (filedOn <= r.deadline) kind = "on-time";
    else if (r.extendedDeadline !== null && filedOn <= r.extendedDeadline) kind = "filed-within-extension";
    else kind = "filed-late";
  } else {
    if (assessmentDate <= r.deadline) return null;
    if (r.extendedDeadline !== null && assessmentDate <= r.extendedDeadline) kind = "extension-open";
    else kind = "overdue";
  }
  return {
    measurable: true,
    case: kind,
    form: r.form,
    periodEnd: r.periodEnd,
    deadline: r.deadline,
    extendedDeadline: r.extendedDeadline,
    filedOn,
  };
}

const CARD: Record<FilingCase, { text: FilingStatusResult["card"]["text"]; severity: "Warning" | "Clear" }> = {
  overdue: { text: "Overdue", severity: "Warning" },
  "filed-within-extension": { text: "Filed within extension", severity: "Clear" },
  "extension-open": { text: "Extension open", severity: "Clear" },
  "filed-late": { text: "Filed late · received", severity: "Clear" },
  "on-time": { text: "On time", severity: "Clear" },
};

export function filingStatus(obs: FilingObservation): FilingStatusResult {
  if (!obs.measurable) {
    return {
      measurable: false,
      case: null,
      missedFiling: null,
      card: { text: "Not measurable", severity: null },
      standsOut: null,
      evidenceEffect: "unchanged",
      reason: obs.reason,
    };
  }
  const missed: T3 = obs.case === "overdue";
  const card = CARD[obs.case];
  let standsOut: FilingStatusResult["standsOut"] = null;
  switch (obs.case) {
    case "overdue":
      standsOut = { kind: "Overdue filing", form: obs.form, period: obs.periodEnd, deadline: obs.extendedDeadline ?? obs.deadline };
      break;
    case "filed-within-extension":
      standsOut = { kind: "Informational", form: obs.form, period: obs.periodEnd, extendedDeadline: obs.extendedDeadline, filingDate: obs.filedOn };
      break;
    case "extension-open":
      standsOut = { kind: "Informational", form: obs.form, period: obs.periodEnd, extendedDeadline: obs.extendedDeadline };
      break;
    case "filed-late":
      // The applicable deadline: the extended one when a valid 12b-25 was filed, else the original.
      standsOut = { kind: "Filed late", form: obs.form, period: obs.periodEnd, extendedDeadline: obs.extendedDeadline ?? obs.deadline, filingDate: obs.filedOn };
      break;
    case "on-time":
      standsOut = null;
      break;
  }
  return {
    measurable: true,
    case: obs.case,
    missedFiling: missed,
    card: { text: card.text, severity: card.severity },
    standsOut,
    evidenceEffect: missed ? "Exception (missed filing)" : "unchanged",
    reason: null,
  };
}
