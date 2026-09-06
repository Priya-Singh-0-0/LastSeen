-- ============================================================
-- Migration 0007_tracking_source.sql — decouple ingestion demand from starring
--
-- Architecture §D: "Tracking is API-owned because it expresses demand, not
-- market fact." Until now the only demand source was watchlist membership
-- (T12, api/src/watchlists/tracking.ts). Viewing a catalog symbol is also
-- demand: GET /instruments/by-symbol/:symbol now registers an instrument +
-- instrument_tracking row for a symbol nobody has starred yet, instead of
-- returning an identity-only sheet that can never warm up.
--
-- tracking_source distinguishes *why* a row is being tracked so a later phase
-- can reap instruments that were only ever viewed, never starred. This
-- migration only adds the column; no reaper is introduced here.
--
-- 'VIEWED'  — demand created by a GET with no prior watchlist membership.
-- 'STARRED' — demand created or reconciled from >=1 watchlist follower.
--             Recomputed alongside follower_count (api/src/watchlists/
--             tracking.ts), so a row created as VIEWED is promoted to
--             STARRED the moment someone actually stars it, and demoted back
--             to VIEWED (never dropped) if it is later unstarred but still
--             exists.
-- ============================================================

CREATE TYPE tracking_source AS ENUM (
  'VIEWED',
  'STARRED'
);

ALTER TABLE instrument_tracking
  ADD COLUMN tracking_source tracking_source NOT NULL DEFAULT 'STARRED';

-- stockwatch_api owns this column (same split as tracking_state/follower_count/priority —
-- last_ingested_at remains the only worker-only column, INV-3).
GRANT INSERT (tracking_source) ON instrument_tracking TO stockwatch_api;
GRANT UPDATE (tracking_source) ON instrument_tracking TO stockwatch_api;
