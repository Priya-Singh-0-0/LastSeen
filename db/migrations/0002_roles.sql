-- ============================================================
-- Migration 0002_roles.sql — DB role grants (T6)
-- INV-2, INV-3: enforce write boundary in the database, not by convention.
-- Idempotent: CREATE ROLE IF NOT EXISTS is used.
-- The actual DDL lives in db/roles/roles.sql (for reference/audit).
-- ============================================================

-- Create roles (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'stockwatch_api') THEN
    CREATE ROLE stockwatch_api WITH LOGIN PASSWORD 'stockwatch_api';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'stockwatch_worker') THEN
    CREATE ROLE stockwatch_worker WITH LOGIN PASSWORD 'stockwatch_worker';
  END IF;
END
$$;

-- ──────────────────────────────────────────────────────────────
-- stockwatch_api grants
-- Reads all market tables; writes personal + operational tables;
-- may INSERT into instruments/instrument_symbols for registration;
-- may INSERT into jobs (enqueue only).
-- NEVER writes instrument_market_state, instrument_bars,
-- market_events, corporate_actions, instrument_signals, change_records.
-- ──────────────────────────────────────────────────────────────

-- Schema usage
GRANT USAGE ON SCHEMA public TO stockwatch_api;

-- Sequences the API needs for INSERT
GRANT USAGE, SELECT ON SEQUENCE users_id_seq                         TO stockwatch_api;
GRANT USAGE, SELECT ON SEQUENCE sessions_id_seq                      TO stockwatch_api;
GRANT USAGE, SELECT ON SEQUENCE watchlists_id_seq                    TO stockwatch_api;
GRANT USAGE, SELECT ON SEQUENCE watchlist_items_id_seq               TO stockwatch_api;
GRANT USAGE, SELECT ON SEQUENCE instruments_id_seq                   TO stockwatch_api;
GRANT USAGE, SELECT ON SEQUENCE instrument_symbols_id_seq            TO stockwatch_api;
GRANT USAGE, SELECT ON SEQUENCE jobs_id_seq                          TO stockwatch_api;
GRANT USAGE, SELECT ON SEQUENCE user_instrument_checkpoints_id_seq   TO stockwatch_api;

-- Personal tables: full CRUD
GRANT SELECT, INSERT, UPDATE, DELETE ON users                          TO stockwatch_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions                       TO stockwatch_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON watchlists                     TO stockwatch_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON watchlist_items                TO stockwatch_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_instrument_checkpoints    TO stockwatch_api;

-- Instruments/symbols: INSERT for first-time registration + SELECT
GRANT SELECT, INSERT ON instruments         TO stockwatch_api;
GRANT SELECT, INSERT ON instrument_symbols  TO stockwatch_api;

-- instrument_tracking: full CRUD EXCEPT last_ingested_at (INV-3)
-- Column-level grant: all columns except last_ingested_at
GRANT SELECT ON instrument_tracking TO stockwatch_api;
GRANT INSERT (instrument_id, tracking_state, follower_count, priority, updated_at)
  TO stockwatch_api;
GRANT UPDATE (tracking_state, follower_count, priority, updated_at)
  TO stockwatch_api;
-- Deliberately NO grant on last_ingested_at for stockwatch_api

-- Jobs: INSERT only (enqueue), SELECT for status reads
GRANT SELECT, INSERT ON jobs TO stockwatch_api;
GRANT USAGE, SELECT ON SEQUENCE jobs_id_seq TO stockwatch_api;

-- Market tables: READ ONLY (INV-3: API must never write market facts)
GRANT SELECT ON instrument_market_state  TO stockwatch_api;
GRANT SELECT ON instrument_bars          TO stockwatch_api;
GRANT SELECT ON market_events            TO stockwatch_api;
GRANT SELECT ON corporate_actions        TO stockwatch_api;
GRANT SELECT ON instrument_signals       TO stockwatch_api;
GRANT SELECT ON change_records           TO stockwatch_api;

-- ──────────────────────────────────────────────────────────────
-- stockwatch_worker grants
-- Writes all market tables + last_ingested_at on tracking.
-- Reads jobs and instrument_tracking.
-- NO access to users, sessions, watchlists, watchlist_items,
-- user_instrument_checkpoints (INV-2, INV-3).
-- ──────────────────────────────────────────────────────────────

GRANT USAGE ON SCHEMA public TO stockwatch_worker;

-- Sequences the worker needs
GRANT USAGE, SELECT ON SEQUENCE instrument_market_state_id_seq  TO stockwatch_worker;
GRANT USAGE, SELECT ON SEQUENCE instrument_bars_id_seq          TO stockwatch_worker;
GRANT USAGE, SELECT ON SEQUENCE market_events_id_seq            TO stockwatch_worker;
GRANT USAGE, SELECT ON SEQUENCE corporate_actions_id_seq        TO stockwatch_worker;
GRANT USAGE, SELECT ON SEQUENCE instrument_signals_id_seq       TO stockwatch_worker;
GRANT USAGE, SELECT ON SEQUENCE change_records_id_seq           TO stockwatch_worker;
GRANT USAGE, SELECT ON SEQUENCE jobs_id_seq                     TO stockwatch_worker;

-- Market-fact tables: full write
GRANT SELECT, INSERT, UPDATE ON instrument_market_state  TO stockwatch_worker;
GRANT SELECT, INSERT, UPDATE ON instrument_bars          TO stockwatch_worker;
GRANT SELECT, INSERT, UPDATE ON market_events            TO stockwatch_worker;
GRANT SELECT, INSERT, UPDATE ON corporate_actions        TO stockwatch_worker;
GRANT SELECT, INSERT, UPDATE ON instrument_signals       TO stockwatch_worker;
GRANT SELECT, INSERT, UPDATE ON change_records           TO stockwatch_worker;

-- Instruments: worker reads + updates corporate_action_version / last_published_seq
GRANT SELECT, UPDATE ON instruments        TO stockwatch_worker;
GRANT SELECT           ON instrument_symbols TO stockwatch_worker;

-- instrument_tracking: read + write only last_ingested_at (INV-3)
GRANT SELECT ON instrument_tracking TO stockwatch_worker;
GRANT UPDATE (last_ingested_at, updated_at) ON instrument_tracking TO stockwatch_worker;

-- Jobs: claim (SELECT FOR UPDATE), update status/lease, insert
GRANT SELECT, INSERT, UPDATE ON jobs TO stockwatch_worker;
