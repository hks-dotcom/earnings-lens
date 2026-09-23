"use client";

import { useState } from "react";

/**
 * The "i" control next to every Financial health label. Opens on hover
 * (CSS), on tap (click toggles open state, for touch devices where :hover
 * doesn't behave like a real open/close), and on keyboard focus (CSS
 * :focus-visible) -- all three per spec.
 *
 * Formula first, then the explanation: the formula is the part a reader
 * can check against the table, and the Z'' one is long enough that it
 * sets the box width (see .tipbox, which is wide enough for it and capped
 * at 80% of the screen).
 */
export function Tooltip({
  label,
  formula,
  explanation,
  align = "left",
}: {
  label: string;
  formula: string;
  explanation: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className={`tip${align === "right" ? " tip-right" : ""}`}
      tabIndex={0}
      role="button"
      aria-label={`What is ${label}?`}
      data-open={open ? "true" : "false"}
      onClick={() => setOpen((o) => !o)}
      onBlur={() => setOpen(false)}
    >
      i
      <span className="tipbox" role="tooltip">
        <span className="tipbox-formula">
          <span className="tipbox-term">Formula.</span> {formula}
        </span>
        <span className="tipbox-explanation">{explanation}</span>
      </span>
    </span>
  );
}
