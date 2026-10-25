/**
 * Display states for the five health area cards (rules 17.2):
 *
 * - Filing status reads Critical (dot on Critical) when any 8-K Item 1.03,
 *   2.04 or 4.02 is in the 12-month window, labelled as Layer 1 labels it
 *   (a 4.02 is a reporting-reliability problem, not necessarily insolvency).
 * - "Not fully measurable" marks an area with no fired flag and at least
 *   one not-measurable flag: no step selected on its bar, and each test
 *   that could not run and why (the inputs it lacked, or the filing
 *   calendar's own reason).
 *
 * Read off the engine result only; no rule, threshold or verdict changes.
 */
import { FLAG_AREA } from "@/lib/verdict/layer1";
import type { AreaId, FlagName, VerdictResult } from "@/lib/verdict/types";

export type AreaLevel = "Clear" | "Warning" | "Severe" | "Critical";

export const NOT_FULLY_MEASURABLE = "Not fully measurable";

export interface NotMeasuredTest {
  flag: FlagName;
  /** Inputs the test needed that are missing, by their explanation names. */
  missing: string[];
  /** The engine's own reason, when it gives one (filing status). */
  reason: string | null;
}

export interface AreaDisplay {
  area: AreaId;
  title: string;
  scale: string[];
  /** The step the dot sits on; null when none is selected (not fully measurable). */
  level: AreaLevel | null;
  notFullyMeasurable: boolean;
  notMeasured: NotMeasuredTest[];
  /** Filing status only: the Critical filings in the window, labelled. */
  critical: string[];
}

export function areaDisplays(r: VerdictResult): AreaDisplay[] {
  const l1 = r.layer1;
  return r.explanations.areas.map((a) => {
    const fired = l1.fired.some((f) => FLAG_AREA[f] === a.area);
    const notMeasured: NotMeasuredTest[] = a.flags
      .filter((f) => f.value === null)
      .map((f) =>
        f.flag === "MISSED FILING"
          ? { flag: f.flag, missing: [], reason: r.filingStatus.reason }
          : { flag: f.flag, missing: f.inputs.filter((i) => i.value === null).map((i) => i.name), reason: null }
      );
    const notFullyMeasurable = !fired && notMeasured.length > 0;
    const critical = a.area === "filing-status" ? l1.criticalReasons : [];
    const level: AreaLevel | null = critical.length ? "Critical" : notFullyMeasurable ? null : a.level;
    return {
      area: a.area,
      title: a.title,
      scale: a.scale,
      level,
      notFullyMeasurable,
      notMeasured,
      critical,
    };
  });
}
