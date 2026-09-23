import { edgarCache, TTL } from "@/lib/cache";
import { edgarFetch } from "@/lib/edgar/http";
import { FilingEntry } from "@/lib/edgar/submissions";
import { htmlToText, periodicSections } from "@/lib/claude/sourceText";

/**
 * The filed text the Claude layer is allowed to read, and nothing else.
 *
 * "Sources: filed text only: the results 8-K (Item 2.02) with all its
 * exhibits, the latest 10-Q/10-K management discussion and notes, NT forms,
 * and any 8-K behind a flag."
 *
 * Nothing in this module reaches outside EDGAR. There is no news, no
 * transcript vendor, no investor-relations site -- "Transcripts that exist
 * only from paid data providers are out: they aren't filed, and their
 * licences usually forbid showing quotes." When a company files its CFO
 * commentary or prepared remarks as an exhibit to the results 8-K, that IS
 * filed text and is read like any other exhibit; that is why every exhibit
 * is fetched rather than just the press release.
 *
 * Everything fetched here is treated as data. It is filed prose written by
 * a third party, it can say anything at all, and it is placed in the prompt
 * inside a delimited block that the system prompt tells the model to treat
 * as quotable source text and never as instructions.
 */

export interface SourceDoc {
  /** Citation form: "8-K", "10-Q", "NT 10-Q". */
  form: string;
  filingDate: string;
  accessionNumber: string;
  /** Which part of the filing: an exhibit type ("EX-99.2") or a section name. */
  part: string;
  /** The filer's own description of the exhibit, when EDGAR carries one. */
  description?: string;
  text: string;
}

export interface SourceBundle {
  docs: SourceDoc[];
  totalChars: number;
  /**
   * One label per document in the bundle, for the report. Each carries its
   * filing's form and date as well as the part, because a bundle can hold
   * two documents with the same part label -- the results 8-K's body and a
   * restructuring 8-K's body are both "8-K body".
   */
  parts: string[];
}

/** Per-document and whole-bundle character budgets. */
export const BUDGET = {
  /** A results 8-K's own body: a page of Item 2.02 boilerplate plus the exhibit index. */
  eightKBody: 20_000,
  /** One exhibit (press release, CFO commentary, prepared remarks). */
  exhibit: 90_000,
  mda: 80_000,
  notes: 120_000,
  /** Whole bundle. Roughly 110k tokens, well inside the context window. */
  bundle: 440_000,
} as const;

interface FilingDocument {
  type: string;
  filename: string;
  description: string;
}

const accnNoDash = (accessionNumber: string) => accessionNumber.replace(/-/g, "");

