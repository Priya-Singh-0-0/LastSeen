/**
 * Defect 1 — snapshot polling scheduler.
 *
 * Requires a live DB: DATABASE_URL env var.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';
import { parseDecimal, MarketStatus, ValueKind, DataFreshness } from '@stockwatch/contracts';
import type { Observation, DailyBar, AssetRef } from '@stockwatch/contracts';
import { createPool, query } from '../src/db.js';
import type { ProviderAdapter } from '../src/provider/index.js';
import { selectActiveInstruments, pollOnce } from '../src/scheduler.js';

pg.types.setTypeParser(1700 as pg.TypeId, (v: string) => v);

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

class StubSnapshotAdapter implements ProviderAdapter {
  constructor(private readonly bySymbol: Map<string, Omit<Observation, 'instrumentId'>>) {}
  async fetchSnapshots(symbols: string[]): Promise<Observation[]> {
    const out: Observation[] = [];
    for (const symbol of symbols) {
      const obs = this.bySymbol.get(symbol);
      if (obs) out.push({ ...obs, instrumentId: '0' });
    }
    return out;
  }
  async fetchDailyBars(): Promise<DailyBar[]> { return []; }
  async fetchAssets(): Promise<AssetRef[]> { return []; }
}

function observation(symbol: string, price: string, marketTimestamp: number): Omit<Observation, 'instrumentId'> {
  return {
    symbol,
    price: parseDecimal(price),
    currency: 'USD',
    marketTimestamp: marketTimestamp as Observation['marketTimestamp'],
    ingestedAt: Date.now() as Observation['ingestedAt'],
    source: 'test',
    marketStatus: MarketStatus.OPEN,
    valueKind: ValueKind.LIVE,
    dataFreshness: DataFreshness.FRESH,
  };
}

describeWithDb('scheduler (DB-backed)', () => {
  let pool: pg.Pool;

  async function registerInstrument(symbol: string, trackingState: 'ACTIVE' | 'IDLE'): Promise<bigint> {
    const { rows } = await query<{ id: string }>(
      pool,
      `INSERT INTO instruments (resolution_status) VALUES ('RESOLVED') RETURNING id`,
    );
    const instrumentId = BigInt(rows[0]!.id);
    await query(pool, `INSERT INTO instrument_symbols (instrument_id, symbol) VALUES ($1, $2)`, [
      instrumentId,
      symbol,
    ]);
    await query(
      pool,
      `INSERT INTO instrument_tracking (instrument_id, tracking_state, follower_count, priority)
       VALUES ($1, $2, 1, 1)`,
      [instrumentId, trackingState],
    );
    return instrumentId;
  }

  async function cleanup(): Promise<void> {
    await query(pool, `DELETE FROM instrument_symbols WHERE symbol LIKE 'ZSCH%'`);
    await query(
      pool,
      `DELETE FROM instruments WHERE id IN (
         SELECT instrument_id FROM instrument_tracking
         WHERE instrument_id NOT IN (SELECT instrument_id FROM instrument_symbols)
       )`,
    );
  }

  beforeAll(() => {
    pool = createPool(DATABASE_URL!);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await cleanup();
  });

  it('selects only ACTIVE instruments, by their current symbol', async () => {
    const activeId = await registerInstrument('ZSCHA', 'ACTIVE');
    await registerInstrument('ZSCHB', 'IDLE');

    const active = await selectActiveInstruments(pool);
    const symbols = active.filter((a) => a.instrumentId === activeId).map((a) => a.symbol);
    expect(symbols).toEqual(['ZSCHA']);
    expect(active.some((a) => a.symbol === 'ZSCHB')).toBe(false);

    await query(pool, `DELETE FROM instrument_symbols WHERE symbol IN ('ZSCHA', 'ZSCHB')`);
  });

  it('persists a snapshot for a newly ACTIVE instrument and stamps last_ingested_at', async () => {
    const instrumentId = await registerInstrument('ZSCHC', 'ACTIVE');
    const ts = Date.now() - 1000;

    const adapter = new StubSnapshotAdapter(
      new Map([['ZSCHC', observation('ZSCHC', '123.450000', ts)]]),
    );

    const result = await pollOnce(pool, adapter);
    expect(result.written).toBeGreaterThanOrEqual(1);

    const { rows } = await query<{ price: string }>(
      pool,
      `SELECT price FROM instrument_market_state WHERE instrument_id = $1`,
      [instrumentId],
    );
    expect(rows[0]?.price).toBe('123.450000');

    const { rows: trackingRows } = await query<{ last_ingested_at: Date | null }>(
      pool,
      `SELECT last_ingested_at FROM instrument_tracking WHERE instrument_id = $1`,
      [instrumentId],
    );
    expect(trackingRows[0]?.last_ingested_at).not.toBeNull();

    await query(pool, `DELETE FROM instrument_market_state WHERE instrument_id = $1`, [instrumentId]);
    await query(pool, `DELETE FROM instrument_symbols WHERE symbol = 'ZSCHC'`);
  });

  it('never regresses market state when an older observation arrives on a later tick', async () => {
    const instrumentId = await registerInstrument('ZSCHD', 'ACTIVE');
    const newer = Date.now();
    const older = newer - 60_000;

    const firstTick = new StubSnapshotAdapter(
      new Map([['ZSCHD', observation('ZSCHD', '200.000000', newer)]]),
    );
    await pollOnce(pool, firstTick);

    const secondTick = new StubSnapshotAdapter(
      new Map([['ZSCHD', observation('ZSCHD', '50.000000', older)]]),
    );
    const result = await pollOnce(pool, secondTick);
    expect(result.written).toBe(0);

    const { rows } = await query<{ price: string }>(
      pool,
      `SELECT price FROM instrument_market_state WHERE instrument_id = $1`,
      [instrumentId],
    );
    expect(rows[0]?.price).toBe('200.000000');

    await query(pool, `DELETE FROM instrument_market_state WHERE instrument_id = $1`, [instrumentId]);
    await query(pool, `DELETE FROM instrument_symbols WHERE symbol = 'ZSCHD'`);
  });
});
