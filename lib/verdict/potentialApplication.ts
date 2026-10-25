/**
 * Potential application (rules section 9 and 14 D1): NexCore only,
 * commercial discovery, never part of the verdict. Industry-code mapping
 * only; hidden when not established from filed information. The likely
 * route is a rough guide from the same industry code: GTM information only.
 */
import type { LikelyRoute, PotentialApplication } from "@/lib/verdict/types";

/** The route bar's three steps, in display order (rules section 9). */
export const ROUTES: LikelyRoute[] = ["Partner", "Device builder", "Site operator"];

const RANGES: { from: number; to: number; line: string; route: LikelyRoute }[] = [
  { from: 3670, to: 3679, line: "Chip/platform integration", route: "Partner" },
  { from: 3400, to: 3999, line: "Devices and equipment", route: "Device builder" },
  { from: 4000, to: 4799, line: "Retail and logistics operations", route: "Site operator" },
  { from: 5200, to: 5999, line: "Retail and logistics operations", route: "Site operator" },
  { from: 4800, to: 4999, line: "Network and energy infrastructure", route: "Site operator" },
  { from: 100, to: 999, line: "Agriculture operations", route: "Site operator" },
];

export function potentialApplication(sic: number | null): PotentialApplication {
  // First match: 3670–3679 is read before the wider 3400–3999 range.
  const hit = sic === null ? undefined : RANGES.find((r) => sic >= r.from && sic <= r.to);
  if (!hit || sic === null) return { shown: false, line: null, route: null, sic, display: null, source: null };
  return {
    shown: true,
    line: hit.line,
    route: hit.route,
    sic,
    display: `Potential application: ${hit.line}`,
    source: `Industry-based · SIC ${String(sic).padStart(4, "0")} · Commercial discovery, not part of the verdict`,
  };
}
