/**
 * Potential application (rules section 9 and 14 D1): NexCore only,
 * commercial discovery, never part of the verdict. Industry-code mapping
 * only; hidden when not established from filed information.
 */
import type { PotentialApplication } from "@/lib/verdict/types";

const RANGES: { from: number; to: number; line: string }[] = [
  { from: 3670, to: 3679, line: "Chip/platform integration" },
  { from: 3400, to: 3999, line: "Devices and equipment" },
  { from: 4000, to: 4799, line: "Retail and logistics operations" },
  { from: 5200, to: 5999, line: "Retail and logistics operations" },
  { from: 4800, to: 4999, line: "Network and energy infrastructure" },
  { from: 100, to: 999, line: "Agriculture operations" },
];

export function potentialApplication(sic: number | null): PotentialApplication {
  // First match: 3670–3679 is read before the wider 3400–3999 range.
  const hit = sic === null ? undefined : RANGES.find((r) => sic >= r.from && sic <= r.to);
  if (!hit || sic === null) return { shown: false, line: null, sic, display: null, source: null };
  return {
    shown: true,
    line: hit.line,
    sic,
    display: `Potential application: ${hit.line}`,
    source: `Industry-based · SIC ${String(sic).padStart(4, "0")} · Commercial discovery, not part of the verdict`,
  };
}
