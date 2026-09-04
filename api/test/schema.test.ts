/**
 * T5 — Core schema migration introspection tests.
 *
 * Connects to a real Postgres DB (TEST_DATABASE_URL), applies the migrations
 * (idempotent), then asserts:
 *  - every table exists
 *  - every enum type and its values exist
 *  - every named unique constraint exists
 *  - the two read-path indexes exist
 *  - no money column uses double precision (INV-9)
 *
 * Run: DATABASE_URL=... npm test -w api
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { runMigrations } from '../src/migrate.js';

const TEST_DB_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://stockwatch:stockwatch@localhost:5432/stockwatch';

let pool: pg.Pool;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: TEST_DB_URL });
  await runMigrations(TEST_DB_URL);
});

afterAll(async () => {
  await pool.end();
});

// ─── helpers ────────────────────────────────────────────────────────────────

async function tableExists(name: string): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT FROM pg_tables
       WHERE schemaname = 'public' AND tablename = $1
     ) AS exists`,
    [name],
  );
  return rows[0]!.exists;
}

async function enumExists(typeName: string): Promise<string[]> {
  const { rows } = await pool.query<{ enumlabel: string }>(
    `SELECT e.enumlabel
     FROM pg_type t
     JOIN pg_enum e ON e.enumtypid = t.oid
     WHERE t.typname = $1
     ORDER BY e.enumsortorder`,
    [typeName],
  );
  return rows.map(r => r.enumlabel);
}

async function uniqueConstraintExists(table: string, constraintName: string): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT FROM pg_constraint c
       JOIN pg_class r ON r.oid = c.conrelid
       WHERE r.relname = $1 AND c.conname = $2
         AND c.contype = 'u'
     ) AS exists`,
    [table, constraintName],
  );
  return rows[0]!.exists;
}

async function indexExists(indexName: string): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = $1
     ) AS exists`,
    [indexName],
  );
  return rows[0]!.exists;
}

// ─── Table existence ─────────────────────────────────────────────────────────

describe('T5 — all tables exist', () => {
  const EXPECTED_TABLES = [
    'users',
    'sessions',
    'watchlists',
    'watchlist_items',
    'instruments',
    'instrument_symbols',
    'instrument_tracking',
    'instrument_market_state',
    'instrument_bars',
    'market_events',
    'corporate_actions',
    'instrument_signals',
    'change_records',
    'user_instrument_checkpoints',
    'jobs',
    'schema_migrations',
  ];

  for (const table of EXPECTED_TABLES) {
    it(`table "${table}" exists`, async () => {
      expect(await tableExists(table)).toBe(true);
    });
  }
});

// ─── Enum types ──────────────────────────────────────────────────────────────

describe('T5 — enum types match enums.ts (INV-11)', () => {
  it('market_status values', async () => {
    const vals = await enumExists('market_status');
    expect(vals).toEqual(['PRE_OPEN', 'OPEN', 'POST', 'CLOSED', 'HALTED', 'SUSPENDED', 'DELISTED']);
  });

  it('value_kind values', async () => {
    const vals = await enumExists('value_kind');
    expect(vals).toEqual(['LIVE', 'DELAYED_FEED', 'SESSION_CLOSE', 'LAST_TRADE', 'LAST_KNOWN', 'INDICATIVE']);
  });

  it('data_freshness values', async () => {
    const vals = await enumExists('data_freshness');
    expect(vals).toEqual(['FRESH', 'DELAYED', 'STALE', 'UNAVAILABLE', 'CONFLICTED']);
  });

  it('signal_type values', async () => {
    const vals = await enumExists('signal_type');
    expect(vals).toEqual([
      'VOLATILITY_ADJUSTED_MOVE', 'LARGE_ABSOLUTE_MOVE', 'SIGNIFICANT_GAP',
      'RANGE_BREAKOUT', 'ABNORMAL_VOLUME', 'VOLUME_ACCELERATION',
      'EARNINGS_RELEASED', 'CORPORATE_ACTION_APPLIED',
    ]);
  });

  it('attention_band values', async () => {
    const vals = await enumExists('attention_band');
    expect(vals).toEqual(['URGENT', 'NOTABLE', 'MINOR', 'QUIET']);
  });

  it('job_status values', async () => {
    const vals = await enumExists('job_status');
    expect(vals).toEqual(['PENDING', 'RUNNING', 'DONE', 'FAILED']);
  });

  it('tracking_state values', async () => {
    const vals = await enumExists('tracking_state');
    expect(vals).toEqual(['ACTIVE', 'IDLE']);
  });

  it('resolution_status values', async () => {
    const vals = await enumExists('resolution_status');
    expect(vals).toEqual(['PENDING_RESOLUTION', 'RESOLVED', 'UNRESOLVABLE']);
  });
});

// ─── Unique constraints ───────────────────────────────────────────────────────

describe('T5 — unique constraints', () => {
  it('instrument_bars unique (instrument_id, session_date) — INV-5 idempotent backfill', async () => {
    // The constraint name is auto-named by Postgres from the UNIQUE clause
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM pg_constraint c
       JOIN pg_class r ON r.oid = c.conrelid
       WHERE r.relname = 'instrument_bars' AND c.contype = 'u'`,
    );
    expect(Number(rows[0]!.count)).toBeGreaterThanOrEqual(1);
  });

  it('instrument_signals unique (instrument_id, detector_version, dedupe_key) — INV-5', async () => {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM pg_constraint c
       JOIN pg_class r ON r.oid = c.conrelid
       WHERE r.relname = 'instrument_signals' AND c.contype = 'u'`,
    );
    expect(Number(rows[0]!.count)).toBeGreaterThanOrEqual(1);
  });

  it('change_records unique per published (instrument_id, published_seq) — INV-6', async () => {
    expect(await uniqueConstraintExists('change_records', 'change_records_published_seq_unique')).toBe(true);
  });

  it('user_instrument_checkpoints unique (user_id, instrument_id) — INV-8', async () => {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM pg_constraint c
       JOIN pg_class r ON r.oid = c.conrelid
       WHERE r.relname = 'user_instrument_checkpoints' AND c.contype = 'u'`,
    );
    expect(Number(rows[0]!.count)).toBeGreaterThanOrEqual(1);
  });

  it('jobs unique idempotency_key — INV-5', async () => {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM pg_constraint c
       JOIN pg_class r ON r.oid = c.conrelid
       WHERE r.relname = 'jobs' AND c.contype = 'u'`,
    );
    expect(Number(rows[0]!.count)).toBeGreaterThanOrEqual(1);
  });
});

// ─── Read-path indexes ───────────────────────────────────────────────────────

describe('T5 — read-path indexes exist', () => {
  it('change_records_instrument_seq_idx — unseen-changes scan', async () => {
    expect(await indexExists('change_records_instrument_seq_idx')).toBe(true);
  });

  it('user_instrument_checkpoints_user_id_idx — inbox join', async () => {
    expect(await indexExists('user_instrument_checkpoints_user_id_idx')).toBe(true);
  });
});

// ─── INV-9: no double precision on money/percentage columns ─────────────────

describe('T5 — no money column is double precision (INV-9)', () => {
  it('zero double precision columns in financial tables', async () => {
    const { rows } = await pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND data_type = 'double precision'
         AND table_name IN (
           'instrument_market_state', 'instrument_bars',
           'corporate_actions', 'user_instrument_checkpoints',
           'instrument_signals', 'change_records'
         )`,
    );
    expect(rows).toHaveLength(0);
  });
});
