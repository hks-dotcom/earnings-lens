/**
 * H historical reads (rules 11 H): an as-of read uses only filings on or
 * before the vantage date. Applied to submissions and company facts before
 * anything else reads them.
 */
import type { CompanyFacts, FactPoint } from "@/lib/edgar/companyFacts";
import type { CompanySubmissions } from "@/lib/edgar/submissions";

export function submissionsAsOf(s: CompanySubmissions, date: string): CompanySubmissions {
  return { ...s, filings: s.filings.filter((f) => f.filingDate <= date) };
}

export function factsAsOf(f: CompanyFacts, date: string): CompanyFacts {
  const facts: CompanyFacts["raw"]["facts"] = {};
  for (const [tax, concepts] of Object.entries(f.raw.facts)) {
    const keptConcepts: typeof concepts = {};
    for (const [name, c] of Object.entries(concepts)) {
      const units: Record<string, FactPoint[]> = {};
      for (const [u, pts] of Object.entries(c.units)) {
        const kept = pts.filter((p) => p.filed <= date);
        if (kept.length) units[u] = kept;
      }
      if (Object.keys(units).length) keptConcepts[name] = { ...c, units };
    }
    facts[tax] = keptConcepts;
  }
  return { cik: f.cik, entityName: f.entityName, raw: { ...f.raw, facts } };
}
