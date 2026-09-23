// Simple in-memory, per-process TTL cache. Good enough for a personal-scale
// tool: it survives for the lifetime of a warm serverless instance / the
// local dev server, and resets on cold start or redeploy. That's an
// explicit, documented tradeoff (see README) rather than an oversight —
// swapping in Vercel KV later is a one-file change if persistence across
// cold starts becomes necessary.

interface Entry<T> {
  value: T;
  expiresAt: number;
}

class TTLCache {
  private store = new Map<string, Entry<unknown>>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  async getOrFetch<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;
    const value = await fetcher();
    this.set(key, value, ttlMs);
    return value;
  }

  delete(key: string): void {
    this.store.delete(key);
  }
}

// Separate caches per concern so they can be reasoned about (and sized)
// independently.
export const edgarCache = new TTLCache();
export const claudeReadoutCache = new TTLCache();

export const TTL = {
  tickerMap: 24 * 60 * 60 * 1000, // ticker -> CIK list changes rarely
  submissions: 60 * 60 * 1000, // filing list: refresh hourly
  companyFacts: 60 * 60 * 1000, // XBRL facts: refresh hourly
  fullTextSearch: 6 * 60 * 60 * 1000,
  // A filed document never changes, so this TTL exists only to bound the
  // memory a warm instance holds, not to pick up edits.
  filingDocument: 7 * 24 * 60 * 60 * 1000,
};
