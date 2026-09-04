/**
 * T7 — Enum mirror consistency test.
 *
 * INV-11: keeps packages/contracts/src/enums.ts and the Postgres enum types
 * in lockstep. Bidirectional:
 *  - every Postgres enum value exists in the TS enum
 *  - every TS enum value exists in Postgres
 *
 * A value added to the DB without updating the mirror fails this test.
 * A value added to the mirror without a migration also fails this test.
 *
 * Run: DATABASE_URL=... npm test -w packages/contracts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import {
  MarketStatus, ValueKind, DataFreshness,
  SignalType, AttentionBand, JobStatus, TrackingState,
  ResolutionStatus,
} from '../src/enums.js';

const TEST_DB_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://stockwatch:stockwatch@localhost:5432/stockwatch';

let pool: pg.Pool;

beforeAll(() => {
  pool = new pg.Pool({ connectionString: TEST_DB_URL });
});

afterAll(async () => {
  await pool.end();
});

// ─── helper ─────────────────────────────────────────────────────────────────

async function pgEnumValues(typeName: string): Promise<string[]> {
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

function tsEnumValues(e: Record<string, string>): string[] {
  return Object.values(e);
}

function assertBidirectional(pgVals: string[], tsVals: string[], label: string): void {
  const pgSet = new Set(pgVals);
  const tsSet = new Set(tsVals);

  const inPgNotTs = pgVals.filter(v => !tsSet.has(v));
  const inTsNotPg = tsVals.filter(v => !pgSet.has(v));

  expect(inPgNotTs, `${label}: values in Postgres missing from TS mirror`).toHaveLength(0);
  expect(inTsNotPg, `${label}: values in TS mirror missing from Postgres`).toHaveLength(0);
}

// ─── bidirectional checks ────────────────────────────────────────────────────

describe('T7 — enum mirror bidirectional consistency (INV-11)', () => {
  it('market_status', async () => {
    const pg = await pgEnumValues('market_status');
    assertBidirectional(pg, tsEnumValues(MarketStatus as unknown as Record<string, string>), 'market_status');
  });

  it('value_kind', async () => {
    const pg = await pgEnumValues('value_kind');
    assertBidirectional(pg, tsEnumValues(ValueKind as unknown as Record<string, string>), 'value_kind');
  });

  it('data_freshness', async () => {
    const pg = await pgEnumValues('data_freshness');
    assertBidirectional(pg, tsEnumValues(DataFreshness as unknown as Record<string, string>), 'data_freshness');
  });

  it('signal_type', async () => {
    const pg = await pgEnumValues('signal_type');
    assertBidirectional(pg, tsEnumValues(SignalType as unknown as Record<string, string>), 'signal_type');
  });

  it('attention_band', async () => {
    const pg = await pgEnumValues('attention_band');
    assertBidirectional(pg, tsEnumValues(AttentionBand as unknown as Record<string, string>), 'attention_band');
  });

  it('job_status', async () => {
    const pg = await pgEnumValues('job_status');
    assertBidirectional(pg, tsEnumValues(JobStatus as unknown as Record<string, string>), 'job_status');
  });

  it('tracking_state', async () => {
    const pg = await pgEnumValues('tracking_state');
    assertBidirectional(pg, tsEnumValues(TrackingState as unknown as Record<string, string>), 'tracking_state');
  });

  it('resolution_status', async () => {
    const pg = await pgEnumValues('resolution_status');
    assertBidirectional(pg, tsEnumValues(ResolutionStatus as unknown as Record<string, string>), 'resolution_status');
  });
});
