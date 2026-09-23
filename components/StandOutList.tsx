"use client";

import { useEffect, useRef, useState } from "react";
import { StandOutItem, StandOutTone } from "@/lib/present/standOut";
import type { ExplainedItem } from "@/lib/claude/explain";
import {
  citationDetail,
  citationLabel,
  explanationFor,
  FindingExplanation,
} from "@/lib/present/findingExplanations";

/**
 * "What stands out": one row per item, each with a tag, a bold headline, a
 * plain sentence, the figures on a muted line, and the rule that made it
 * fire.
 *
 * The coloured bar down the left is the item's tone -- amber for a watch
 * item, green for good news, blue for terms, slate for a one-off item --
 * and it is the only thing that distinguishes them, so the tag text says
 * the same thing in words for a reader who can't rely on the colour.
 *
 * Where the filing explains an item, Claude's sentence closes the item's
 * own text, followed by a small citation; hover, focus or tap opens the
 * filing date, section, accession and the passages it was checked
 * against. Where it doesn't, the item ends at its rule-based sentence.
 */
const TONE_COLOR: Record<StandOutTone, string> = {
  watch: "var(--watch-strong)",
  good: "var(--core-strong)",
  terms: "var(--nova-strong)",
  info: "var(--info-strong)",
};

function TermPill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        marginRight: 5,
        borderRadius: 6,
        fontWeight: 600,
        fontSize: 12.5,
        background: ok ? "var(--core-tint-bg)" : "var(--bad-tint-bg)",
        color: ok ? "var(--core-strong)" : "var(--bad-text)",
      }}
    >
      {label} {ok ? "✓" : "✕"}
    </span>
  );
}

/**
 * The citation after an explanation. Opens on hover and keyboard focus
 * (CSS) and on tap (click toggles), like the "i" tips. The box is placed
 * under the line across the finding's own width, so on a phone it can
 * never run past the board's edge.
 *
 * A tap anywhere outside closes it. Blur alone can't: Safari does not
 * focus a button it clicks, so a blur handler never fires there and the
 * box would stay open over the findings below.
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
        onBlur={() => setOpen(false)}
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

function Explained({ explanation }: { explanation: FindingExplanation | undefined }) {
  if (!explanation) return null;
  return (
    <>
      {" "}
      {explanation.sentences.join(" ")}
      <Cite explanation={explanation} />
    </>
  );
}

export function StandOutList({ items, explained }: { items: StandOutItem[]; explained: ExplainedItem[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text-tertiary)" }}>
        WHAT STANDS OUT
      </div>
      <p style={{ margin: "0 0 4px", fontSize: 12, lineHeight: 1.6, color: "var(--text-tertiary)" }}>
        Where a finding says why, the reason comes from the filing: Claude explains from filed text only, and every
        quoted passage and figure is checked against the filing before it is shown.
      </p>
      <div style={{ display: "flex", flexDirection: "column", borderTop: "1px solid var(--border-subtle)" }}>
        {items.map((item, i) => (
          <div
            key={`${item.kind}-${i}`}
            className="stand-item"
            style={{ borderLeft: `3px solid ${TONE_COLOR[item.tone]}` }}
          >
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", color: TONE_COLOR[item.tone] }}>
              {item.tag}
            </span>
            <div className="stand-text">
              {item.terms && (
                <span>
                  {item.terms.map((t) => (
                    <TermPill key={t.label} label={t.label} ok={t.ok} />
                  ))}{" "}
                </span>
              )}
              <b style={{ fontWeight: 600 }}>{item.headline}</b> {item.sentence}
              <Explained explanation={explanationFor(item.explainKey, explained)} />
              {item.more?.map((m) => (
                <span key={m.explainKey}>
                  {" "}
                  {m.sentence}
                  <Explained explanation={explanationFor(m.explainKey, explained)} />
                </span>
              ))}
              {item.figures && <span className="stand-figures">{item.figures}</span>}
              <span className="stand-rule">
                <b>Rule:</b> {item.rule}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
