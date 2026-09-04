/**
 * T29 — Checkpoint repository — monotonic upsert (INV-7, INV-8)
 *
 * Requires a live DB: DATABASE_URL (stockwatch_api role, used for the calls under test)
 * and TEST_DATABASE_URL (superuser, used to seed instruments/instrument_market_state —
 * the API role has SELECT-only on instrument_market_state per T6).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { parseDecimal, fromDate, toUtcTimestamp } from '@stockwatch/contracts';
import { ensureCheckpoint, advanceCheckpoint, getCheckpoint } from '../src/checkpoints/repo.js';
import { getPool, _resetPool } from '../src/db.js';

pg.types.setTypeParser(1700 as pg.TypeId, (v: string) => v);

const DATABASE_URL = process.env.DATABASE_URL;
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDb = DATABASE_URL && TEST_DATABASE_URL ? describe : describe.skip;

describeWithDb('T29 — Checkpoint repository', () => {
  let pool: pg.Pool; // stockwatch_api role — used for the actual repo calls
  let setupPool: pg.Pool; // superuser — used only to seed fixtures

  beforeAll(async () => {
    _resetPool();
    pool = getPool(DATABASE_URL!);
    setupPool = new pg.Pool({ connectionString: TEST_DATABASE_URL! });
  });

  afterAll(async () => {
    await pool.end();
    await setupPool.end();
    _resetPool();
  });

  async function createUser(): Promise<string> {
    const { rows } = await setupPool.query<{ id: string }>(
      `INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING id`,
      [`checkpoint-repo-${Date.now()}-${Math.random()}@example.com`],
    );
    return rows[0].id;
  }

  async function createInstrument(opts?: { lastPublishedSeq?: number }): Promise<string> {
    const { rows } = await setupPool.query<{ id: string }>(
      `INSERT INTO instruments (resolution_status, last_published_seq)
       VALUES ('RESOLVED', $1) RETURNING id`,
      [opts?.lastPublishedSeq ?? 0],
    );
    return rows[0].id;
  }

  async function seedMarketState(instrumentId: string, price: string, marketTimestamp: Date): Promise<void> {
    await setupPool.query(
      `INSERT INTO instrument_market_state
         (instrument_id, price, market_timestamp, last_observed_market_ts, source, market_status, value_kind, data_freshness)
       VALUES ($1, $2, $3, $3, 'test', 'OPEN', 'LIVE', 'FRESH')`,
      [instrumentId, price, marketTimestamp],
    );
  }

  it('creates a checkpoint with current price as baseline when market state exists', async () => {
    const userId = await createUser();
    const instrumentId = await createInstrument({ lastPublishedSeq: 7 });
    const marketTs = new Date('2026-01-01T15:00:00Z');
    await seedMarketState(instrumentId, '123.450000', marketTs);

    const row = await ensureCheckpoint(pool, BigInt(userId), BigInt(instrumentId));

    expect(row.seenThroughPublicationSeq).toBe('7');
    expect(row.baselinePrice?.toFixed()).toBe('123.45');
    expect(row.baselineMarketTimestamp).toBe(fromDate(marketTs));
  });

  it('creates a checkpoint with null baseline and seen_through 0 when market state is warming', async () => {
    const userId = await createUser();
    const instrumentId = await createInstrument({ lastPublishedSeq: 9 });

    const row = await ensureCheckpoint(pool, BigInt(userId), BigInt(instrumentId));

    expect(row.seenThroughPublicationSeq).toBe('0');
    expect(row.baselinePrice).toBeNull();
    expect(row.baselineMarketTimestamp).toBeNull();
  });

  it('same instrument added via two watchlists shares one checkpoint row (create-if-absent)', async () => {
    const userId = await createUser();
    const instrumentId = await createInstrument({ lastPublishedSeq: 3 });
    await seedMarketState(instrumentId, '10.000000', new Date('2026-01-01T00:00:00Z'));

    const first = await ensureCheckpoint(pool, BigInt(userId), BigInt(instrumentId));
    await advanceCheckpoint(pool, BigInt(userId), BigInt(instrumentId), {
      servedWatermark: BigInt(5),
      baselinePrice: parseDecimal('11.000000'),
      baselineMarketTimestamp: toUtcTimestamp(Date.now()),
      corporateActionVersion: 0,
    });

    // Simulate a second watchlist add for the same (user, instrument) pair.
    const second = await ensureCheckpoint(pool, BigInt(userId), BigInt(instrumentId));

    expect(second.id).toBe(first.id);
    expect(second.seenThroughPublicationSeq).toBe('5');
  });

  it('advances the watermark forward and applies the new baseline', async () => {
    const userId = await createUser();
    const instrumentId = await createInstrument();
    await seedMarketState(instrumentId, '50.000000', new Date('2026-01-01T00:00:00Z'));
    await ensureCheckpoint(pool, BigInt(userId), BigInt(instrumentId));

    const newTs = toUtcTimestamp(Date.parse('2026-01-02T00:00:00Z'));
    const advanced = await advanceCheckpoint(pool, BigInt(userId), BigInt(instrumentId), {
      servedWatermark: BigInt(10),
      baselinePrice: parseDecimal('55.000000'),
      baselineMarketTimestamp: newTs,
      corporateActionVersion: 1,
    });

    expect(advanced?.seenThroughPublicationSeq).toBe('10');
    expect(advanced?.baselinePrice?.toFixed()).toBe('55');
    expect(advanced?.baselineMarketTimestamp).toBe(newTs);
    expect(advanced?.baselineCorporateActionVersion).toBe(1);
  });

  it('a replayed acknowledgement (same watermark) is a no-op', async () => {
    const userId = await createUser();
    const instrumentId = await createInstrument();
    await seedMarketState(instrumentId, '50.000000', new Date('2026-01-01T00:00:00Z'));
    await ensureCheckpoint(pool, BigInt(userId), BigInt(instrumentId));

    const firstTs = toUtcTimestamp(Date.parse('2026-01-02T00:00:00Z'));
    await advanceCheckpoint(pool, BigInt(userId), BigInt(instrumentId), {
      servedWatermark: BigInt(10),
      baselinePrice: parseDecimal('55.000000'),
      baselineMarketTimestamp: firstTs,
      corporateActionVersion: 1,
    });

    // Replay: same watermark, an older baseline timestamp (as a stale/duplicate token would carry).
    const replayed = await advanceCheckpoint(pool, BigInt(userId), BigInt(instrumentId), {
      servedWatermark: BigInt(10),
      baselinePrice: parseDecimal('999.000000'),
      baselineMarketTimestamp: toUtcTimestamp(Date.parse('2026-01-01T12:00:00Z')),
      corporateActionVersion: 0,
    });

    expect(replayed?.seenThroughPublicationSeq).toBe('10');
    expect(replayed?.baselinePrice?.toFixed()).toBe('55');
    expect(replayed?.baselineMarketTimestamp).toBe(firstTs);
    expect(replayed?.baselineCorporateActionVersion).toBe(1);
  });

  it('concurrent advances from two sessions converge and never regress', async () => {
    const userId = await createUser();
    const instrumentId = await createInstrument();
    await seedMarketState(instrumentId, '50.000000', new Date('2026-01-01T00:00:00Z'));
    await ensureCheckpoint(pool, BigInt(userId), BigInt(instrumentId));

    const laterTs = toUtcTimestamp(Date.parse('2026-01-05T00:00:00Z'));
    const earlierTs = toUtcTimestamp(Date.parse('2026-01-03T00:00:00Z'));

    // Session B (further ahead) commits first...
    await advanceCheckpoint(pool, BigInt(userId), BigInt(instrumentId), {
      servedWatermark: BigInt(20),
      baselinePrice: parseDecimal('70.000000'),
      baselineMarketTimestamp: laterTs,
      corporateActionVersion: 2,
    });

    // ...then session A (stale, behind) commits second.
    const afterStale = await advanceCheckpoint(pool, BigInt(userId), BigInt(instrumentId), {
      servedWatermark: BigInt(15),
      baselinePrice: parseDecimal('60.000000'),
      baselineMarketTimestamp: earlierTs,
      corporateActionVersion: 1,
    });

    expect(afterStale?.seenThroughPublicationSeq).toBe('20');
    expect(afterStale?.baselinePrice?.toFixed()).toBe('70');
    expect(afterStale?.baselineMarketTimestamp).toBe(laterTs);
  });

  it('remove-then-re-add within the retention window preserves the advanced checkpoint', async () => {
    const userId = await createUser();
    const instrumentId = await createInstrument();
    await seedMarketState(instrumentId, '50.000000', new Date('2026-01-01T00:00:00Z'));
    const created = await ensureCheckpoint(pool, BigInt(userId), BigInt(instrumentId));
    await advanceCheckpoint(pool, BigInt(userId), BigInt(instrumentId), {
      servedWatermark: BigInt(12),
      baselinePrice: parseDecimal('65.000000'),
      baselineMarketTimestamp: toUtcTimestamp(Date.parse('2026-01-04T00:00:00Z')),
      corporateActionVersion: 0,
    });

    // "Removal" never deletes the checkpoint row (no watchlist_item FK on this table) —
    // re-adding is just another ensureCheckpoint call for the same (user, instrument).
    const readded = await ensureCheckpoint(pool, BigInt(userId), BigInt(instrumentId));

    expect(readded.id).toBe(created.id);
    expect(readded.seenThroughPublicationSeq).toBe('12');
    expect(readded.baselinePrice?.toFixed()).toBe('65');
  });

  it('getCheckpoint returns null when no checkpoint exists', async () => {
    const userId = await createUser();
    const instrumentId = await createInstrument();

    const row = await getCheckpoint(pool, BigInt(userId), BigInt(instrumentId));

    expect(row).toBeNull();
  });
});
