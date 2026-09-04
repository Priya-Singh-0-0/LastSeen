/**
 * T6 — DB roles and grants tests. (Permanent gate — never weaken.)
 *
 * INV-2, INV-3: These are negative-permission tests. They verify that the
 * database enforces the ownership boundary, not just that the application
 * respects it.
 *
 * Two test groups:
 *  A) stockwatch_api: INSERT into each market-fact table must raise a
 *     permission error.
 *  B) stockwatch_worker: SELECT from each personal table must raise a
 *     permission error.
 *
 * Prerequisites: migrations 0001 + 0002 applied; roles exist with the
 * passwords set in 0002_roles.sql.
 *
 * Run: DATABASE_URL=... npm test -w api
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { runMigrations } from '../src/migrate.js';

const BASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://stockwatch:stockwatch@localhost:5432/stockwatch';

/** Build a connection string for a specific role, reusing host/db from the base URL. */
function roleUrl(role: 'stockwatch_api' | 'stockwatch_worker'): string {
  const parsed = new URL(BASE_URL);
  parsed.username = role;
  parsed.password = role; // matches 0002_roles.sql password
  return parsed.toString();
}

beforeAll(async () => {
  await runMigrations(BASE_URL);
});

// ─── helper ─────────────────────────────────────────────────────────────────

async function expectPermissionDenied(connStr: string, sql: string): Promise<void> {
  const client = new pg.Client({ connectionString: connStr });
  await client.connect();
  try {
    await expect(client.query(sql)).rejects.toThrow(/permission denied/i);
  } finally {
    await client.end();
  }
}

// ─── Group A: stockwatch_api must NOT write market-fact tables ──────────────

describe('T6-A — stockwatch_api cannot write market-fact tables (INV-3)', () => {
  const API_URL = roleUrl('stockwatch_api');

  it('INSERT into instrument_market_state raises permission error', async () => {
    await expectPermissionDenied(
      API_URL,
      `INSERT INTO instrument_market_state
         (instrument_id, price, market_timestamp, last_observed_market_ts, source,
          market_status, value_kind, data_freshness)
       VALUES (1, 100.0, NOW(), NOW(), 'test', 'OPEN', 'LIVE', 'FRESH')`,
    );
  });

  it('INSERT into instrument_bars raises permission error', async () => {
    await expectPermissionDenied(
      API_URL,
      `INSERT INTO instrument_bars
         (instrument_id, session_date, open, high, low, close, volume, source)
       VALUES (1, CURRENT_DATE, 1, 1, 1, 1, 1, 'test')`,
    );
  });

  it('INSERT into market_events raises permission error', async () => {
    await expectPermissionDenied(
      API_URL,
      `INSERT INTO market_events
         (instrument_id, event_type, event_ts, source)
       VALUES (1, 'EARNINGS', NOW(), 'test')`,
    );
  });

  it('INSERT into corporate_actions raises permission error', async () => {
    await expectPermissionDenied(
      API_URL,
      `INSERT INTO corporate_actions
         (instrument_id, action_type, effective_date, is_supported, version_seq, source)
       VALUES (1, 'SPLIT', CURRENT_DATE, true, 1, 'test')`,
    );
  });

  it('INSERT into instrument_signals raises permission error', async () => {
    await expectPermissionDenied(
      API_URL,
      `INSERT INTO instrument_signals
         (instrument_id, signal_type, detector_version, dedupe_key, market_timestamp)
       VALUES (1, 'LARGE_ABSOLUTE_MOVE', 1, 'key', NOW())`,
    );
  });

  it('INSERT into change_records raises permission error', async () => {
    await expectPermissionDenied(
      API_URL,
      `INSERT INTO change_records (instrument_id, latest_at)
       VALUES (1, NOW())`,
    );
  });
});

// ─── Group B: stockwatch_worker must NOT read personal tables ────────────────

describe('T6-B — stockwatch_worker cannot read personal tables (INV-2, INV-3)', () => {
  const WORKER_URL = roleUrl('stockwatch_worker');

  it('SELECT from users raises permission error', async () => {
    await expectPermissionDenied(WORKER_URL, 'SELECT id FROM users LIMIT 1');
  });

  it('SELECT from sessions raises permission error', async () => {
    await expectPermissionDenied(WORKER_URL, 'SELECT id FROM sessions LIMIT 1');
  });

  it('SELECT from watchlists raises permission error', async () => {
    await expectPermissionDenied(WORKER_URL, 'SELECT id FROM watchlists LIMIT 1');
  });

  it('SELECT from watchlist_items raises permission error', async () => {
    await expectPermissionDenied(WORKER_URL, 'SELECT id FROM watchlist_items LIMIT 1');
  });

  it('SELECT from user_instrument_checkpoints raises permission error', async () => {
    await expectPermissionDenied(WORKER_URL, 'SELECT id FROM user_instrument_checkpoints LIMIT 1');
  });
});
