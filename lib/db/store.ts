import { tryStore, storeConfigured } from "@/lib/db/neon";
import { Citation, DroppedSentence } from "@/lib/claude/verify";
import { SegmentRevenue } from "@/lib/xbrl/segments";
import { EXPLANATION_CACHE_VERSION } from "@/lib/claude/prompt";
import { FilingStatementExtract, STATEMENT_EXTRACT_VERSION } from "@/lib/xbrl/statementExtract";

/**
 * Every read and write of the persistent store, in one place.
 *
 * Two rules hold throughout:
 *
 * - A filing never changes, so anything keyed on an accession number is
 *   written once and read forever. Nothing here has a TTL.
 * - The store is optional. Every function degrades to "no cache" if
 *   DATABASE_URL is unset or the query fails, because the page is complete
 *   without Claude and must be complete without a database too.
 */

export interface StoredExplanation {
  accessionNumber: string;
  triggerKey: string;
  status: "explained" | "not-explained";
  sentences: string[];
  passages: string[];
  citation: Citation | null;
  dropped: DroppedSentence[];
}

export { storeConfigured };

/**
 * Stored trigger keys carry the explanation cache version: "dpo-rising@v2".
 * A prompt change bumps the version, and rows written under an older one
 * are simply never read again, so every explanation is regenerated under
 * the current instructions rather than old and new answers sitting side by
 * side on the page. Old rows stay in the table as a record; nothing
 * deletes them.
 */
const VERSION_SUFFIX = `@v${EXPLANATION_CACHE_VERSION}`;

function storedKey(triggerKey: string): string {
  return `${triggerKey}${VERSION_SUFFIX}`;
}

/** The trigger key of a row written under the current version, or undefined for an older row. */
function currentKey(stored: string): string | undefined {
  return stored.endsWith(VERSION_SUFFIX) ? stored.slice(0, -VERSION_SUFFIX.length) : undefined;
}

/** Cached explanations for one accession, by trigger key. */
export async function readExplanations(
  accessionNumber: string
): Promise<Map<string, StoredExplanation>> {
  const rows = await tryStore(
    "readExplanations",
    (sql) =>
      sql`SELECT accession_number, trigger_key, status, sentences, passages, citation, dropped
          FROM claude_explanations
          WHERE accession_number = ${accessionNumber}` as Promise<Record<string, unknown>[]>,
    [] as Record<string, unknown>[]
  );
  const out = new Map<string, StoredExplanation>();
  for (const r of rows) {
    const key = currentKey(String(r.trigger_key));
    if (key === undefined) continue;
    out.set(key, {
      accessionNumber: String(r.accession_number),
      triggerKey: key,
      status: r.status as StoredExplanation["status"],
      sentences: (r.sentences as string[]) ?? [],
      passages: (r.passages as string[]) ?? [],
      citation: (r.citation as Citation | null) ?? null,
      dropped: (r.dropped as DroppedSentence[]) ?? [],
    });
  }
  return out;
}

export interface WriteExplanation extends StoredExplanation {
  ticker: string;
  model: string;
  sourceChars: number;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
}

export async function writeExplanation(e: WriteExplanation): Promise<void> {
  await tryStore(
    "writeExplanation",
    (sql) =>
      sql`INSERT INTO claude_explanations
            (accession_number, trigger_key, ticker, status, sentences, passages, citation,
             dropped, model, source_chars, input_tokens, output_tokens)
          VALUES (${e.accessionNumber}, ${storedKey(e.triggerKey)}, ${e.ticker}, ${e.status},
                  ${JSON.stringify(e.sentences)}::jsonb, ${JSON.stringify(e.passages)}::jsonb,
                  ${e.citation ? JSON.stringify(e.citation) : null}::jsonb,
                  ${JSON.stringify(e.dropped)}::jsonb, ${e.model}, ${e.sourceChars},
                  ${e.inputTokens ?? null}, ${e.outputTokens ?? null})
          ON CONFLICT (accession_number, trigger_key) DO UPDATE SET
            status = EXCLUDED.status,
            sentences = EXCLUDED.sentences,
            passages = EXCLUDED.passages,
            citation = EXCLUDED.citation,
            dropped = EXCLUDED.dropped,
            model = EXCLUDED.model,
            source_chars = EXCLUDED.source_chars,
            input_tokens = EXCLUDED.input_tokens,
            output_tokens = EXCLUDED.output_tokens`,
    undefined
  );
}

/**
 * Takes one call off today's budget, atomically, and reports whether there
 * was one to take.
 *
 * The increment happens BEFORE the call, in a single statement whose
 * conditional update is the cap: if today's count already equals the cap,
 * no row comes back and no call is made. Counting afterwards would let a
 * burst of concurrent requests all read the same under-cap number and all
 * proceed. Counting an attempt that then fails is the intended tradeoff --
 * a failing call that still costs budget cannot become a retry loop.
 *
 * With no store configured the answer is "no budget": an uncapped Claude
 * spend is a worse failure than no explanations.
 */
export async function reserveClaudeCall(
  dailyCap: number
): Promise<{ allowed: boolean; callsToday: number | undefined }> {
  if (!storeConfigured()) return { allowed: false, callsToday: undefined };
  const rows = await tryStore(
    "reserveClaudeCall",
    (sql) =>
      sql`INSERT INTO claude_daily_calls (call_date, calls)
          VALUES (CURRENT_DATE, 1)
          ON CONFLICT (call_date) DO UPDATE
            SET calls = claude_daily_calls.calls + 1, updated_at = now()
            WHERE claude_daily_calls.calls < ${dailyCap}
          RETURNING calls` as unknown as Promise<{ calls: number }[]>,
    [] as { calls: number }[]
  );
  if (rows.length === 0) return { allowed: false, callsToday: dailyCap };
  return { allowed: true, callsToday: rows[0].calls };
}

