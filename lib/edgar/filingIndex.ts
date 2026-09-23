import { edgarFetch, edgarFetchJson } from "@/lib/edgar/http";

/**
 * The XBRL documents inside one filing, found through the filing's own
 * index rather than guessed from the primary document's name.
 *
 * Most filers publish the linkbases as separate files next to the schema
 * (`_pre.xml`, `_cal.xml`, `_lab.xml`). Some embed all of them inside the
 * `.xsd` instead -- Microsoft does, and FedEx's older filings did -- so a
 * missing linkbase file is not an error: the schema is read for linkbases
 * too, and whichever documents exist are parsed together.
 */
export interface FilingFiles {
  /** The non-inline instance EDGAR derives from an inline filing ("…_htm.xml"), or a plain instance. */
  instance?: string;
  schema?: string;
  presentation?: string;
  calculation?: string;
  label?: string;
}

interface IndexJson {
  directory: { item: { name: string; size?: string | number }[] };
}

export function filingDocumentUrl(cik: string, accessionNumber: string, name: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionNumber.replace(/-/g, "")}/${name}`;
}

export async function getFilingFiles(cik: string, accessionNumber: string): Promise<FilingFiles> {
  const index = await edgarFetchJson<IndexJson>(filingDocumentUrl(cik, accessionNumber, "index.json"));
  const names = index.directory.item.map((i) => i.name);
  const find = (re: RegExp) => names.find((n) => re.test(n));
  return {
    instance:
      find(/_htm\.xml$/i) ??
      names.find(
        (n) =>
          /\.xml$/i.test(n) &&
          !/_(pre|cal|lab|def)\.xml$/i.test(n) &&
          !/^FilingSummary\.xml$/i.test(n) &&
          !/^R\d+\.xml$/i.test(n)
      ),
    schema: find(/\.xsd$/i),
    presentation: find(/_pre\.xml$/i),
    calculation: find(/_cal\.xml$/i),
    label: find(/_lab\.xml$/i),
  };
}

/**
 * One document's text. Not cached in memory: an instance can run to 10MB
 * and is read once per filing, after which only the extracted result is
 * kept (in the store).
 */
export async function getFilingDocument(cik: string, accessionNumber: string, name: string): Promise<string> {
  const res = await edgarFetch(filingDocumentUrl(cik, accessionNumber, name));
  return res.text();
}
