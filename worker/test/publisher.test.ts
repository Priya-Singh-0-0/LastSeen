/**
 * T24 — publisher tests (INV-6)
 *
 * Gate §O.9: published_seq_is_monotonically_ordered_per_instrument
 *
 * Requires a live DB: DATABASE_URL env var.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import pg from 'pg';
import { createPool } from '../src/db.js';
import { publishChangeRecord } from '../src/assembly/publisher.js';

pg.types.setTypeParser(1700 as pg.TypeId, (v: string) => v);

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb('T24 — publisher', () => {
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

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO instruments (resolution_status) VALUES ('RESOLVED') RETURNING id`,
    );
    instrumentId = BigInt(rows[0].id);
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
    client.release();
  });

  async function insertDraft(): Promise<bigint> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO change_records (instrument_id, assembly_version, latest_at)
       VALUES ($1, 1, NOW())
       RETURNING id`,
      [instrumentId],
    );
    return BigInt(rows[0].id);
  }

  it('assigns published_seq 1 to the first record for an instrument', async () => {
    const recordId = await insertDraft();
    const result = await publishChangeRecord(client, instrumentId, recordId);

    expect(result.publishedSeq).toBe(1);
    expect(result.alreadyPublished).toBe(false);

    const { rows } = await client.query<{ last_published_seq: string }>(
      `SELECT last_published_seq FROM instruments WHERE id = $1`,
      [instrumentId],
    );
    expect(rows[0].last_published_seq).toBe('1');
  });

  it('assigns strictly increasing sequences across successive publishes', async () => {
    const first = await publishChangeRecord(client, instrumentId, await insertDraft());
    const second = await publishChangeRecord(client, instrumentId, await insertDraft());
    const third = await publishChangeRecord(client, instrumentId, await insertDraft());

    expect([first.publishedSeq, second.publishedSeq, third.publishedSeq]).toEqual([1, 2, 3]);
  });

  it('is a no-op when the record already carries a published_seq', async () => {
    const recordId = await insertDraft();
    const first = await publishChangeRecord(client, instrumentId, recordId);
    expect(first.alreadyPublished).toBe(false);

    const second = await publishChangeRecord(client, instrumentId, recordId);
    expect(second.alreadyPublished).toBe(true);
    expect(second.publishedSeq).toBe(first.publishedSeq);
    expect(second.publishedAt).toEqual(first.publishedAt);

    const { rows } = await client.query<{ last_published_seq: string }>(
      `SELECT last_published_seq FROM instruments WHERE id = $1`,
      [instrumentId],
    );
    // The instrument counter must not have been touched by the no-op re-publish.
    expect(rows[0].last_published_seq).toBe('1');
  });

  it('tolerates a gap left by a publish whose transaction never committed', async () => {
    const recordA = await insertDraft();
    await publishChangeRecord(client, instrumentId, recordA); // seq 1

    // Simulate an earlier publish that allocated seq 2 but whose surrounding
    // transaction rolled back before stamping the record — a permanent gap.
    await client.query(
      `UPDATE instruments SET last_published_seq = 2 WHERE id = $1`,
      [instrumentId],
    );

    const recordB = await insertDraft();
    const result = await publishChangeRecord(client, instrumentId, recordB);

    // The gap at seq 2 is tolerated, not filled or repaired.
    expect(result.publishedSeq).toBe(3);
  });

  it('published_seq_is_monotonically_ordered_per_instrument under concurrent publication', async () => {
    // Insert the instrument and two drafts outside the per-test transaction so both
    // connections can see them.
    const { rows: instRows } = await pool.query<{ id: string }>(
      `INSERT INTO instruments (resolution_status) VALUES ('RESOLVED') RETURNING id`,
    );
    const concurrentInstrumentId = BigInt(instRows[0].id);

    const { rows: rec1 } = await pool.query<{ id: string }>(
      `INSERT INTO change_records (instrument_id, assembly_version, latest_at)
       VALUES ($1, 1, NOW()) RETURNING id`,
      [concurrentInstrumentId],
    );
    const { rows: rec2 } = await pool.query<{ id: string }>(
      `INSERT INTO change_records (instrument_id, assembly_version, latest_at)
       VALUES ($1, 1, NOW()) RETURNING id`,
      [concurrentInstrumentId],
    );
    const recordId1 = BigInt(rec1[0].id);
    const recordId2 = BigInt(rec2[0].id);

    const [c1, c2] = await Promise.all([pool.connect(), pool.connect()]);
    try {
      await c1.query('BEGIN');
      await c2.query('BEGIN');

      // c1 acquires the instrument row lock and completes its statements, but does not
      // yet commit — c2's attempt to publish must block on that same row lock rather
      // than proceeding, proving the two publishes are serialized per instrument.
      const r1Promise = publishChangeRecord(c1, concurrentInstrumentId, recordId1);
      const r1 = await r1Promise;

      let c2Resolved = false;
      const r2Promise = publishChangeRecord(c2, concurrentInstrumentId, recordId2).then((r) => {
        c2Resolved = true;
        return r;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(c2Resolved).toBe(false); // still blocked on c1's row lock

      await c1.query('COMMIT');
      const r2 = await r2Promise;
      await c2.query('COMMIT');

      const seqs = [r1.publishedSeq, r2.publishedSeq].sort((a, b) => a - b);
      expect(seqs).toEqual([1, 2]);
    } finally {
      c1.release();
      c2.release();
      await pool.query('DELETE FROM change_records WHERE instrument_id = $1', [concurrentInstrumentId]);
      await pool.query('DELETE FROM instruments WHERE id = $1', [concurrentInstrumentId]);
    }
  });

  it('renders and stamps the shared explanation once, at publish time (T25)', async () => {
    const recordId = await insertDraft();
    await client.query(
      `INSERT INTO instrument_signals (instrument_id, change_record_id, signal_type, detector_version, dedupe_key, evidence, market_timestamp)
       VALUES ($1, $2, 'RANGE_BREAKOUT', 1, 'k1', $3, NOW())`,
      [
        instrumentId,
        recordId,
        JSON.stringify({ close: '150.5', high20: '140.25', low20: '120.0', direction: 'above', window: '20' }),
      ],
    );

    const result = await publishChangeRecord(client, instrumentId, recordId);
    expect(result.alreadyPublished).toBe(false);

    const { rows } = await client.query<{ shared_explanation: string | null; renderer_version: number | null }>(
      `SELECT shared_explanation, renderer_version FROM change_records WHERE id = $1`,
      [recordId],
    );
    expect(rows[0].shared_explanation).toContain('150.5');
    expect(rows[0].renderer_version).toBe(1);
  });

  it('leaves shared_explanation null when the record has no signals', async () => {
    const recordId = await insertDraft();
    await publishChangeRecord(client, instrumentId, recordId);

    const { rows } = await client.query<{ shared_explanation: string | null }>(
      `SELECT shared_explanation FROM change_records WHERE id = $1`,
      [recordId],
    );
    expect(rows[0].shared_explanation).toBeNull();
  });

  it('stamps score and band from the record signals at publish time (architecture §F.3)', async () => {
    const recordId = await insertDraft();
    await client.query(
      `INSERT INTO instrument_signals (instrument_id, change_record_id, signal_type, detector_version, dedupe_key, evidence, market_timestamp)
       VALUES ($1, $2, 'LARGE_ABSOLUTE_MOVE', 1, 'k1', $3, NOW())`,
      [instrumentId, recordId, JSON.stringify({ pct_change: '0.10' })],
    );

    await publishChangeRecord(client, instrumentId, recordId);

    const { rows } = await client.query<{ score: string | null; band: string | null }>(
      `SELECT score, band FROM change_records WHERE id = $1`,
      [recordId],
    );
    expect(rows[0].score).not.toBeNull();
    expect(Number(rows[0].score)).toBeCloseTo(0.7, 5);
    expect(rows[0].band).toBe('NOTABLE');
  });

  it('leaves score and band null when the record has no signals', async () => {
    const recordId = await insertDraft();
    await publishChangeRecord(client, instrumentId, recordId);

    const { rows } = await client.query<{ score: string | null; band: string | null }>(
      `SELECT score, band FROM change_records WHERE id = $1`,
      [recordId],
    );
    expect(rows[0].score).toBeNull();
    expect(rows[0].band).toBeNull();
  });

  it('attempting to publish a sealed record from a fresh call is a no-op', async () => {
    const recordId = await insertDraft();
    await publishChangeRecord(client, instrumentId, recordId);

    const before = await client.query<{ published_seq: string; published_at: Date }>(
      `SELECT published_seq, published_at FROM change_records WHERE id = $1`,
      [recordId],
    );

    const result = await publishChangeRecord(client, instrumentId, recordId);

    const after = await client.query<{ published_seq: string; published_at: Date }>(
      `SELECT published_seq, published_at FROM change_records WHERE id = $1`,
      [recordId],
    );

    expect(result.alreadyPublished).toBe(true);
    expect(after.rows[0].published_seq).toBe(before.rows[0].published_seq);
    expect(after.rows[0].published_at).toEqual(before.rows[0].published_at);
  });
});