function filingBaseUrl(cik: string, accessionNumber: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${String(Number(cik))}/${accnNoDash(accessionNumber)}`;
}

/**
 * Document types that are never readable prose: the XBRL taxonomy
 * linkbases, the iXBRL cover-page exhibit, images, and EDGAR's own
 * generated viewer files.
 */
function isReadableDocument(doc: FilingDocument): boolean {
  const type = doc.type.toUpperCase();
  if (type.startsWith("EX-101") || type.startsWith("EX-104")) return false;
  if (["GRAPHIC", "XML", "JSON", "ZIP", "EXCEL", "EX-27"].includes(type)) return false;
  if (!/\.(htm|html|txt)$/i.test(doc.filename)) return false;
  // R1.htm etc. are the XBRL viewer's rendered report pages, not filed text.
  if (/^R\d+\.htm$/i.test(doc.filename)) return false;
  return true;
}

/**
 * The document list for one filing, with each document's EDGAR type.
 *
 * Read from the submission's index-headers page rather than index.json: the
 * JSON directory listing carries no document types, so it cannot tell an
 * exhibit from a stylesheet, and "all its exhibits" needs the types.
 */
export async function filingDocuments(
  cik: string,
  accessionNumber: string
): Promise<FilingDocument[]> {
  const key = `filing-docs:${cik}:${accessionNumber}`;
  return edgarCache.getOrFetch(key, TTL.filingDocument, async () => {
    const url = `${filingBaseUrl(cik, accessionNumber)}/${accessionNumber}-index-headers.html`;
    const res = await edgarFetch(url);
    const html = await res.text();
    const docs: FilingDocument[] = [];
    // The page is the raw SGML header, HTML-escaped inside a <PRE> block.
    const text = html.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    const re = /<DOCUMENT>\s*<TYPE>([^\r\n<]*)[\s\S]*?<FILENAME>([^\r\n<]*)(?:[\s\S]*?<DESCRIPTION>([^\r\n<]*))?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      docs.push({
        type: (m[1] ?? "").trim(),
        filename: (m[2] ?? "").trim(),
        description: (m[3] ?? "").trim(),
      });
    }
    return docs;
  });
}

async function fetchDocumentText(
  cik: string,
  accessionNumber: string,
  filename: string
): Promise<string> {
  const key = `filing-text:${cik}:${accessionNumber}:${filename}`;
  return edgarCache.getOrFetch(key, TTL.filingDocument, async () => {
    const res = await edgarFetch(`${filingBaseUrl(cik, accessionNumber)}/${filename}`);
    return htmlToText(await res.text());
  });
}

function cap(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : text.slice(0, maxChars);
}

/**
 * A whole filing, body plus every readable exhibit. Used for the results
 * 8-K ("with ALL its exhibits") and for an 8-K or NT form behind a flag.
 */
export async function wholeFilingDocs(cik: string, filing: FilingEntry): Promise<SourceDoc[]> {
  let docs: FilingDocument[];
  try {
    docs = await filingDocuments(cik, filing.accessionNumber);
  } catch {
    // Pre-2001 filings are laid out differently and have no index-headers
    // page. No document list means no source, which the caller renders as
    // "Not explained in the filing." -- never as a guess.
    return [];
  }
  const readable = docs.filter(isReadableDocument);
  const out: SourceDoc[] = [];
  for (const doc of readable) {
    const isBody = doc.filename.toLowerCase() === filing.primaryDocument.toLowerCase();
    let text: string;
    try {
      text = await fetchDocumentText(cik, filing.accessionNumber, doc.filename);
    } catch {
      // A single missing exhibit must not lose the rest of the filing.
      continue;
    }
    if (!text.trim()) continue;
    out.push({
      form: filing.form,
      filingDate: filing.filingDate,
      accessionNumber: filing.accessionNumber,
      part: isBody ? `${filing.form} body` : doc.type || doc.filename,
      description: doc.description || undefined,
      text: cap(text, isBody ? BUDGET.eightKBody : BUDGET.exhibit),
    });
  }
  return out;
}

/** The management discussion and the notes out of a 10-Q or 10-K. */
export async function periodicDocs(cik: string, filing: FilingEntry): Promise<SourceDoc[]> {
  let text: string;
  try {
    text = await fetchDocumentText(cik, filing.accessionNumber, filing.primaryDocument);
  } catch {
    return [];
  }
  return periodicSections(text, filing.form, { mda: BUDGET.mda, notes: BUDGET.notes }).map((s) => ({
    form: filing.form,
    filingDate: filing.filingDate,
    accessionNumber: filing.accessionNumber,
    part: s.name,
    text: s.text,
  }));
}

/**
 * Assembles a bundle, dropping whole documents once the budget is spent
 * rather than truncating them further -- a half-sentence at a cut point is
 * a quote the verifier can never confirm.
 */
export function assembleBundle(docs: SourceDoc[]): SourceBundle {
  const kept: SourceDoc[] = [];
  let total = 0;
  for (const doc of docs) {
    if (total + doc.text.length > BUDGET.bundle) continue;
    kept.push(doc);
    total += doc.text.length;
  }
  return {
    docs: kept,
    totalChars: total,
    parts: kept.map((d) => `${d.form} ${d.filingDate} ${d.part}`),
  };
}
