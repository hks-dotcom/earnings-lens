import { edgarCache, TTL } from "@/lib/cache";
import { edgarFetchJson } from "@/lib/edgar/http";

export interface FactPoint {
  /** Present for duration (flow) facts; absent for instant (point-in-time) facts. */
  start?: string;
  end: string;
  val: number;
  accn: string;
  fy: number;
  fp: string; // "Q1" | "Q2" | "Q3" | "FY"
  form: string;
  filed: string;
}

interface RawConcept {
  units: Record<string, FactPoint[]>;
}

interface RawCompanyFacts {
  cik: number;
  entityName: string;
  facts: Record<string, Record<string, RawConcept>>;
}

export interface CompanyFacts {
  cik: string;
  entityName: string;
  raw: RawCompanyFacts;
}

const cikPadded = (cik: string) => cik.padStart(10, "0");

export async function getCompanyFacts(cik: string): Promise<CompanyFacts> {
  const padded = cikPadded(cik);
  return edgarCache.getOrFetch(`companyfacts:${padded}`, TTL.companyFacts, async () => {
    const raw = await edgarFetchJson<RawCompanyFacts>(
      `https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`
    );
    return { cik: padded, entityName: raw.entityName, raw };
  });
}

/** Returns the raw fact points for exactly one concept name, or undefined if the filer never used it. */
export function getConceptPoints(
  facts: CompanyFacts,
  conceptName: string,
  taxonomy: string = "us-gaap",
  unit: string = "USD"
): FactPoint[] | undefined {
  const points = facts.raw.facts[taxonomy]?.[conceptName]?.units[unit];
  return points && points.length > 0 ? points : undefined;
}

/**
 * Returns the fact points for the first concept in `conceptNames` that
 * exists at all in the given taxonomy (default us-gaap). Only use this when
 * "has any data ever" is a good enough test -- e.g. a one-off lookup. For
 * building a quarter-by-quarter series, prefer choosing the candidate that
 * actually covers the target periods (see xbrl/keyFinancials.ts), since a
 * filer can carry stale, long-unused tags with old data under an earlier
 * name that would otherwise shadow the tag currently in use.
 */
export function pickConcept(
  facts: CompanyFacts,
  conceptNames: string[],
  taxonomy: string = "us-gaap",
  unit: string = "USD"
): { concept: string; points: FactPoint[] } | undefined {
  for (const name of conceptNames) {
    const points = getConceptPoints(facts, name, taxonomy, unit);
    if (points) return { concept: name, points };
  }
  return undefined;
}
