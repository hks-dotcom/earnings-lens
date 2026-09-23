"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CompanyMatch } from "@/lib/edgar/tickers";

/**
 * "The ticker box accepts a ticker or a company name."
 *
 * A combobox over EDGAR's own ticker list. Typing a known ticker still
 * behaves exactly as it did -- the exact match ranks first and Enter with
 * nothing highlighted submits the raw text -- so the fast path for someone
 * who knows the ticker is unchanged, and the list is there for someone who
 * only knows the name.
 *
 * The ticker remains the only input to the rules; picking a result just
 * fills it in.
 */
export function CompanySearch({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (ticker: string) => void;
}) {
  const [matches, setMatches] = useState<CompanyMatch[]>([]);
  const [open, setOpen] = useState(false);
  const [searched, setSearched] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  // Query the server as the user types. Debounced so a fast typist makes
  // one request, not one per keystroke, and sequenced so a slow early
  // response can't overwrite a newer one.
  useEffect(() => {
    const query = value.trim();
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (!query) {
        setMatches([]);
        setSearched(false);
        return;
      }
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (cancelled) return;
        setMatches(Array.isArray(data.matches) ? data.matches : []);
        setSearched(true);
      } catch {
        if (!cancelled) {
          setMatches([]);
          setSearched(false); // a failed request is not "no company found"
        }
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value]);

  // Close on a click or tap outside -- the touch equivalent of blurring.
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const choose = useCallback(
    (match: CompanyMatch) => {
      onChange(match.ticker);
      setOpen(false);
      setHighlighted(-1);
      onSubmit(match.ticker);
    },
    [onChange, onSubmit]
  );

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      setHighlighted(-1);
      return;
    }
    if (!open || matches.length === 0) {
      if (e.key === "ArrowDown" && matches.length > 0) {
        setOpen(true);
        setHighlighted(0);
        e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => (h + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => (h <= 0 ? matches.length - 1 : h - 1));
    } else if (e.key === "Enter" && highlighted >= 0) {
      // Only intercept Enter when something is actually highlighted;
      // otherwise the form submits the typed text, as before.
      e.preventDefault();
      choose(matches[highlighted]);
    }
  }

  const showList = open && value.trim().length > 0;
  const noMatch = showList && searched && matches.length === 0;

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setOpen(false);
          onSubmit(value);
        }}
        style={{ display: "flex", gap: 8 }}
      >
        <input
          id="tk"
          ref={inputRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setHighlighted(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={highlighted >= 0 ? `${listId}-${highlighted}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder="Ticker or company"
          style={{
            width: 210,
            maxWidth: "52vw",
            height: 44,
            padding: "0 12px",
            fontSize: 16,
            border: "1px solid var(--border-medium)",
            borderRadius: 8,
            background: "#FFFFFF",
            fontFamily: "inherit",
          }}
        />
        <button
          type="submit"
          style={{
            height: 44,
            padding: "0 16px",
            fontSize: 14,
            fontWeight: 600,
            border: "1px solid var(--text-primary)",
            borderRadius: 8,
            background: "var(--text-primary)",
            color: "#FFFFFF",
            cursor: "pointer",
          }}
        >
          Go
        </button>
      </form>

      {showList && (matches.length > 0 || noMatch) && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Company matches"
          className="search-results"
        >
          {noMatch ? (
            <li className="search-empty" role="presentation">
              No US-listed company found.
            </li>
          ) : (
            matches.map((m, i) => (
              <li
                key={`${m.ticker}-${m.cik}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === highlighted}
                data-highlighted={i === highlighted}
                className="search-result"
                // pointerdown, not click: the outside-close handler also
                // listens for pointerdown, and mousedown would blur the
                // input before a click could land.
                onPointerDown={(e) => {
                  e.preventDefault();
                  choose(m);
                }}
                onPointerEnter={() => setHighlighted(i)}
              >
                <span className="search-result-name">{m.title}</span>
                <span className="search-result-ticker font-mono">{m.ticker}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
