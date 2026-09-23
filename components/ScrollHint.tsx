"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Horizontal scroll container that says so. The key-financials table has a
 * minWidth wider than a phone, so at narrow widths it scrolls sideways --
 * with no visible cue, the "vs same quarter last year" group and the trend
 * line simply look absent. This adds an edge fade on whichever side still
 * has table beyond it, plus a "scroll" hint below the table that shows only
 * while the right-hand columns are off-screen. Both are decorative and
 * aria-hidden: the table itself is unchanged for screen readers. Nothing
 * renders at desktop widths, where the table fits and there is nothing to
 * hint at.
 */
export function ScrollHint({
  children,
  cue = "scroll for prior year & trend",
}: {
  children: React.ReactNode;
  /** What is off to the right: Key financials' year-ago columns, or a statement's earlier periods. */
  cue?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    // 1px slack: fractional layout widths otherwise leave a permanent fade.
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(max <= 1 || el.scrollLeft >= max - 1);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // The table itself changes width when the Annual toggle switches tables.
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [measure, children]);

  return (
    <div>
      <div style={{ position: "relative" }}>
        <div ref={ref} className="table-scroll">
          {children}
        </div>
        <div className="scroll-fade scroll-fade-left" data-visible={!atStart} aria-hidden="true" />
        <div className="scroll-fade scroll-fade-right" data-visible={!atEnd} aria-hidden="true" />
      </div>
      <div className="scroll-cue" data-visible={!atEnd} aria-hidden="true">
        {cue} &rarr;
      </div>
    </div>
  );
}
