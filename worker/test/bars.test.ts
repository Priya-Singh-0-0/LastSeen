import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import pg from 'pg';
import { createPool } from '../src/db.js';
import { upsertDailyBars } from '../src/persist/bars.js';
import { parseDecimal, toSessionDate } from '@stockwatch/contracts';
import type { DailyBar } from '@stockwatch/contracts';

// Ensure numeric type parser is set for tests
pg.types.setTypeParser(1700 as pg.TypeId, (v: string) => v);

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb('T17 — daily bar backfill', () => {
  let pool: pg.Pool;
  let client: pg.PoolClient;
  let instrumentId: string;

  beforeAll(async () => {
    pool = createPool(DATABASE_URL!);
    const c = await pool.connect();
    // Create an instrument
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO instruments DEFAULT VALUES RETURNING id`
    );
    instrumentId = rows[0].id;
    c.release();
  });

  afterAll(async () => {
    const c = await pool.connect();
    await c.query(`DELETE FROM instruments WHERE id = $1`, [instrumentId]);
    c.release();
    await pool.end();
  });

  beforeEach(async () => {
    client = await pool.connect();
    await client.query('BEGIN');
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
    client.release();
  });

  function makeBar(date: string, open: string = '100'): DailyBar {
    return {
      instrumentId,
      sessionDate: toSessionDate(date),
      open: parseDecimal(open),
      high: parseDecimal('110'),
      low: parseDecimal('90'),
      close: parseDecimal('105'),
      volume: parseDecimal('100000'),
    };
  }

  it('backfills daily bars', async () => {
    const bars = [makeBar('2024-01-02'), makeBar('2024-01-03')];
    const count = await upsertDailyBars(client, bars, 'test');
    expect(count).toBeGreaterThan(0);

    const { rows } = await client.query<{ cnt: string }>(
      'SELECT COUNT(*) as cnt FROM instrument_bars WHERE instrument_id = $1',
      [instrumentId]
    );
    expect(parseInt(rows[0].cnt, 10)).toBe(2);
  });

  it('backfill twice yields the same row count', async () => {
    const bars = [makeBar('2024-01-04'), makeBar('2024-01-05')];
    
    await upsertDailyBars(client, bars, 'test');
    await upsertDailyBars(client, bars, 'test');
    
    const { rows } = await client.query<{ cnt: string }>(
      'SELECT COUNT(*) as cnt FROM instrument_bars WHERE instrument_id = $1 AND session_date IN ($2, $3)',
      [instrumentId, '2024-01-04', '2024-01-05']
    );
    expect(parseInt(rows[0].cnt, 10)).toBe(2);
  });

  it('corrected bar updates in place', async () => {
    await upsertDailyBars(client, [makeBar('2024-01-08', '100')], 'test');
    
    const { rows: initial } = await client.query<{ open: string }>(
      'SELECT open FROM instrument_bars WHERE instrument_id = $1 AND session_date = $2',
      [instrumentId, '2024-01-08']
    );
    expect(Number(initial[0].open)).toBe(100);

    // Update with a new open
    await upsertDailyBars(client, [makeBar('2024-01-08', '150')], 'test');

    const { rows: updated } = await client.query<{ open: string }>(
      'SELECT open FROM instrument_bars WHERE instrument_id = $1 AND session_date = $2',
      [instrumentId, '2024-01-08']
    );
    expect(Number(updated[0].open)).toBe(150);
  });

  it('bar for a non-session date is rejected', async () => {
    // 2024-01-06 is a Saturday
    const bars = [makeBar('2024-01-06')];
    await expect(upsertDailyBars(client, bars, 'test')).rejects.toThrow(/non-session date/i);
  });
});
