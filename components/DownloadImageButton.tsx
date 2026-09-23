"use client";

import { useState, RefObject } from "react";
import { lensImageFilename } from "@/lib/present/imageFilename";

/**
 * "Download image": the whole lens board as a PNG, deterministic, with no
 * server and no Claude call.
 *
 * The point of the picture is that the period, the source line and the
 * declared values travel with the verdict -- a screenshot of just the
 * quadrant is the thing this is meant to stop. So it captures the board
 * element from header through footer, not a crop.
 *
 * Rendering happens in the browser via html-to-image, which serialises the
 * DOM into an SVG foreignObject and paints it to a canvas. That needs the
 * page's own webfonts inlined as data URIs, which it does by fetching
 * them; next/font self-hosts them on this origin, so the fetch is
 * same-origin and the canvas never gets tainted.
 */
export function DownloadImageButton({
  boardRef,
  ticker,
  lens,
  fiscalQuarterLabel,
  color,
}: {
  boardRef: RefObject<HTMLDivElement | null>;
  ticker: string;
  lens: string;
  fiscalQuarterLabel: string;
  color: string;
}) {
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");

  async function handleDownload() {
    const node = boardRef.current;
    if (!node) return;
    setState("working");
    // "Tooltips are closed in the image." They open on :hover and on a
    // click-toggled data-open; the pointer is over the button, not a tip,
    // but a tip left open by an earlier tap would otherwise be baked in.
    const opened = Array.from(node.querySelectorAll<HTMLElement>('.tip[data-open="true"]'));
    for (const tip of opened) tip.dataset.open = "false";
    node.dataset.capturing = "true";
    try {
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(node, {
        // The board is white; without this the PNG has a transparent
        // background, which reads as black in most image viewers.
        backgroundColor: "#FFFFFF",
        pixelRatio: 2,
        cacheBust: true,
      });
      const link = document.createElement("a");
      link.download = lensImageFilename(ticker, lens, fiscalQuarterLabel);
      link.href = dataUrl;
      link.click();
      setState("idle");
    } catch {
      // Never leave the page in a half-captured state on a failure.
      setState("failed");
      setTimeout(() => setState("idle"), 3000);
    } finally {
      delete node.dataset.capturing;
      for (const tip of opened) tip.dataset.open = "true";
    }
  }

  return (
    <button
      onClick={handleDownload}
      disabled={state === "working"}
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
        cursor: state === "working" ? "progress" : "pointer",
      }}
    >
      {state === "working" ? "Rendering…" : state === "failed" ? "Couldn't render" : "Download image"}
    </button>
  );
}
