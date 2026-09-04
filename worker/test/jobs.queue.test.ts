/**
 * T13 — job queue tests (INV-5, INV-16)
 *
 * Requires a live DB: DATABASE_URL env var.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import pg from 'pg';
import { createPool, query } from '../src/db.js';
import { claimJob, completeJob, failJob, drainOne } from '../src/jobs/queue.js';
import { buildHandlers } from '../src/jobs/handlers.js';

pg.types.setTypeParser(1700 as pg.TypeId, (v: string) => v);

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb('T13 — job queue', () => {
  let pool: pg.Pool;
  let client: pg.PoolClient;

  beforeAll(() => {
    pool = createPool(DATABASE_URL!);
  });

  afterAll(async () => {
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

  async function insertJob(
    jobType: string,
    idempotencyKey: string,
    status: string = 'PENDING',
  ): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO jobs (job_type, payload, idempotency_key, status)
       VALUES ($1, '{}', $2, $3)
       RETURNING id`,
      [jobType, idempotencyKey, status],
    );
    return rows[0].id;
  }

  it('claimJob returns null when no jobs exist', async () => {
    const job = await claimJob(client);
    expect(job).toBeNull();
  });

  it('claimJob claims a PENDING job and sets it to RUNNING', async () => {
    await insertJob('resolve_instrument', `ik-${Date.now()}`);
    const job = await claimJob(client);
    expect(job).not.toBeNull();
    expect(job!.jobType).toBe('resolve_instrument');

    const { rows } = await client.query<{ status: string }>(
      'SELECT status FROM jobs WHERE id = $1', [job!.id],
    );
    expect(rows[0].status).toBe('RUNNING');
  });

  it('completeJob sets job to DONE', async () => {
    const id = await insertJob('backfill_bars', `ik-done-${Date.now()}`);
    const job = await claimJob(client);
    expect(job).not.toBeNull();
    await completeJob(client, job!.id);

    const { rows } = await client.query<{ status: string }>(
      'SELECT status FROM jobs WHERE id = $1', [job!.id],
    );
    expect(rows[0].status).toBe('DONE');
  });

  it('failJob with attempts < max resets to PENDING with backoff', async () => {
    const id = await insertJob('resolve_instrument', `ik-fail-${Date.now()}`);
    const job = await claimJob(client);
    expect(job).not.toBeNull();

    await failJob(client, job!.id, 1, 5);

    const { rows } = await client.query<{ status: string }>(
      'SELECT status FROM jobs WHERE id = $1', [job!.id],
    );
    expect(rows[0].status).toBe('PENDING');
  });

  it('failJob at max_attempts marks job as FAILED permanently', async () => {
    const id = await insertJob('resolve_instrument', `ik-maxfail-${Date.now()}`);
    const job = await claimJob(client);
    expect(job).not.toBeNull();

    await failJob(client, job!.id, 5, 5);

    const { rows } = await client.query<{ status: string }>(
      'SELECT status FROM jobs WHERE id = $1', [job!.id],
    );
    expect(rows[0].status).toBe('FAILED');
  });

  it('duplicate idempotency key does not create a second job', async () => {
    const key = `ik-idem-${Date.now()}`;
    await client.query(
      `INSERT INTO jobs (job_type, payload, idempotency_key) VALUES ('resolve_instrument', '{}', $1)`,
      [key],
    );
    await client.query(
      `INSERT INTO jobs (job_type, payload, idempotency_key) VALUES ('resolve_instrument', '{}', $1)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [key],
    );

    const { rows } = await client.query<{ cnt: string }>(
      'SELECT COUNT(*) AS cnt FROM jobs WHERE idempotency_key = $1', [key],
    );
    expect(parseInt(rows[0].cnt, 10)).toBe(1);
  });

  it('two concurrent claimers never take the same job', async () => {
    // Insert one job outside the transaction so both connections see it.
    const key = `ik-concurrent-${Date.now()}`;
    await pool.query(
      `INSERT INTO jobs (job_type, payload, idempotency_key) VALUES ('resolve_instrument', '{}', $1)`,
      [key],
    );

    // Two separate connections try to claim at the same time.
    const [c1, c2] = await Promise.all([pool.connect(), pool.connect()]);
    try {
      await c1.query('BEGIN');
      await c2.query('BEGIN');

      const [j1, j2] = await Promise.all([claimJob(c1), claimJob(c2)]);

      // Exactly one should get the job; the other gets null (SKIP LOCKED).
      const claimed = [j1, j2].filter(Boolean);
      expect(claimed.length).toBe(1);

      await c1.query('ROLLBACK');
      await c2.query('ROLLBACK');

      // Restore job to PENDING so other tests are unaffected.
      await pool.query('UPDATE jobs SET status = $1 WHERE idempotency_key = $2', ['PENDING', key]);
    } finally {
      c1.release();
      c2.release();
      await pool.query('DELETE FROM jobs WHERE idempotency_key = $1', [key]);
    }
  });

  it('expired lease is reclaimable', async () => {
    // Insert a RUNNING job with an already-expired lease.
    const key = `ik-expired-${Date.now()}`;
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO jobs (job_type, payload, idempotency_key, status, lease_expires_at)
       VALUES ('resolve_instrument', '{}', $1, 'RUNNING', NOW() - INTERVAL '1 minute')
       RETURNING id`,
      [key],
    );
    const jobId = rows[0].id;

    // A fresh claimer should be able to claim it.
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const job = await claimJob(c);
      expect(job).not.toBeNull();
      expect(job!.id).toBe(jobId);
      await c.query('ROLLBACK');
    } finally {
      c.release();
      await pool.query('DELETE FROM jobs WHERE id = $1', [jobId]);
    }
  });

  it('drainOne: a handler that throws marks job failed — lease not silently dropped', async () => {
    const key = `ik-throw-${Date.now()}`;
    await pool.query(
      `INSERT INTO jobs (job_type, payload, idempotency_key) VALUES ('resolve_instrument', '{}', $1)`,
      [key],
    );

    const handlers = buildHandlers();
    handlers.set('resolve_instrument', async () => {
      throw new Error('handler threw');
    });

    await expect(drainOne(pool, handlers)).rejects.toThrow('handler threw');

    const { rows } = await pool.query<{ status: string; attempts: number }>(
      'SELECT status, attempts FROM jobs WHERE idempotency_key = $1', [key],
    );
    // Job should be PENDING (retryable) with attempts incremented.
    expect(rows[0].status).toBe('PENDING');
    expect(rows[0].attempts).toBeGreaterThan(0);

    await pool.query('DELETE FROM jobs WHERE idempotency_key = $1', [key]);
  });
});