export async function claudeCallsToday(): Promise<number | undefined> {
  const rows = await tryStore(
    "claudeCallsToday",
    (sql) =>
      sql`SELECT calls FROM claude_daily_calls WHERE call_date = CURRENT_DATE` as unknown as Promise<
        { calls: number }[]
      >,
    [] as { calls: number }[]
  );
  return rows.length ? Number(rows[0].calls) : storeConfigured() ? 0 : undefined;
}

/**
 * Segment revenue extracted from one filing. Keyed on the accession number
 * of the filing whose instance document it came from, and kept forever --
 * "Store the extracted result, never the raw instance XML."
 */
export async function readSegments(accessionNumber: string): Promise<SegmentRevenue | undefined> {
  const rows = await tryStore(
    "readSegments",
    (sql) =>
      sql`SELECT axis, period_kind, segments FROM filing_segments
          WHERE accession_number = ${accessionNumber}` as Promise<Record<string, unknown>[]>,
    [] as Record<string, unknown>[]
  );
  if (!rows.length) return undefined;
  const r = rows[0];
  return {
    axis: (r.axis as SegmentRevenue["axis"]) ?? null,
    periodKind: (r.period_kind as SegmentRevenue["periodKind"]) ?? null,
    values: (r.segments as SegmentRevenue["values"]) ?? [],
  };
}

export async function writeSegments(
  accessionNumber: string,
  cik: string,
  ticker: string,
  segments: SegmentRevenue
): Promise<void> {
  await tryStore(
    "writeSegments",
    (sql) =>
      sql`INSERT INTO filing_segments (accession_number, cik, ticker, axis, period_kind, segments)
          VALUES (${accessionNumber}, ${cik}, ${ticker}, ${segments.axis}, ${segments.periodKind},
                  ${JSON.stringify(segments.values)}::jsonb)
          ON CONFLICT (accession_number) DO UPDATE SET
            axis = EXCLUDED.axis,
            period_kind = EXCLUDED.period_kind,
            segments = EXCLUDED.segments,
            extracted_at = now()`,
    undefined
  );
}

/**
 * Every stored explanation, for the independent audit.
 *
 * The audit re-fetches each cited filing and re-runs the verifier over
 * what is stored, so it checks the rows a reader would actually be shown
 * rather than what the verifier decided in the moment. It reads by ticker
 * because that is how a filing is located again (submissions -> accession).
 */
export interface AuditRow extends StoredExplanation {
  ticker: string;
  model: string;
}

export async function readAllExplanations(): Promise<AuditRow[]> {
  const rows = await tryStore(
    "readAllExplanations",
    (sql) =>
      sql`SELECT accession_number, trigger_key, ticker, status, sentences, passages, citation, dropped, model
          FROM claude_explanations
          ORDER BY ticker, trigger_key` as Promise<Record<string, unknown>[]>,
    [] as Record<string, unknown>[]
  );
  return rows
    .filter((r) => currentKey(String(r.trigger_key)) !== undefined)
    .map((r) => ({
      accessionNumber: String(r.accession_number),
      triggerKey: currentKey(String(r.trigger_key))!,
      ticker: String(r.ticker),
      model: String(r.model),
      status: r.status as StoredExplanation["status"],
      sentences: (r.sentences as string[]) ?? [],
      passages: (r.passages as string[]) ?? [],
      citation: (r.citation as StoredExplanation["citation"]) ?? null,
      dropped: (r.dropped as StoredExplanation["dropped"]) ?? [],
    }));
}

/**
 * One filing's extracted statements, if stored under the current extractor
 * version. An older version reads as absent, so the filing is extracted
 * again and the row replaced.
 */
export async function readFilingStatement(accessionNumber: string): Promise<FilingStatementExtract | undefined> {
  const rows = await tryStore(
    "readFilingStatement",
    (sql) =>
      sql`SELECT statement FROM filing_statements
          WHERE accession_number = ${accessionNumber} AND extract_version = ${STATEMENT_EXTRACT_VERSION}` as unknown as Promise<
        { statement: FilingStatementExtract }[]
      >,
    [] as { statement: FilingStatementExtract }[]
  );
  return rows[0]?.statement;
}

export async function writeFilingStatement(extract: FilingStatementExtract, cik: string, ticker: string): Promise<void> {
  await tryStore(
    "writeFilingStatement",
    (sql) =>
      sql`INSERT INTO filing_statements (accession_number, cik, ticker, extract_version, statement, instance_bytes)
          VALUES (${extract.accessionNumber}, ${cik}, ${ticker}, ${extract.version},
                  ${JSON.stringify(extract)}::jsonb, ${extract.instanceBytes})
          ON CONFLICT (accession_number) DO UPDATE SET
            extract_version = EXCLUDED.extract_version,
            statement = EXCLUDED.statement,
            instance_bytes = EXCLUDED.instance_bytes,
            extracted_at = now()`,
    undefined
  );
}

/** Row counts per table, for the build report. */
export async function storeCounts(): Promise<Record<string, number> | undefined> {
  if (!storeConfigured()) return undefined;
  const rows = await tryStore(
    "storeCounts",
    (sql) =>
      sql`SELECT
            (SELECT count(*) FROM claude_explanations) AS explanations,
            (SELECT count(*) FROM claude_daily_calls) AS daily_call_days,
            (SELECT coalesce(sum(calls), 0) FROM claude_daily_calls) AS total_calls,
            (SELECT count(*) FROM filing_segments) AS filing_segments` as Promise<
        Record<string, unknown>[]
      >,
    [] as Record<string, unknown>[]
  );
  if (!rows.length) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(rows[0])) out[k] = Number(v);
  return out;
}
