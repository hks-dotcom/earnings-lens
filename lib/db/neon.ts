import { neon, NeonQueryFunction } from "@neondatabase/serverless";

/**
 * The Neon serverless driver, over HTTP.
 *
 * HTTP rather than WebSocket/pg: every query is a single stateless request,
 * which is exactly the shape of a Vercel function's life. It also means the
 * pooled connection string is all that is ever needed -- there are no
 * session-level features in use here (no LISTEN, no prepared statements, no
 * multi-statement transactions), so the unpooled string is not required
 * even to create the schema.
 *
 * The store is optional by design. If DATABASE_URL is unset the app runs
 * with no persistence: EDGAR still works, the rules still decide, and the
 * Claude layer reports itself unavailable rather than crashing a page. A
 * missing database must never take the page down, because the page is
 * complete without Claude.
 */

let cached: NeonQueryFunction<false, false> | null | undefined;

export function db(): NeonQueryFunction<false, false> | null {
  if (cached !== undefined) return cached;
  const url = process.env.DATABASE_URL;
  cached = url ? neon(url) : null;
  return cached;
}

export function storeConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * Runs a store read/write, and returns `fallback` if the store is absent or
 * the query fails.
 *
 * Swallowing the error is deliberate here and nowhere else in the app: a
 * cache is an optimisation, and a cache outage must degrade to "no cache",
 * never to a broken page. The failure is logged so it is visible in the
 * Vercel function log; the message is the driver's own and never contains
 * the connection string.
 */
export async function tryStore<T>(what: string, fn: (sql: NeonQueryFunction<false, false>) => Promise<T>, fallback: T): Promise<T> {
  const sql = db();
  if (!sql) return fallback;
  try {
    return await fn(sql);
  } catch (err) {
    console.error(`store: ${what} failed:`, err instanceof Error ? err.message : err);
    return fallback;
  }
}
