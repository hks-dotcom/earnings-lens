/**
 * Three-valued logic (rules section 3). Every test is true, false or not
 * measurable (null).
 *
 * - AND: false if any part is false; otherwise not measurable if any part
 *   is not measurable; otherwise true. A clearly false condition wins over
 *   missing data.
 * - OR: true if any part is true; otherwise not measurable if any part is
 *   not measurable; otherwise false.
 * - A comparison against a missing input is not measurable, never passed.
 */
export type T3 = boolean | null;

export function and3(...parts: T3[]): T3 {
  if (parts.some((p) => p === false)) return false;
  if (parts.some((p) => p === null)) return null;
  return true;
}

export function or3(...parts: T3[]): T3 {
  if (parts.some((p) => p === true)) return true;
  if (parts.some((p) => p === null)) return null;
  return false;
}

/** A known boolean as a T3 (for tests that are never missing, e.g. "runway unknown"). */
export const known = (b: boolean): T3 => b;

export const lt = (a: number | null, b: number | null): T3 => (a === null || b === null ? null : a < b);
export const le = (a: number | null, b: number | null): T3 => (a === null || b === null ? null : a <= b);
export const gt = (a: number | null, b: number | null): T3 => (a === null || b === null ? null : a > b);
export const ge = (a: number | null, b: number | null): T3 => (a === null || b === null ? null : a >= b);

/** a × k, missing when a is missing. */
export const times = (a: number | null, k: number): number | null => (a === null ? null : a * k);

/** a − b, missing when either is missing. */
export const minus = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : a - b);
