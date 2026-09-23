import { Lens } from "@/lib/rules/dealStructure";

/**
 * The display names of the two lenses. The one place they are defined.
 *
 * CoreThread and NexCore are fictional companies: a services firm that
 * bills monthly in arrears, and a SaaS vendor that bills annually in
 * advance. They exist to show that the same counterparty produces a
 * different deal depending on who is selling and how they bill.
 *
 * These are labels only. Everything underneath -- the Lens type, rule
 * outputs, rules-snapshot keys and values -- keeps the neutral identifiers
 * "Services" and "SaaS", so renaming a lens is a change to this file and
 * nothing else: no rule, figure or stored snapshot moves.
 */
export const LENS_NAME: Record<Lens, string> = {
  Services: "CoreThread",
  SaaS: "NexCore",
};

/** The lens toggle's label: the kind of seller, then who it is. "Services · CoreThread". */
export function lensToggleLabel(lens: Lens): string {
  return `${lens} · ${LENS_NAME[lens]}`;
}
