/**
 * T26 — AdjustmentPolicy read side (identity case) (INV-12)
 *
 * Requires a live DB: DATABASE_URL (stockwatch_api role, used for the read call itself)
 * and TEST_DATABASE_URL (superuser, used to seed corporate_actions rows — the API role
 * has SELECT-only on that table per T6).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { factorBetween } from '../src/diff/adjustment.js';
import { getPool, _resetPool } from '../src/db.js';

pg.types.setTypeParser(1700 as pg.TypeId, (v: string) => v);

const DATABASE_URL = process.env.DATABASE_URL;
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDb = DATABASE_URL && TEST_DATABASE_URL ? describe : describe.skip;

describeWithDb('T26 — AdjustmentPolicy read side', () => {
  let pool: pg.Pool; // stockwatch_api role — used for the actual factorBetween call
  let setupPool: pg.Pool; // superuser — used only to seed corporate_actions fixtures

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

  async function createInstrument(): Promise<string> {
    const { rows } = await setupPool.query<{ id: string }>(
      `INSERT INTO instruments (resolution_status) VALUES ('RESOLVED') RETURNING id`,
    );
    return rows[0].id;
  }

  async function insertAction(
    instrumentId: string,
    versionSeq: number,
    opts: { isSupported: boolean; adjustmentFactor?: string; actionType?: string },
  ): Promise<void> {
    await setupPool.query(
      `INSERT INTO corporate_actions
         (instrument_id, action_type, effective_date, adjustment_factor, is_supported, version_seq, source)
       VALUES ($1, $2, $3, $4, $5, $6, 'test')`,
      [
        instrumentId,
        opts.actionType ?? 'SPLIT',
        '2024-01-01',
        opts.adjustmentFactor ?? null,
        opts.isSupported,
        versionSeq,
      ],
    );
  }

  it('identity case: no actions in range returns factor 1 and no unsupported flag', async () => {
    const instrumentId = await createInstrument();

    const result = await factorBetween(pool, instrumentId, 0, 0);

    expect(result.factor.toFixed()).toBe('1');
    expect(result.hasUnsupportedAction).toBe(false);
    expect(result.actions).toEqual([]);
  });

  it('identity case: fromVersion equal to toVersion excludes an action at that version', async () => {
    const instrumentId = await createInstrument();
    await insertAction(instrumentId, 1, { isSupported: true, adjustmentFactor: '0.250000' });

    const result = await factorBetween(pool, instrumentId, 1, 1);

    expect(result.factor.toFixed()).toBe('1');
    expect(result.hasUnsupportedAction).toBe(false);
    expect(result.actions).toEqual([]);
  });

  it('a supported action in range multiplies the factor', async () => {
    const instrumentId = await createInstrument();
    await insertAction(instrumentId, 1, { isSupported: true, adjustmentFactor: '0.250000' });

    const result = await factorBetween(pool, instrumentId, 0, 1);

    expect(result.factor.toFixed()).toBe('0.25');
    expect(result.hasUnsupportedAction).toBe(false);
    expect(result.actions).toHaveLength(1);
  });

  it('an unsupported action in range sets the flag regardless of factor', async () => {
    const instrumentId = await createInstrument();
    await insertAction(instrumentId, 1, { isSupported: true, adjustmentFactor: '0.250000' });
    await insertAction(instrumentId, 2, { isSupported: false, actionType: 'MERGER' });

    const result = await factorBetween(pool, instrumentId, 0, 2);

    expect(result.hasUnsupportedAction).toBe(true);
    expect(result.actions).toHaveLength(2);
  });
});
