-- Earnings Lens persistent store (Neon Postgres).
--
-- Why a database at all: "In-memory caching does not persist or share
-- across instances on Vercel. The readout cache, the daily-cap counter and
-- the per-accession store therefore need a persistent store."
--
-- Three tables, one per thing that has to outlive a serverless instance:
--   claude_explanations  -- one verified explanation per (accession, trigger)
--   claude_daily_calls   -- the daily Claude call count, the cap's backstop
--   filing_segments      -- segment revenue extracted from one filing
--
-- Every table is keyed on an accession number because a filing never
-- changes: once a filing has been read, the result is correct forever and
-- is never recomputed. Nothing here stores raw filing documents -- only
-- the extracted result, per the spec's cache rules.
--
-- Idempotent on purpose: `npm run db:apply` runs this whole file, so it
-- must be safe to run against a database that already has the tables.

-- One verified explanation per flagged item. The trigger key names WHICH
-- rule flagged the item, so two triggers on the same filing are two rows
-- and one trigger is never re-asked once answered.
CREATE TABLE IF NOT EXISTS claude_explanations (
  accession_number TEXT NOT NULL,
  trigger_key      TEXT NOT NULL,

  ticker           TEXT NOT NULL,
  -- 'explained'      -- at least one sentence passed verification
  -- 'not-explained'  -- the filing was read and did not explain the item
  -- The fallback state ("Explanations unavailable") is never stored: a cap
  -- hit or a failed call is not an answer, and storing it would poison the
  -- cache for the rest of the filing's life.
  status           TEXT NOT NULL CHECK (status IN ('explained', 'not-explained')),

  -- The sentences that passed verification, in order. Never more than two.
  sentences        JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- The verbatim passages each surviving sentence was checked against.
  passages         JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- { form, filingDate, accession, section } -- the citation shown on screen.
  citation         JSONB,
  -- Sentences the verifier dropped, with the reason. Kept so a later
  -- reader can see what was rejected and why, without re-running the call.
  dropped          JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Call accounting, for the cost/verification report.
  model            TEXT NOT NULL,
  source_chars     INTEGER,
  input_tokens     INTEGER,
  output_tokens    INTEGER,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (accession_number, trigger_key)
);

-- Everything a ticker's page needs is fetched by (accession, trigger), but
-- a report ("what has this ticker ever had explained") reads by ticker.
CREATE INDEX IF NOT EXISTS claude_explanations_ticker_idx
  ON claude_explanations (ticker, created_at DESC);

-- The daily cap. One row per UTC day; the counter is incremented BEFORE a
-- call is made, so a crash mid-call still spends its budget rather than
-- leaving the cap open to an unbounded retry loop.
CREATE TABLE IF NOT EXISTS claude_daily_calls (
  call_date  DATE PRIMARY KEY,
  calls      INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Segment revenue extracted from one filing's own XBRL instance document.
-- "Anything extracted from one filing is keyed on that filing's accession
-- number and kept permanently... Store the extracted result, never the raw
-- instance XML." The instance documents are megabytes; the result is a
-- handful of facts.
CREATE TABLE IF NOT EXISTS filing_segments (
  accession_number TEXT PRIMARY KEY,
  cik              TEXT NOT NULL,
  ticker           TEXT NOT NULL,
  -- The axis actually used ('us-gaap:StatementBusinessSegmentsAxis' or
  -- 'srt:ProductOrServiceAxis'), or NULL when the filing has no segment
  -- revenue on either axis. NULL is a real, cacheable answer: it means the
  -- filing was read and has nothing, so it is never read again.
  axis             TEXT,
  period_kind      TEXT,
  segments         JSONB NOT NULL,
  extracted_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One filing's own statements, extracted from the filing itself (instance
-- plus presentation, calculation and label linkbases): the income
-- statement's lines as the company presents them, with the figures the
-- filing reports for them, and the cash-flow statement's acquisitions
-- line. A filing never changes, so a row is written once and read forever.
-- The extracted lines only -- never the raw XML. `extract_version` lets an
-- improved extractor re-read a filing without touching any other table.
CREATE TABLE IF NOT EXISTS filing_statements (
  accession_number TEXT PRIMARY KEY,
  cik              TEXT NOT NULL,
  ticker           TEXT NOT NULL,
  extract_version  INTEGER NOT NULL,
  statement        JSONB NOT NULL,
  instance_bytes   INTEGER,
  extracted_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
