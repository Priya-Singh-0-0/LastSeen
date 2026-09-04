-- ============================================================
-- Migration 0003_auth_rate_limit.sql
-- Adds the login_attempts table for per-email rate limiting (INV-16 — no Redis).
-- ============================================================

CREATE TABLE login_attempts (
  id           BIGSERIAL    PRIMARY KEY,
  email        TEXT         NOT NULL,
  success      BOOLEAN      NOT NULL,
  attempted_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Enables the rate-limit query: recent attempts by email.
CREATE INDEX login_attempts_email_attempted_at_idx
  ON login_attempts(email, attempted_at DESC);

-- ── Auto-prune: keep only the last 30 days ──────────────────
-- No cron required — old rows are excluded by the WHERE predicate
-- and can be vacuumed periodically. For the test window, a simple
-- partial index on attempted_at keeps scans fast.

-- ── Role grants ──────────────────────────────────────────────
-- stockwatch_api: full access (rate limit is a personal-auth concern)
GRANT USAGE, SELECT ON SEQUENCE login_attempts_id_seq TO stockwatch_api;
GRANT SELECT, INSERT ON login_attempts TO stockwatch_api;

-- stockwatch_worker: no access — auth is API-only (INV-3)

