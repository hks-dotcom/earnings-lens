/**
 * JSON has no "undefined" -- `JSON.stringify` drops `undefined` object
 * properties but converts `undefined` ARRAY elements to `null` (arrays
 * must preserve length/position). Every LineItem/health series in this
 * app is `(T | undefined)[]`, so after the API route's `NextResponse.json`
 * round-trip, every MISSING cell arrives on the client as `null`, not
 * `undefined`. Components check `=== undefined` (the correct check
 * server-side), so without this normalization a missing cell silently
 * becomes `null` and crashes the first `.toFixed()`/`.value` access that
 * assumed a present-but-typed value. Applied once, right after `res.json()`,
 * so every component downstream can keep using `=== undefined`.
 */
export function nullsToUndefined<T>(value: T): T {
  if (value === null) return undefined as unknown as T;
  if (Array.isArray(value)) return value.map((v) => nullsToUndefined(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = nullsToUndefined(v);
    }
    return out as T;
  }
  return value;
}
