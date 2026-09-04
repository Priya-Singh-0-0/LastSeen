import type { Pool, PoolClient } from '../db.js';
import { query } from '../db.js';

/**
 * INSERT-only job enqueue (T11 — INV-3, INV-5).
 *
 * The API only enqueues jobs; it never reads or mutates job state.
 * idempotency_key prevents double-enqueue on duplicate add (INV-5).
 */

export type JobType =
  | 'resolve_instrument'
  | 'backfill_bars';

export interface EnqueueOptions {
  jobType: JobType;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
  scheduledAt?: Date;
}

/**
 * Enqueue a job. On idempotency_key conflict, silently does nothing (ON CONFLICT DO NOTHING).
 * Returns the job id, or null if a duplicate was suppressed.
 */
export async function enqueueJob(
  client: Pool | PoolClient,
  opts: EnqueueOptions,
): Promise<string | null> {
  const { rows } = await query<{ id: string }>(
    client,
    `INSERT INTO jobs (job_type, payload, idempotency_key, scheduled_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      opts.jobType,
      JSON.stringify(opts.payload ?? {}),
      opts.idempotencyKey,
      opts.scheduledAt ?? new Date(),
    ],
  );
  return rows[0]?.id ?? null;
}
