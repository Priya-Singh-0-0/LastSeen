/**
 * T15 — market state ordering tests (INV-4, INV-5)
 *
 * Gate §O.3: older_observation_cannot_overwrite_newer_state
 * Gate §O.4 (partial): duplicate_job_execution_is_idempotent (first half)
 *
 * Requires a live DB: DATABASE_URL env var.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import pg from 'pg';
import { createPool } from '../src/db.js';
import { upsertMarketState } from '../src/persist/marketState.js';
import { validateObservation } from '../src/normalize/validate.js';
import { parseDecimal } from '@stockwatch/contracts';
import type { Observation } from '@stockwatch/contracts';
import { MarketStatus, ValueKind, DataFreshness } from '@stockwatch/contracts';

pg.types.setTypeParser(1700 as pg.TypeId, (v: string) => v);

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

function makeObservation(
  price: string,
  marketTimestamp: number,
  overrides: Partial<Observation> = {},
): Observation {
  return {
    instrumentId: '0',
    symbol: 'TEST',
    price: parseDecimal(price),
    currency: 'USD',
    marketTimestamp: marketTimestamp as Observation['marketTimestamp'],
    ingestedAt: Date.now() as Observation['ingestedAt'],
    source: 'test',
    marketStatus: MarketStatus.OPEN,
    valueKind: ValueKind.LIVE,
    dataFreshness: DataFreshness.FRESH,
    ...overrides,
  };
}

describeWithDb('T15 — market state ordering', () => {
  let pool: pg.Pool;
  let client: pg.PoolClient;
  let instrumentId: bigint;

  beforeAll(() => {
    pool = createPool(DATABASE_URL!);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    client = await pool.connect();
    await client.query('BEGIN');

    // Insert a test instrument.
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO instruments (resolution_status) VALUES ('RESOLVED') RETURNING id`,
    );
    instrumentId = BigInt(rows[0].id);
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
    client.release();
  });

  it('older_observation_cannot_overwrite_newer_state (§O.3)', async () => {
    const tPlus10 = Date.now();
    const tPlus5 = tPlus10 - 5000;

    const newObs = makeObservation('200.000000', tPlus10);
    const oldObs = makeObservation('100.000000', tPlus5, {
      marketStatus: MarketStatus.CLOSED,
      valueKind: ValueKind.SESSION_CLOSE,
      dataFreshness: DataFreshness.DELAYED,
    });

    // Apply T+10 first.
    const r1 = await upsertMarketState(client, instrumentId, newObs);
    expect(r1.written).toBe(true);

    // Replay T+5 — must not overwrite.
    const r2 = await upsertMarketState(client, instrumentId, oldObs);
    expect(r2.written).toBe(false);

    // State must still reflect T+10.
    const { rows } = await client.query<{
      price: string; market_status: string; value_kind: string; data_freshness: string;
    }>(
      `SELECT price, market_status, value_kind, data_freshness
       FROM instrument_market_state WHERE instrument_id = $1`,
      [instrumentId],
    );
    expect(rows[0].price).toBe('200.000000');
    expect(rows[0].market_status).toBe('OPEN');
    expect(rows[0].value_kind).toBe('LIVE');
    expect(rows[0].data_freshness).toBe('FRESH');
  });

  it('duplicate_job_execution_is_idempotent — same observation twice changes nothing (§O.4 partial)', async () => {
    const ts = Date.now() - 1000; // 1 second ago so clock skew check passes
    const obs = makeObservation('155.500000', ts);

    const r1 = await upsertMarketState(client, instrumentId, obs);
    expect(r1.written).toBe(true);

    const { rows: before } = await client.query<{ price: string; updated_at: Date }>(
      'SELECT price, updated_at FROM instrument_market_state WHERE instrument_id = $1', [instrumentId],
    );

    // Small delay to let updated_at differ if it were to change.
    await new Promise((r) => setTimeout(r, 10));

    const r2 = await upsertMarketState(client, instrumentId, obs);
    // Same timestamp → WHERE predicate fails → no write.
    expect(r2.written).toBe(false);

    const { rows: after } = await client.query<{ price: string; updated_at: Date }>(
      'SELECT price, updated_at FROM instrument_market_state WHERE instrument_id = $1', [instrumentId],
    );
    expect(before[0].price).toBe(after[0].price);
  });

  it('implausible price is rejected and prior state is retained', async () => {
    const ts = Date.now() - 1000;
    const normalObs = makeObservation('100.000000', ts);
    await upsertMarketState(client, instrumentId, normalObs);

    // Price 100× higher — should fail plausibility check.
    const implausibleObs = makeObservation('10001.000000', ts + 1000);
    const result = validateObservation(implausibleObs, parseDecimal('100.000000'));
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toMatch(/implausible/i);

    // DB state must be unchanged.
    const { rows } = await client.query<{ price: string }>(
      'SELECT price FROM instrument_market_state WHERE instrument_id = $1', [instrumentId],
    );
    expect(rows[0].price).toBe('100.000000');
  });
});
