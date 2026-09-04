-- ============================================================
-- Migration 0001_init.sql — Stockwatch initial schema
-- Creates all entities from architecture §E.
-- INV-9:  NUMERIC(18,6) for all money/percentage columns, TIMESTAMPTZ for timestamps.
-- INV-11: market_status, value_kind, data_freshness are three separate enum columns.
-- INV-4:  last_observed_market_ts on instrument_market_state enables monotonic guard.
-- INV-5:  unique(instrument_id, detector_version, dedupe_key) on instrument_signals.
-- INV-6:  last_published_seq on instruments; unique(instrument_id, published_seq) where not null.
-- INV-8:  unique(user_id, instrument_id) on user_instrument_checkpoints.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- Enum types (Postgres native; mirrored in packages/contracts/src/enums.ts)
-- ────────────────────────────────────────────────────────────

CREATE TYPE market_status AS ENUM (
  'PRE_OPEN',
  'OPEN',
  'POST',
  'CLOSED',
  'HALTED',
  'SUSPENDED',
  'DELISTED'
);

CREATE TYPE value_kind AS ENUM (
  'LIVE',
  'DELAYED_FEED',
  'SESSION_CLOSE',
  'LAST_TRADE',
  'LAST_KNOWN',
  'INDICATIVE'
);

CREATE TYPE data_freshness AS ENUM (
  'FRESH',
  'DELAYED',
  'STALE',
  'UNAVAILABLE',
  'CONFLICTED'
);

CREATE TYPE signal_type AS ENUM (
  'VOLATILITY_ADJUSTED_MOVE',
  'LARGE_ABSOLUTE_MOVE',
  'SIGNIFICANT_GAP',
  'RANGE_BREAKOUT',
  'ABNORMAL_VOLUME',
  'VOLUME_ACCELERATION',
  'EARNINGS_RELEASED',
  'CORPORATE_ACTION_APPLIED'
);

CREATE TYPE attention_band AS ENUM (
  'URGENT',
  'NOTABLE',
  'MINOR',
  'QUIET'
);

CREATE TYPE job_status AS ENUM (
  'PENDING',
  'RUNNING',
  'DONE',
  'FAILED'
);

CREATE TYPE tracking_state AS ENUM (
  'ACTIVE',
  'IDLE'
);

CREATE TYPE resolution_status AS ENUM (
  'PENDING_RESOLUTION',
  'RESOLVED',
  'UNRESOLVABLE'
);

-- ────────────────────────────────────────────────────────────
-- Personal tables (API-write)
-- ────────────────────────────────────────────────────────────

