-- ============================================================
-- db/roles/roles.sql — Canonical reference for the two DB roles.
-- Executed via db/migrations/0002_roles.sql as part of the migration sequence.
-- This file is documentation/audit; the migration is the authoritative executor.
--
-- INV-2: provider credentials exist only in the worker. The DB role ensures
--        the API cannot reach market-write paths even if misconfigured.
-- INV-3: the API writes no market facts; the worker reads no user rows.
-- ============================================================

-- stockwatch_api role
-- ─────────────────────────────────────────────────────────────
-- Reads: all tables (market + personal + operational)
-- Writes: personal tables, instrument_tracking (except last_ingested_at),
--         jobs (enqueue only), instruments/instrument_symbols (registration)
-- Cannot write: instrument_market_state, instrument_bars, market_events,
--               corporate_actions, instrument_signals, change_records
--               instrument_tracking.last_ingested_at

-- stockwatch_worker role
-- ─────────────────────────────────────────────────────────────
-- Reads: instrument_tracking, instruments, instrument_symbols,
--        instrument_bars, instrument_market_state, change_records,
--        instrument_signals, corporate_actions, market_events, jobs
-- Writes: all market-fact tables; instrument_tracking.last_ingested_at only;
--         jobs (claim/complete); instruments.corporate_action_version / last_published_seq
-- Cannot read: users, sessions, watchlists, watchlist_items,
--              user_instrument_checkpoints

-- See db/migrations/0002_roles.sql for the executable GRANT statements.
