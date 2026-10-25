"use client";

import { RefObject, useState } from "react";
import { PageData } from "@/lib/present/buildPageData";
import { buildCopyBrief } from "@/lib/present/copyBrief";
import { VERDICT_STEPS } from "@/lib/present/verdictPage";
import type { Seller } from "@/lib/verdict/types";
import { DownloadImageButton } from "@/components/DownloadImageButton";
import { StepBar, TONE } from "@/components/StepBar";

export const SELLER_COLOR: Record<Seller, string> = { CoreThread: "#1f6f5c", NexCore: "#3b4ba8" };

const upperFirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * "What this means for <seller>" (mock V24, rules 16): evidence top right;
 * the verdict word beside the four-step verdict bar; for NexCore, when the
 * industry code maps, the discovery band with the potential application
 * and the likely route; the three Why bullets beside the Terms; then Copy
 * brief and Download image. Everything here is the engine's result.
 */
export function VerdictCard({ page, seller, boardRef }: { page: PageData; seller: Seller; boardRef: RefObject<HTMLDivElement | null> }) {
  const v = page.verdict;
  const s = seller === "CoreThread" ? v.coreThread : v.nexCore;
  const discovery = seller === "NexCore" ? v.nexCore.discovery : null;
  const color = SELLER_COLOR[seller];
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(buildCopyBrief(page, seller));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (e.g. insecure context): fail quietly.
    }
  }

  return (
    <section className="vcard" data-verdict-card style={{ borderTop: `5px solid ${color}` }}>
      <div className="vcard-top">
        <div className="vcard-kick">
          <span style={{ color }}>WHAT THIS MEANS FOR {seller.toUpperCase()}</span>
          <span className="vcard-evidence">
            Evidence: <strong>{s.evidence.shown}</strong>
          </span>
        </div>
        <div className="vcard-verdict">
          <div className="vcard-word">
            <span className="vcard-word-k">Verdict</span>
            <span className="vword font-serif" style={{ color: TONE[s.verdict][0] }}>
              {s.verdict}
            </span>
          </div>
          <div className="vcard-bar">
            <StepBar steps={VERDICT_STEPS} current={s.verdict} height={12} fontSize={13} ariaLabel={`Verdict: ${s.verdict}, on a scale of ${VERDICT_STEPS.join(", ")}`} />
          </div>
        </div>
      </div>

      {discovery && (
        <div className="vcard-band">
          <div className="vcard-app">
            <span className="vcard-band-k">POTENTIAL APPLICATION</span>
            <span className="vcard-app-v font-serif">{discovery.line}</span>
          </div>
          <div className="vcard-route">
            <span className="vcard-band-k">LIKELY ROUTE</span>
            <StepBar steps={discovery.routes} current={discovery.route} height={8} fontSize={14} gap={4} route />
          </div>
          <div className="vcard-band-cap">{discovery.caption}</div>
        </div>
      )}

      <div className="vcard-body">
        <div className="vcard-cols">
          <div className="vcard-why">
            <div className="vcard-h">WHY</div>
            <ul>
              {s.why.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
          <div className="vcard-terms">
            <div className="vcard-terms-head">
              <span className="vcard-h">TERMS</span>
              <span className="font-mono vcard-net">{s.terms}</span>
            </div>
            {s.protections.map((p) => (
              <div key={p.component} className="vcard-term">
                <span style={{ fontWeight: 600, color }}>{p.component}</span>
                <ul>
                  {p.lines.map((l, i) => (
                    <li key={i}>{upperFirst(l)}</li>
                  ))}
                </ul>
              </div>
            ))}
            {s.condition && (
              <div className="vcard-term">
                <span style={{ fontWeight: 600, color }}>Condition</span>
                <ul>
                  {s.condition
                    .split(/(?<=\.) /)
                    .map((c) => c.replace(/\.$/, ""))
                    .map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                </ul>
              </div>
            )}
          </div>
        </div>
        <div className="vcard-actions">
          <button type="button" className="vbtn" style={{ borderColor: color, color }} onClick={handleCopy}>
            {copied ? "Copied!" : "Copy brief"}
          </button>
          <DownloadImageButton boardRef={boardRef} ticker={page.ticker} lens={seller} fiscalQuarterLabel={page.header.fiscalQuarterLabel} color={color} />
        </div>
      </div>
    </section>
  );
}
