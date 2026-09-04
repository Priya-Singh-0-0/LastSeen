import type { Pool, PoolClient } from '../db.js';
import { query } from '../db.js';
import type { JobHandler } from './handlers.js';

/**
 * Retry-safe, lease-based job queue (T13 — INV-5, INV-16).
 *
 * Claim: SELECT ... FOR UPDATE SKIP LOCKED → one job per claimer, never double-claimed.
 * Lease: expires after LEASE_TIMEOUT_MS; expired leases are reclaimable.
 * Retry: exponential backoff; after max_attempts the job is FAILED.
 */

const LEASE_TIMEOUT_MS = 30_000; // 30 s

export interface JobRow {
  id: string;
  jobType: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

/**
 * Claim exactly one PENDING job (or reclaim one whose lease has expired).
 * Returns null if no claimable job exists.
 */
export async function claimJob(client: PoolClient): Promise<JobRow | null> {
  const { rows } = await query<{
    id: string;
    job_type: string;
    payload: Record<string, unknown>;
    attempts: number;
    max_attempts: number;
  }>(
    client,
    `SELECT id, job_type, payload, attempts, max_attempts
     FROM jobs
     WHERE status = 'PENDING'
        OR (status = 'RUNNING' AND lease_expires_at < NOW())
     ORDER BY scheduled_at
     LIMIT 1
     FOR UPDATE SKIP LOCKED`,
    [],
  );

  if (rows.length === 0) return null;
  const row = rows[0]!;

  await query(
    client,
    `UPDATE jobs
     SET status = 'RUNNING',
         attempts = attempts + 1,
         lease_expires_at = NOW() + INTERVAL '${LEASE_TIMEOUT_MS} milliseconds',
         updated_at = NOW()
     WHERE id = $1`,
    [row.id],
  );

  return {
    id: row.id,
    jobType: row.job_type,
    payload: row.payload,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
  };
}

/** Mark a job as successfully completed. */
export async function completeJob(client: PoolClient, jobId: string): Promise<void> {
  await query(
    client,
    `UPDATE jobs SET status = 'DONE', updated_at = NOW() WHERE id = $1`,
    [jobId],
  );
}

/**
 * Mark a job as failed.
 * If attempts < max_attempts the job is reset to PENDING with exponential backoff;
 * otherwise it is set to FAILED permanently.
 *
 * `attempts` is written here (not just used for backoff math): the caller may be
 * running in a fresh transaction after rolling back the one that incremented it in
 * `claimJob`, so this is the only durable write of the current attempt count.
 */
export async function failJob(
  client: PoolClient,
  jobId: string,
  attempts: number,
  maxAttempts: number,
): Promise<void> {
  if (attempts < maxAttempts) {
    // Exponential backoff: 2^(attempts-1) minutes, capped at 60 min.
    const backoffSeconds = Math.min(Math.pow(2, attempts - 1) * 60, 3600);
    await query(
      client,
      `UPDATE jobs
       SET status = 'PENDING',
           attempts = $1,
           lease_expires_at = NULL,
           scheduled_at = NOW() + ($2 * INTERVAL '1 second'),
           updated_at = NOW()
       WHERE id = $3`,
      [attempts, backoffSeconds, jobId],
    );
  } else {
    await query(
      client,
      `UPDATE jobs SET status = 'FAILED', attempts = $1, updated_at = NOW() WHERE id = $2`,
      [attempts, jobId],
    );
  }
}

/**
 * Drain one job from the queue inside a transaction.
 * If the handler throws, the job is failed (retry or permanent).
 * Unhandled rejections surface here — never silently dropped.
 */
export async function drainOne(
  pool: Pool,
  handlers: Map<string, JobHandler>,
): Promise<boolean> {
  const client = await pool.connect();
  let job: JobRow | null = null;

  try {
    await client.query('BEGIN');
    job = await claimJob(client);
    if (!job) {
      await client.query('ROLLBACK');
      return false;
    }

    const handler = handlers.get(job.jobType);
    if (!handler) {
      // Unknown job type — fail immediately.
      await failJob(client, job.id, job.maxAttempts, job.maxAttempts);
      await client.query('COMMIT');
      return true;
    }

    await handler(job.payload, client);
    await completeJob(client, job.id);
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    if (job) {
      // Re-open a new transaction for the failure update.
      const fc = await pool.connect();
      try {
        await fc.query('BEGIN');
        await failJob(fc, job.id, job.attempts + 1, job.maxAttempts);
        await fc.query('COMMIT');
      } finally {
        fc.release();
      }
    }
    throw err; // Surface to caller; never silently swallowed.
  } finally {
    client.release();
  }
}
