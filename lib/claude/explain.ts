import Anthropic from "@anthropic-ai/sdk";
import { CompanySubmissions, FilingEntry, resultsEightKForPeriod } from "@/lib/edgar/submissions";
import { FilingPeriod } from "@/lib/xbrl/periods";
import {
  ExplanationTrigger,
  EXPLANATIONS_UNAVAILABLE,
  NOT_EXPLAINED,
} from "@/lib/rules/explanationTriggers";
import {
  assembleBundle,
  periodicDocs,
  SourceBundle,
  SourceDoc,
  wholeFilingDocs,
} from "@/lib/claude/sources";
import { buildUserMessage, OUTPUT_SCHEMA, SYSTEM_PROMPT } from "@/lib/claude/prompt";
import { Citation, DroppedSentence, RawExplanation, verifyExplanation } from "@/lib/claude/verify";
import { claudeDailyCap, claudeDisabledReason, claudeEnabled, claudeModel } from "@/lib/config";
import { readExplanations, reserveClaudeCall, writeExplanation } from "@/lib/db/store";

/**
 * The Claude layer: one explanation per flagged item, from filed text,
 * verified against that text before it reaches the page.
 *
 * The shape of the work is set by the caching rule -- "cache per accession
 * + trigger" -- and by the fact that a filing never changes. Triggers are
 * grouped by the filing that can answer them, each group is one call, and
 * every trigger in the group gets its own stored row. So a second run of
 * the same ticker makes no call at all, and a new trigger on an
 * already-read filing costs one call for that trigger's group rather than
 * re-asking the ones already answered.
 */

export type ExplainedState = "explained" | "not-explained" | "unavailable";

export interface ExplainedItem {
  trigger: ExplanationTrigger;
  state: ExplainedState;
  /** Verified sentences, in order. Empty unless state is "explained". */
  sentences: string[];
  /** The verbatim passages each sentence was checked against. */
  passages: string[];
  citation: Citation | undefined;
  /** Sentences the verifier rejected, with the reason. Diagnostics, not page copy. */
  dropped: DroppedSentence[];
  fromCache: boolean;
  /** Only when state is "unavailable" -- why. Never shown to a reader. */
  unavailableReason?: string;
}

/** The single line a reader sees when the layer could not run. */
export function fallbackText(state: ExplainedState): string {
  return state === "unavailable" ? EXPLANATIONS_UNAVAILABLE : NOT_EXPLAINED;
}

export interface CallDiagnostic {
  anchorAccession: string;
  triggerKeys: string[];
  parts: string[];
  sourceChars: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
}

export interface ExplainDiagnostics {
  enabled: boolean;
  disabledReason?: string;
  dailyCap: number;
  callsToday?: number;
  cacheHits: number;
  calls: CallDiagnostic[];
  /** Bundle composition per group, whether or not a call was made. */
  bundles: { anchorAccession: string; parts: string[]; chars: number }[];
}

export interface ExplainResult {
  items: ExplainedItem[];
  diagnostics: ExplainDiagnostics;
}

interface TriggerGroup {
  anchorAccession: string;
  triggers: ExplanationTrigger[];
  /** Fetches the filed text this group is answered from. */
  loadDocs: () => Promise<SourceDoc[]>;
}

export interface ExplainContext {
  ticker: string;
  cik: string;
  subs: CompanySubmissions;
  latestPeriod: FilingPeriod | undefined;
}

/**
 * Groups triggers by the filing that can answer them.
 *
 * The "financials" group is anchored on the latest 10-Q/10-K and reads the
 * results 8-K with every exhibit plus that filing's management discussion
 * and notes. A red flag is its own group, anchored on the filing behind it,
 * because that filing is where the reason is stated.
 */