CREATE TABLE users (
  id            BIGSERIAL    PRIMARY KEY,
  email         TEXT         NOT NULL UNIQUE,
  password_hash TEXT         NOT NULL,
  timezone      TEXT         NOT NULL DEFAULT 'America/New_York',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE sessions (
  id          BIGSERIAL    PRIMARY KEY,
  user_id     BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT         NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ  NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE watchlists (
  id         BIGSERIAL    PRIMARY KEY,
  user_id    BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT         NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX watchlists_user_id_idx ON watchlists(user_id);

-- ────────────────────────────────────────────────────────────
-- Instruments (shared; worker-authoritative after registration)
-- ────────────────────────────────────────────────────────────

CREATE TABLE instruments (
  id                        BIGSERIAL          PRIMARY KEY,
  corporate_action_version  INT                NOT NULL DEFAULT 0,
  last_published_seq        BIGINT             NOT NULL DEFAULT 0,  -- INV-6
  resolution_status         resolution_status  NOT NULL DEFAULT 'PENDING_RESOLUTION',
  created_at                TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ        NOT NULL DEFAULT NOW()
);

CREATE TABLE instrument_symbols (
  id            BIGSERIAL    PRIMARY KEY,
  instrument_id BIGINT       NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  symbol        TEXT         NOT NULL,
  exchange      TEXT,
  valid_from    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  valid_to      TIMESTAMPTZ,                          -- NULL = currently active
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX instrument_symbols_symbol_idx ON instrument_symbols(symbol);
CREATE INDEX instrument_symbols_instrument_id_idx ON instrument_symbols(instrument_id);

-- ────────────────────────────────────────────────────────────
-- Watchlist items (after instruments — FK dependency)
-- ────────────────────────────────────────────────────────────

CREATE TABLE watchlist_items (
  id            BIGSERIAL    PRIMARY KEY,
  watchlist_id  BIGINT       NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  instrument_id BIGINT       NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  added_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(watchlist_id, instrument_id)
);

CREATE INDEX watchlist_items_watchlist_id_idx ON watchlist_items(watchlist_id);
CREATE INDEX watchlist_items_instrument_id_idx ON watchlist_items(instrument_id);

-- ────────────────────────────────────────────────────────────
-- Operational tables
-- ────────────────────────────────────────────────────────────

CREATE TABLE instrument_tracking (
  instrument_id    BIGINT         PRIMARY KEY REFERENCES instruments(id) ON DELETE CASCADE,
  tracking_state   tracking_state NOT NULL DEFAULT 'IDLE',
  follower_count   INT            NOT NULL DEFAULT 0,
  priority         INT            NOT NULL DEFAULT 0,
  last_ingested_at TIMESTAMPTZ,   -- written exclusively by the worker (INV-3)
  updated_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE TABLE jobs (
  id              BIGSERIAL    PRIMARY KEY,
  job_type        TEXT         NOT NULL,
  payload         JSONB        NOT NULL DEFAULT '{}',
  status          job_status   NOT NULL DEFAULT 'PENDING',
  idempotency_key TEXT         NOT NULL UNIQUE,         -- INV-5
  attempts        INT          NOT NULL DEFAULT 0,
  max_attempts    INT          NOT NULL DEFAULT 5,
  lease_expires_at TIMESTAMPTZ,
  scheduled_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX jobs_status_scheduled_at_idx ON jobs(status, scheduled_at)
  WHERE status IN ('PENDING', 'RUNNING');

-- ────────────────────────────────────────────────────────────
-- Shared market tables (worker-write; INV-9: NUMERIC(18,6))
-- ────────────────────────────────────────────────────────────

CREATE TABLE instrument_market_state (
  instrument_id          BIGINT         PRIMARY KEY REFERENCES instruments(id) ON DELETE CASCADE,
  -- Price envelope (INV-9: no double precision)
  price                  NUMERIC(18,6)  NOT NULL,
  currency               TEXT           NOT NULL DEFAULT 'USD',
  market_timestamp       TIMESTAMPTZ    NOT NULL,     -- financial ordering timestamp (§I)
  last_observed_market_ts TIMESTAMPTZ   NOT NULL,     -- monotonic guard column (INV-4)
  ingested_at            TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  source                 TEXT           NOT NULL,
  -- Semantic envelope (INV-11: three separate columns, not a composite)
  market_status          market_status  NOT NULL,
  value_kind             value_kind     NOT NULL,
  data_freshness         data_freshness NOT NULL,
  -- Session context
  session_date           DATE,
  open                   NUMERIC(18,6),
  high                   NUMERIC(18,6),
  low                    NUMERIC(18,6),
  volume                 BIGINT,
  prev_close             NUMERIC(18,6),
  precision_hint         SMALLINT       NOT NULL DEFAULT 2,
  updated_at             TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- Read path: inbox join (INV-1 — hot table, one row per instrument)
-- Primary key serves as the lookup; no additional index needed here.

CREATE TABLE instrument_bars (
  id            BIGSERIAL     PRIMARY KEY,
  instrument_id BIGINT        NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  session_date  DATE          NOT NULL,
  open          NUMERIC(18,6) NOT NULL,
  high          NUMERIC(18,6) NOT NULL,
  low           NUMERIC(18,6) NOT NULL,
  close         NUMERIC(18,6) NOT NULL,
  volume        BIGINT        NOT NULL,
  vwap          NUMERIC(18,6),
  source        TEXT          NOT NULL,
  ingested_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE(instrument_id, session_date)   -- INV-5; backfill is idempotent
);

-- Read path: feature extraction queries ~400 sessions per instrument
CREATE INDEX instrument_bars_instrument_date_idx
  ON instrument_bars(instrument_id, session_date DESC);

CREATE TABLE market_events (
  id            BIGSERIAL    PRIMARY KEY,
  instrument_id BIGINT       NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  event_type    TEXT         NOT NULL,   -- 'EARNINGS', 'GUIDANCE', etc.
  event_ts      TIMESTAMPTZ  NOT NULL,
  fiscal_period TEXT,
  provider_event_id TEXT,
  source        TEXT         NOT NULL,
  ingested_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(instrument_id, event_type, event_ts, fiscal_period)
);

CREATE INDEX market_events_instrument_id_idx ON market_events(instrument_id, event_ts DESC);

CREATE TABLE corporate_actions (
  id                BIGSERIAL     PRIMARY KEY,
  instrument_id     BIGINT        NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  action_type       TEXT          NOT NULL,   -- 'SPLIT', 'MERGER', etc.
  effective_date    DATE          NOT NULL,
  adjustment_factor NUMERIC(18,6),            -- NULL for unsupported actions
  is_supported      BOOLEAN       NOT NULL,
  version_seq       INT           NOT NULL,   -- increments per instrument per action
  source            TEXT          NOT NULL,
  ingested_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE(instrument_id, action_type, effective_date, adjustment_factor)
);

CREATE INDEX corporate_actions_instrument_version_idx
  ON corporate_actions(instrument_id, version_seq);

-- ────────────────────────────────────────────────────────────
-- Signals and change records (derived-but-stored; worker-write)
-- ────────────────────────────────────────────────────────────

CREATE TABLE change_records (
  id                  BIGSERIAL      PRIMARY KEY,
  instrument_id       BIGINT         NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  published_seq       BIGINT,                         -- NULL until sealed (INV-6)
  published_at        TIMESTAMPTZ,
  assembly_version    INT            NOT NULL DEFAULT 1,
  score               NUMERIC(18,6),
  band                attention_band,
  latest_at           TIMESTAMPTZ    NOT NULL,
  shared_explanation  TEXT,
  renderer_version    INT,
  created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  -- published records have unique seq per instrument (INV-6)
  CONSTRAINT change_records_published_seq_unique
    UNIQUE NULLS NOT DISTINCT (instrument_id, published_seq)
    DEFERRABLE INITIALLY DEFERRED
);

-- Read path: unseen-changes scan — the WHERE predicate every inbox query uses
CREATE INDEX change_records_instrument_seq_idx
  ON change_records(instrument_id, published_seq)
  WHERE published_seq IS NOT NULL;

CREATE TABLE instrument_signals (
  id               BIGSERIAL     PRIMARY KEY,
  instrument_id    BIGINT        NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  change_record_id BIGINT        REFERENCES change_records(id) ON DELETE SET NULL,
  signal_type      signal_type   NOT NULL,
  detector_version INT           NOT NULL,
  dedupe_key       TEXT          NOT NULL,
  evidence         JSONB         NOT NULL DEFAULT '{}',
  market_timestamp TIMESTAMPTZ   NOT NULL,
  fired_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  -- INV-5: uniqueness on (instrument_id, detector_version, dedupe_key)
  UNIQUE(instrument_id, detector_version, dedupe_key)
);

CREATE INDEX instrument_signals_change_record_idx
  ON instrument_signals(change_record_id);

-- ────────────────────────────────────────────────────────────
-- Personal checkpoint (INV-8: unique per (user, instrument))
-- ────────────────────────────────────────────────────────────

CREATE TABLE user_instrument_checkpoints (
  id                               BIGSERIAL     PRIMARY KEY,
  user_id                          BIGINT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instrument_id                    BIGINT        NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  seen_through_publication_seq     BIGINT        NOT NULL DEFAULT 0,
  baseline_price                   NUMERIC(18,6),        -- NULL when AWAITING_BASELINE
  baseline_market_timestamp        TIMESTAMPTZ,
  baseline_corporate_action_version INT          NOT NULL DEFAULT 0,
  created_at                       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  -- INV-8: one checkpoint per (user, instrument)
  UNIQUE(user_id, instrument_id)
);

-- Read path: inbox join — user's checkpoints for their watchlist instruments
CREATE INDEX user_instrument_checkpoints_user_id_idx
  ON user_instrument_checkpoints(user_id, instrument_id);
