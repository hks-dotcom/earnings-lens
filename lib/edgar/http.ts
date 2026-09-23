import { edgarContactEmail } from "@/lib/config";

// SEC's fair-access rules require a descriptive User-Agent with a contact
// email on every request, and ask that callers stay under 10 requests/sec.
// This module is the single choke point all EDGAR calls go through so both
// rules are enforced in one place.

const MAX_REQUESTS_PER_SECOND = 8; // stay safely under SEC's 10/sec limit
const MIN_INTERVAL_MS = 1000 / MAX_REQUESTS_PER_SECOND;

let lastRequestAt = 0;
let queue: Promise<void> = Promise.resolve();

function throttle(): Promise<void> {
  const run = queue.then(async () => {
    const now = Date.now();
    const wait = Math.max(0, lastRequestAt + MIN_INTERVAL_MS - now);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
  });
  // Chain so concurrent callers still serialize through the throttle.
  queue = run.catch(() => {});
  return run;
}

function userAgent(): string {
  // SEC asks for "Sample Company Name AdminContact@sample.com" style UAs.
  return `EarningsLens/1.0 (${edgarContactEmail()})`;
}

export class EdgarHttpError extends Error {
  constructor(
    public status: number,
    public url: string
  ) {
    super(`EDGAR request failed: ${status} ${url}`);
  }
}

// Every EDGAR call -- submissions, companyfacts, ticker map, and the raw
// XBRL instance documents used for segment data -- goes through this one
// function, so this counter reflects true total request volume regardless
// of which module made the call.
let requestCount = 0;

export function edgarRequestCount(): number {
  return requestCount;
}

export function resetEdgarRequestCount(): void {
  requestCount = 0;
}

export async function edgarFetch(url: string): Promise<Response> {
  await throttle();
  requestCount++;
  const res = await fetch(url, {
    headers: {
      "User-Agent": userAgent(),
      Accept: "application/json, text/html;q=0.9, */*;q=0.8",
    },
  });
  if (!res.ok) {
    throw new EdgarHttpError(res.status, url);
  }
  return res;
}

export async function edgarFetchJson<T>(url: string): Promise<T> {
  const res = await edgarFetch(url);
  return (await res.json()) as T;
}