function groupTriggers(triggers: ExplanationTrigger[], ctx: ExplainContext): TriggerGroup[] {
  const groups: TriggerGroup[] = [];

  const financial = triggers.filter((t) => t.source.scope === "financials");
  const periodic = ctx.latestPeriod?.filing;
  if (financial.length && periodic) {
    groups.push({
      anchorAccession: periodic.accessionNumber,
      triggers: financial,
      loadDocs: async () => {
        const results8K = resultsEightKForPeriod(ctx.subs, periodic.reportDate);
        const eightK = results8K ? await wholeFilingDocs(ctx.cik, results8K) : [];
        const periodicParts = await periodicDocs(ctx.cik, periodic);

        // Filings a trigger asked to have read alongside the quarter (a
        // restructuring 8-K, today), de-duplicated in case two triggers
        // name the same one.
        const extraAccessions = new Set(
          financial
            .map((t) => (t.source.scope === "financials" ? t.source.alsoRead?.accessionNumber : undefined))
            .filter((a): a is string => Boolean(a))
        );
        const extras: SourceDoc[] = [];
        for (const accession of extraAccessions) {
          const entry = ctx.subs.filings.find((f) => f.accessionNumber === accession);
          if (entry) extras.push(...(await wholeFilingDocs(ctx.cik, entry)));
        }

        return [...eightK, ...extras, ...periodicParts];
      },
    });
  }

  const byFiling = new Map<string, { filing: { accessionNumber: string; form: string; filingDate: string }; triggers: ExplanationTrigger[] }>();
  for (const t of triggers) {
    if (t.source.scope !== "filing") continue;
    const existing = byFiling.get(t.source.accessionNumber);
    if (existing) existing.triggers.push(t);
    else byFiling.set(t.source.accessionNumber, { filing: t.source, triggers: [t] });
  }
  for (const { filing, triggers: ts } of byFiling.values()) {
    const entry = ctx.subs.filings.find((f) => f.accessionNumber === filing.accessionNumber);
    groups.push({
      anchorAccession: filing.accessionNumber,
      triggers: ts,
      loadDocs: async () => (entry ? wholeFilingDocs(ctx.cik, entry as FilingEntry) : []),
    });
  }

  return groups;
}

function unavailable(trigger: ExplanationTrigger, reason: string): ExplainedItem {
  return {
    trigger,
    state: "unavailable",
    sentences: [],
    passages: [],
    citation: undefined,
    dropped: [],
    fromCache: false,
    unavailableReason: reason,
  };
}

function notExplained(trigger: ExplanationTrigger, fromCache: boolean, dropped: DroppedSentence[] = []): ExplainedItem {
  return {
    trigger,
    state: "not-explained",
    sentences: [],
    passages: [],
    citation: undefined,
    dropped,
    fromCache,
  };
}

async function callClaude(
  bundle: SourceBundle,
  triggers: ExplanationTrigger[]
): Promise<{ raws: RawExplanation[]; byId: Map<string, SourceDoc>; inputTokens?: number; outputTokens?: number }> {
  const { text, byId } = buildUserMessage(bundle.docs, triggers);
  const client = new Anthropic();
  const response = await client.messages.create({
    model: claudeModel(),
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: text }],
    output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA as unknown as Record<string, unknown> } },
  });

  if (response.stop_reason === "refusal") {
    throw new Error("the model declined the request");
  }
  const json = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const parsed = JSON.parse(json) as { explanations?: RawExplanation[] };
  return {
    raws: parsed.explanations ?? [],
    byId,
    inputTokens: response.usage?.input_tokens,
    outputTokens: response.usage?.output_tokens,
  };
}

