import { edgarCache, TTL } from "@/lib/cache";
import { edgarFetch } from "@/lib/edgar/http";

// Dimensional (segment-by-axis) facts are stripped out of the aggregated
// companyfacts/companyconcept JSON APIs -- they only expose the default,
// non-dimensional context for each concept. Getting segment revenue means
// reading the filing's own XBRL instance document directly. For an inline
// XBRL filing (all 10-Q/10-K filings since ~2019), EDGAR publishes this as
// a plain (non-inline) derivative instance at "<primary-doc>_htm.xml" next
// to the primary document -- e.g. nvda-20260726.htm -> nvda-20260726_htm.xml.

export interface XbrlContext {
  /** axis QName (e.g. "us-gaap:StatementBusinessSegmentsAxis") -> member QName. */
  members: Record<string, string>;
  start?: string; // duration facts only
  end: string;
}

export interface XbrlFact {
  concept: string; // e.g. "us-gaap:Revenues"
  contextRef: string;
  value: number;
}

export interface FilingInstance {
  contexts: Map<string, XbrlContext>;
  facts: XbrlFact[];
  /** Size of the fetched instance document, in bytes (UTF-8). */
  byteSize: number;
}

function instanceUrl(cik: string, accessionNumber: string, primaryDocument: string): string {
  const cikNum = String(Number(cik));
  const accnNoDash = accessionNumber.replace(/-/g, "");
  const instanceDoc = primaryDocument.replace(/\.htm$/i, "_htm.xml");
  return `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accnNoDash}/${instanceDoc}`;
}

function parseContexts(xml: string): Map<string, XbrlContext> {
  const contexts = new Map<string, XbrlContext>();
  const contextRe = /<context id="([^"]+)">([\s\S]*?)<\/context>/g;
  let m: RegExpExecArray | null;
  while ((m = contextRe.exec(xml))) {
    const [, id, body] = m;
    const members: Record<string, string> = {};
    const memberRe = /dimension="([^"]+)">\s*([^<\s][^<]*?)\s*</g;
    let mm: RegExpExecArray | null;
    while ((mm = memberRe.exec(body))) {
      members[mm[1]] = mm[2].trim();
    }
    const durationMatch = body.match(/<startDate>([^<]+)<\/startDate>\s*<endDate>([^<]+)<\/endDate>/);
    const instantMatch = body.match(/<instant>([^<]+)<\/instant>/);
    if (durationMatch) {
      contexts.set(id, { members, start: durationMatch[1], end: durationMatch[2] });
    } else if (instantMatch) {
      contexts.set(id, { members, end: instantMatch[1] });
    }
  }
  return contexts;
}

function parseFacts(xml: string): XbrlFact[] {
  const facts: XbrlFact[] = [];
  // Tag name and its contextRef attribute can be separated by newlines/other
  // attributes in EDGAR's generated instance documents, so match loosely.
  const factRe = /<([a-zA-Z][\w.-]*:[\w.-]+)\s+contextRef="([^"]+)"[^>]*>([^<]*)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = factRe.exec(xml))) {
    const [, concept, contextRef, rawVal] = m;
    const trimmed = rawVal.trim();
    if (trimmed === "" || Number.isNaN(Number(trimmed))) continue;
    facts.push({ concept, contextRef, value: Number(trimmed) });
  }
  return facts;
}

export async function getFilingInstance(
  cik: string,
  accessionNumber: string,
  primaryDocument: string
): Promise<FilingInstance> {
  const key = `instance:${cik}:${accessionNumber}`;
  return edgarCache.getOrFetch(key, TTL.companyFacts, async () => {
    const url = instanceUrl(cik, accessionNumber, primaryDocument);
    const res = await edgarFetch(url);
    const xml = await res.text();
    return {
      contexts: parseContexts(xml),
      facts: parseFacts(xml),
      byteSize: new TextEncoder().encode(xml).length,
    };
  });
}
