-- ============================================================
-- Migration 0008_instrument_briefs.sql — model-rendered shared explanation cache
--
-- Architecture §F.7 specifies a ModelRenderer whose output attaches to a
-- ChangeRecord. Neither surface this table serves has a change record:
--
--   FIRST_VIEW  — a stock the user has never opened. Nothing "changed"; the
--                 brief describes the company and where its price sits against
--                 its own baseline.
--   D1/D2/W1/M1 — the returning view's "price now vs. price before" sentence,
--                 rendered against an anonymised elapsed-time window.
--
-- The window is a *bucket*, never a user's actual elapsed time, and carries no
-- user id: the API rounds a checkpoint age down to the nearest bucket and reads
-- the shared row. That keeps generation at unique instruments × buckets × day
-- rather than users × instruments (CLAUDE.md), and keeps every personal value
-- (the exact "2 days ago", the user's own baseline) in the API's deterministic
-- template, where §F.7 requires it to stay.
--
-- Cache key is (instrument_id, renderer_version, session_date, window). Keying
-- on session_date rather than on the live price means an intraday tick cannot
-- invalidate the cache; keying on renderer_version means a prompt or validator
-- change produces new rows instead of mutating history, exactly as
-- assembly_version and detector_version do elsewhere.
-- ============================================================

CREATE TYPE brief_window AS ENUM ('FIRST_VIEW', 'D1', 'D2', 'W1', 'M1');

-- Which renderer actually produced the stored text. A row is written on both
-- paths: when the model succeeds, and when it is unavailable, times out, or
-- fails validation and the deterministic template stands in. Storing the
-- template result too is what stops a persistently failing instrument from
-- re-enqueueing a job on every view.
CREATE TYPE brief_origin AS ENUM ('model', 'template');

CREATE TABLE instrument_briefs (
  instrument_id    BIGINT       NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  renderer_version INT          NOT NULL,
  session_date     DATE         NOT NULL,
  window_bucket    brief_window NOT NULL,
  brief_text       TEXT         NOT NULL,
  origin           brief_origin NOT NULL,
  -- Digest of the exact fact bundle the text was rendered from. Audit only: it
  -- answers "which numbers was this sentence allowed to contain" after the fact.
  -- It is deliberately NOT part of the cache key — that would regenerate on
  -- every price tick.
  fact_bundle_hash TEXT         NOT NULL,
  generated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (instrument_id, renderer_version, session_date, window_bucket)
);

-- The API's read is always "newest brief for this instrument+window at or before
-- today", so session_date descends.
CREATE INDEX instrument_briefs_lookup_idx
  ON instrument_briefs (instrument_id, window_bucket, renderer_version, session_date DESC);

-- Same split as every other shared market table: the worker holds the model
-- credential and owns the write side, the API only reads (INV-2, INV-3).
GRANT SELECT ON instrument_briefs TO stockwatch_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON instrument_briefs TO stockwatch_worker;