export async function explainFlaggedItems(
  triggers: ExplanationTrigger[],
  ctx: ExplainContext
): Promise<ExplainResult> {
  const diagnostics: ExplainDiagnostics = {
    enabled: claudeEnabled(),
    disabledReason: claudeDisabledReason(),
    dailyCap: claudeDailyCap(),
    cacheHits: 0,
    calls: [],
    bundles: [],
  };

  if (triggers.length === 0) return { items: [], diagnostics };

  // A trigger with no filed text behind it is answered without a call: a
  // missed deadline means nothing was filed, so there is nothing to read.
  const items: ExplainedItem[] = [];
  const answerable: ExplanationTrigger[] = [];
  for (const t of triggers) {
    if (t.source.scope === "none") items.push(notExplained(t, false));
    else answerable.push(t);
  }

  if (!diagnostics.enabled) {
    // Everything answerable reads the fallback. Nothing else changes, and
    // no call is made or counted.
    for (const t of answerable) items.push(unavailable(t, diagnostics.disabledReason ?? "Claude disabled"));
    return { items: orderLike(triggers, items), diagnostics };
  }

  for (const group of groupTriggers(answerable, ctx)) {
    const cached = await readExplanations(group.anchorAccession);
    const missing = group.triggers.filter((t) => !cached.has(t.key));

    for (const t of group.triggers) {
      const hit = cached.get(t.key);
      if (!hit) continue;
      diagnostics.cacheHits++;
      items.push({
        trigger: t,
        state: hit.status,
        sentences: hit.sentences,
        passages: hit.passages,
        citation: hit.citation ?? undefined,
        dropped: hit.dropped,
        fromCache: true,
      });
    }

    if (missing.length === 0) continue;

    const reservation = await reserveClaudeCall(diagnostics.dailyCap);
    diagnostics.callsToday = reservation.callsToday;
    if (!reservation.allowed) {
      for (const t of missing) items.push(unavailable(t, "daily Claude call cap reached"));
      continue;
    }

    let bundle: SourceBundle;
    try {
      bundle = assembleBundle(await group.loadDocs());
    } catch (err) {
      const reason = err instanceof Error ? err.message : "source fetch failed";
      for (const t of missing) items.push(unavailable(t, reason));
      continue;
    }
    diagnostics.bundles.push({
      anchorAccession: group.anchorAccession,
      parts: bundle.parts,
      chars: bundle.totalChars,
    });

    if (bundle.docs.length === 0) {
      // The filing exists but no readable text came back. Nothing was
      // read, so nothing is claimed -- and the answer is cached, because
      // a filing with no readable text will never have any.
      for (const t of missing) {
        items.push(notExplained(t, false));
        await writeExplanation({
          accessionNumber: group.anchorAccession,
          triggerKey: t.key,
          status: "not-explained",
          sentences: [],
          passages: [],
          citation: null,
          dropped: [],
          ticker: ctx.ticker,
          model: claudeModel(),
          sourceChars: 0,
          inputTokens: undefined,
          outputTokens: undefined,
        });
      }
      continue;
    }

    const diag: CallDiagnostic = {
      anchorAccession: group.anchorAccession,
      triggerKeys: missing.map((t) => t.key),
      parts: bundle.parts,
      sourceChars: bundle.totalChars,
    };
    diagnostics.calls.push(diag);

    let result: Awaited<ReturnType<typeof callClaude>>;
    try {
      result = await callClaude(bundle, missing);
    } catch (err) {
      diag.error = err instanceof Error ? err.message : "call failed";
      for (const t of missing) items.push(unavailable(t, diag.error));
      continue;
    }
    diag.inputTokens = result.inputTokens;
    diag.outputTokens = result.outputTokens;

    for (const t of missing) {
      const raw = result.raws.find((r) => r.trigger_key === t.key);
      if (!raw || raw.not_explained === true) {
        items.push(notExplained(t, false));
        await writeExplanation({
          accessionNumber: group.anchorAccession,
          triggerKey: t.key,
          status: "not-explained",
          sentences: [],
          passages: [],
          citation: null,
          dropped: [],
          ticker: ctx.ticker,
          model: claudeModel(),
          sourceChars: bundle.totalChars,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        });
        continue;
      }

      const verified = verifyExplanation({ raw, doc: result.byId.get(raw.source_id) });
      const status = verified.sentences.length > 0 ? "explained" : "not-explained";
      items.push({
        trigger: t,
        state: status,
        sentences: verified.sentences,
        passages: verified.passages,
        citation: verified.citation,
        dropped: verified.dropped,
        fromCache: false,
      });
      await writeExplanation({
        accessionNumber: group.anchorAccession,
        triggerKey: t.key,
        status,
        sentences: verified.sentences,
        passages: verified.passages,
        citation: verified.citation ?? null,
        dropped: verified.dropped,
        ticker: ctx.ticker,
        model: claudeModel(),
        sourceChars: bundle.totalChars,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });
    }
  }

  // A trigger that reached no group at all (e.g. a financial trigger with
  // no periodic filing) still has to appear, with the fallback.
  for (const t of answerable) {
    if (!items.some((i) => i.trigger.key === t.key)) {
      items.push(unavailable(t, "no filed text available for this item"));
    }
  }

  return { items: orderLike(triggers, items), diagnostics };
}

/** Keeps the page order the rules chose, not the order the groups ran in. */
function orderLike(triggers: ExplanationTrigger[], items: ExplainedItem[]): ExplainedItem[] {
  return triggers
    .map((t) => items.find((i) => i.trigger.key === t.key))
    .filter((i): i is ExplainedItem => i !== undefined);
}
