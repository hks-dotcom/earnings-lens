// The one date both snapshot tests read EDGAR as of: only filings on or
// before it (the verdict's H as-of read, lib/verdict/repairs/asOf.ts). It is
// the date the baselines in snapshots/ and statements-snapshots/ were
// written, so a filing that lands later never shows up as a change.
//
// Used by all four scripts -- snapshot.ts and diff-snapshot.ts,
// statements-snapshot.ts and diff-statements-snapshot.ts -- so a baseline
// and its diff always read the same filings. Re-baselining means moving
// this date and rewriting both baselines together.

export const SNAPSHOT_AS_OF = "2026-09-22";
