"use client";

import { useEffect, useRef, useState } from "react";

export interface TipSection {
  heading: string;
  bullets: string[];
}

/**
 * The ⓘ on a health card or a ratio (mock V24, rules 16): bullets under
 * short headings, an optional muted footer line. Non-modal: the page stays
 * usable while it is open, and any click or tap outside it closes it, as
 * does Escape. Opening one closes any other (each listens for the press
 * that opened the next).
 */
export function InfoTip({
  label,
  sections,
  foot,
  side = "left",
  top = 40,
}: {
  label: string;
  sections: TipSection[];
  foot?: string;
  /** Which edge of the card the box lines up with. */
  side?: "left" | "right";
  top?: number;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <span ref={wrapRef} className="itip-wrap">
      <button
        type="button"
        className="itip"
        aria-label={`How ${label} is calculated`}
        aria-expanded={open}
        data-open={open ? "true" : "false"}
        onClick={() => setOpen((o) => !o)}
      >
        i
      </button>
      {open && (
        <span className={`itip-box itip-${side}`} role="dialog" aria-label={label} style={{ top }}>
          {sections
            .filter((s) => s.bullets.length > 0)
            .map((s) => (
              <span key={s.heading} className="itip-sec">
                <strong>{s.heading}</strong>
                <ul>
                  {s.bullets.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </span>
            ))}
          {foot && <span className="itip-foot">{foot}</span>}
        </span>
      )}
    </span>
  );
}
