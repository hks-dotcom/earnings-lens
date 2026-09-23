"use client";

import { useState, RefObject } from "react";
import { LensResult } from "@/lib/rules/evaluateLens";
import { PageData } from "@/lib/present/buildPageData";
import { buildCopyBrief } from "@/lib/present/copyBrief";
import { DownloadImageButton } from "@/components/DownloadImageButton";
import { LENS_NAME } from "@/lib/present/lensNames";

/**
 * The two board buttons, at the foot of the lens board.
 *
 * They act on the whole board -- "Copy brief" writes out every part of it
 * as text, "Download image" captures header through footer -- so they sit
 * after it. Both are deterministic and make no server or Claude call.
 */
export function BoardActions({
  page,
  lens,
  boardRef,
}: {
  page: PageData;
  lens: LensResult;
  boardRef: RefObject<HTMLDivElement | null>;
}) {
  const [copied, setCopied] = useState(false);
  const color = lens.lens === "Services" ? "#1F6F5C" : "#3B4BA8";

  async function handleCopy() {
    const text = buildCopyBrief(page, lens);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) -- fail quietly, no crash.
    }
  }

  return (
    <div
      className="board-actions"
      style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", paddingTop: 10, borderTop: "1px solid var(--border-subtle)" }}
    >
      <button
        onClick={handleCopy}
        style={{
          height: 40,
          padding: "0 16px",
          border: `1px solid ${color}`,
          borderRadius: 8,
          background: "#FFFFFF",
          color,
          fontFamily: "inherit",
          fontSize: 14,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {copied ? "Copied!" : "Copy brief"}
      </button>
      <DownloadImageButton
        boardRef={boardRef}
        ticker={page.ticker}
        lens={LENS_NAME[lens.lens]}
        fiscalQuarterLabel={page.header.fiscalQuarterLabel}
        color={color}
      />
      <span style={{ fontSize: 12, color: "var(--text-tertiary)", flex: "1 1 220px", minWidth: 200 }}>
        Paste-ready text, or the whole board as a picture with the period, source, rules and notes on it.
      </span>
    </div>
  );
}
