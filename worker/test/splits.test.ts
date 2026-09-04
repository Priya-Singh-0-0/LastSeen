import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import pg from 'pg';
import { createPool } from '../src/db.js';
import {
  Decimal,
  parseDecimal,
  toSessionDate,
  toUtcTimestamp,
  MarketStatus,
  ValueKind,
  DataFreshness,
  type Observation,
  type CorporateAction,
} from '@stockwatch/contracts';
import { classifyCorporateAction, type CorporateActionCandidate } from '../src/adjustment/index.js';
import { persistCorporateAction } from '../src/persist/actions.js';
import { detectCorporateActionApplied, type DetectorInput } from '../src/signals/detectors.js';
import { INSUFFICIENT_HISTORY } from '../src/features/index.js';

pg.types.setTypeParser(1700 as pg.TypeId, (v: string) => v);

describe('T33 — AdjustmentPolicy classification (pure)', () => {
  it('classifies a split with a factor as supported', () => {
    const candidate: CorporateActionCandidate = {
      instrumentId: 'inst-1',
      actionType: 'SPLIT',
      effectiveDate: toSessionDate('2024-07-02'),
      adjustmentFactor: parseDecimal('0.25'),
      source: 'test',
    };
    expect(classifyCorporateAction(candidate)).toEqual({
      isSupported: true,
      adjustmentFactor: parseDecimal('0.25'),
    });
  });

  it('classifies a merger as unsupported with no factor', () => {
    const candidate: CorporateActionCandidate = {
      instrumentId: 'inst-1',
      actionType: 'MERGER',
      effectiveDate: toSessionDate('2024-07-02'),
      source: 'test',
    };
    expect(classifyCorporateAction(candidate)).toEqual({
      isSupported: false,
      adjustmentFactor: undefined,
    });
  });

  it('classifies a SPLIT candidate with no factor as unsupported', () => {
    const candidate: CorporateActionCandidate = {
      instrumentId: 'inst-1',
      actionType: 'SPLIT',
      effectiveDate: toSessionDate('2024-07-02'),
      source: 'test',
    };
    expect(classifyCorporateAction(candidate)).toEqual({
      isSupported: false,
      adjustmentFactor: undefined,
    });
  });
});

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb('T33 — AdjustmentPolicy write side (DB-backed)', () => {
  let pool: pg.Pool;
  let client: pg.PoolClient;
  let instrumentId: string;

  beforeAll(async () => {
    pool = createPool(DATABASE_URL!);
    const c = await pool.connect();
    const { rows } = await c.query<{ id: string }>(`INSERT INTO instruments DEFAULT VALUES RETURNING id`);
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

  const baseObservation: Observation = {
    instrumentId: 'inst-1',
    symbol: 'AAPL',
    currency: 'USD',
    marketTimestamp: toUtcTimestamp(Date.parse('2024-07-02T16:00:00Z')),
    ingestedAt: toUtcTimestamp(Date.parse('2024-07-02T16:00:01Z')),
    source: 'test',
    marketStatus: MarketStatus.OPEN,
    valueKind: ValueKind.LIVE,
    dataFreshness: DataFreshness.FRESH,
    price: new Decimal(100),
    prevClose: new Decimal(100),
    open: new Decimal(100),
    high: new Decimal(100),
    low: new Decimal(100),
    volume: new Decimal(1000),
  };

  function makeInput(action: CorporateAction): DetectorInput {
    return {
      instrumentId,
      observation: baseObservation,
      history: [],
      features: INSUFFICIENT_HISTORY,
      sessionDate: toSessionDate('2024-07-02'),
      newMarketEvents: [],
      newCorporateActions: [action],
    };
  }

  it('a 4-for-1 split writes factor 0.25 and bumps the version once', async () => {
    const { rows: before } = await client.query<{ corporate_action_version: number }>(
      'SELECT corporate_action_version FROM instruments WHERE id = $1',
      [instrumentId],
    );
    expect(before[0].corporate_action_version).toBe(0);

    const candidate: CorporateActionCandidate = {
      instrumentId,
      actionType: 'SPLIT',
      effectiveDate: toSessionDate('2024-07-02'),
      adjustmentFactor: parseDecimal('0.25'),
      source: 'test',
    };
    const { action, isNew } = await persistCorporateAction(client, candidate);
    expect(isNew).toBe(true);
    expect(action.isSupported).toBe(true);
    expect(action.adjustmentFactor?.toFixed(2)).toBe('0.25');
    expect(action.versionSeq).toBe(1);

    const { rows: after } = await client.query<{ corporate_action_version: number }>(
      'SELECT corporate_action_version FROM instruments WHERE id = $1',
      [instrumentId],
    );
    expect(after[0].corporate_action_version).toBe(1);
  });

  it('re-ingesting the same split is idempotent', async () => {
    const candidate: CorporateActionCandidate = {
      instrumentId,
      actionType: 'SPLIT',
      effectiveDate: toSessionDate('2024-08-02'),
      adjustmentFactor: parseDecimal('0.5'),
      source: 'test',
    };
    const first = await persistCorporateAction(client, candidate);
    const second = await persistCorporateAction(client, candidate);

    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
    expect(second.action.versionSeq).toBe(first.action.versionSeq);

    const { rows } = await client.query<{ corporate_action_version: number }>(
      'SELECT corporate_action_version FROM instruments WHERE id = $1',
      [instrumentId],
    );
    expect(rows[0].corporate_action_version).toBe(first.action.versionSeq);
  });

  it('a merger is recorded unsupported with a null factor', async () => {
    const candidate: CorporateActionCandidate = {
      instrumentId,
      actionType: 'MERGER',
      effectiveDate: toSessionDate('2024-09-02'),
      source: 'test',
    };
    const { action, isNew } = await persistCorporateAction(client, candidate);
    expect(isNew).toBe(true);
    expect(action.isSupported).toBe(false);
    expect(action.adjustmentFactor).toBeUndefined();
  });

  it('emits a CORPORATE_ACTION_APPLIED signal with the correct dedupe key', async () => {
    const candidate: CorporateActionCandidate = {
      instrumentId,
      actionType: 'SPLIT',
      effectiveDate: toSessionDate('2024-07-02'),
      adjustmentFactor: parseDecimal('0.25'),
      source: 'test',
    };
    const { action } = await persistCorporateAction(client, candidate);

    const input = makeInput(action);
    const results = detectCorporateActionApplied(input);
    expect(results).toHaveLength(1);
    expect(results[0]?.signalType).toBe('CORPORATE_ACTION_APPLIED');
    expect(results[0]?.dedupeKey).toBe('CORPORATE_ACTION_APPLIED:SPLIT:2024-07-02:0.25');
  });
});
