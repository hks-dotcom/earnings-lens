"use client";

import { useEffect, useRef, useState } from "react";
import type { ExplainedItem } from "@/lib/claude/explain";
import { EXPLANATIONS_UNAVAILABLE, NOT_EXPLAINED } from "@/lib/rules/explanationTriggers";
import { StandOutItem } from "@/lib/present/standOut";
import { citationDetail, citationLabel, explanationFor, FindingExplanation, findingShownText } from "@/lib/present/findingExplanations";

/**
 * The citation after an explanation: form and section; tap or focus opens
 * the filing date, section, accession and the passages the sentences were
 * checked against. Any press outside closes it.
 */
function Cite({ explanation }: { explanation: FindingExplanation }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const c = explanation.citation;
  if (!c) return null;
  return (
    <span className="cite-wrap" ref={wrapRef} data-open={open ? "true" : "false"}>
      <button
        type="button"
        className="cite"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        {citationLabel(c)}
      </button>
      <span className="cite-box" role="tooltip">
        <span style={{ display: "block" }}>{citationDetail(c)}</span>
        {explanation.passages.length > 0 && (
          <>
            <span className="cite-box-term">Passages relied on</span>
            {explanation.passages.map((p, i) => (
              <span key={i} className="cite-box-quote">
                &ldquo;{p}&rdquo;
              </span>
            ))}
          </>
        )}
      </span>
    </span>
  );
}

/**
 * Explained from the filings (rules 17.3), directly below What stands out:
 * for each flagged item, the filing's own explanation, checked verbatim
 * against the cited text, with its source. AI-assisted interpretation of
 * filed text; it never feeds the verdict, the health state, the terms or
 * evidence. Triggers, sources, the quote check, caching and the fallback
 * lines are the Claude layer's (lib/claude/explain.ts fallbackText), unchanged.
 */
export function ExplainedFromFilings({ explained, findings }: { explained: ExplainedItem[]; findings: StandOutItem[] }) {
  const findingFor = (key: string) =>
    findings.find((f) => f.explainKey === key || f.alsoExplainKeys?.includes(key) || f.more?.some((m) => m.explainKey === key));
  // Only items whose finding is on the page: a retired finding (the old missed-deadline red flag) has nothing to close.
  const items = explained.filter((e) => findingFor(e.trigger.key));
  if (items.length === 0) return null;
  const allUnavailable = items.every((e) => e.state === "unavailable");
  return (
    <section className="v5-section" style={{ gap: 10 }}>
      <div className="exf-head">
        <span className="v5-k">EXPLAINED FROM THE FILINGS</span>
        <span className="so-note">AI-assisted interpretation of filed text · never feeds the verdict, the health state, the terms or evidence</span>
      </div>
      {allUnavailable ? (
        <div className="so-none">{EXPLANATIONS_UNAVAILABLE}</div>
      ) : (
        items.map((e) => {
          const finding = findingFor(e.trigger.key)!;
          const shown = findingShownText(finding);
          const ex = explanationFor(e.trigger.key, explained, shown);
          return (
            <div key={e.trigger.key} className="so-row">
              <span className="so-tag" style={{ color: "var(--info-strong)" }}>
                {finding.tag}
              </span>
              <div className="so-text">
                <strong>{finding.headline.replace(/\.$/, "")}</strong>
                <ul className="exf-list">
                  {ex ? (
                    <li>
                      {ex.sentences.join(" ")} <Cite explanation={ex} />
                    </li>
                  ) : (
                    <li>{e.state === "unavailable" ? EXPLANATIONS_UNAVAILABLE : NOT_EXPLAINED}</li>
                  )}
                </ul>
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}
