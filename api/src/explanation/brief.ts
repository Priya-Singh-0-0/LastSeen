import { BriefWindow, ComparisonStatus } from '@stockwatch/contracts';
import type { Pool } from '../db.js';
import { query } from '../db.js';
import { enqueueJob } from '../jobs/enqueue.js';

/**
 * API read side for `instrument_briefs` (migration 0008, architecture §F.7).
 *
 * The brief is shared per-instrument content the worker renders and stores; the
 * API only selects which cached row to show and, on a miss, asks for one to be
 * made. It never calls a model — a user-facing read must not wait on a provider,
 * and per-user generation would scale with users × instruments (CLAUDE.md).
 *
 * The personal clause ("Since you last checked 3 days ago, it has moved 2.1%")
 * stays entirely in `personalTemplate.ts`. Nothing here is personalised beyond
 * choosing a bucket, and the bucket is all that is ever sent to the worker.
 */

/** Renderer version this API build reads. Must track the worker's BRIEF_RENDERER_VERSION. */
export const BRIEF_RENDERER_VERSION = 2;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Rounds a checkpoint age down to a shared bucket. Deliberately coarse: the
 * bucket is the only thing about the user's timing that leaves the API, and a
 * coarse value cannot single anyone out.
 *
 * Boundaries and lookbacks are both calendar days (D1 = 1, D2 = 2, W1 = 7,
 * M1 = 30), so a bucket names the same kind of span the user experienced
 * between visits. It is still approximate by construction: the exact elapsed
 * time the user actually sees comes from the personal clause, which is computed
 * from their own checkpoint.
 */
export function briefWindowFor(
  comparisonStatus: ComparisonStatus,
  elapsedMs: number | undefined,
): BriefWindow {
  // No baseline yet means the user has never really seen this instrument, which
  // is the first-view surface regardless of how long the row has existed.
  if (comparisonStatus === ComparisonStatus.AWAITING_BASELINE || elapsedMs === undefined) {
    return BriefWindow.FIRST_VIEW;
  }

  const days = elapsedMs / MS_PER_DAY;
  if (days < 2) return BriefWindow.D1;
  if (days < 4) return BriefWindow.D2;
  if (days < 14) return BriefWindow.W1;
  return BriefWindow.M1;
}

/**
 * The most recent cached brief for this instrument and bucket, or null.
 *
 * Not constrained to today's date: a brief rendered at the last close is the
 * correct thing to show on a weekend or a holiday, and re-rendering intraday
 * would defeat the cache. `NULL` simply means nothing has been generated yet.
 */
export async function loadBrief(
  pool: Pool,
  instrumentId: bigint,
  window: BriefWindow,
): Promise<string | null> {
  const { rows } = await query<{ brief_text: string }>(
    pool,
    `SELECT brief_text
     FROM instrument_briefs
     WHERE instrument_id = $1 AND window_bucket = $2 AND renderer_version = $3
     ORDER BY session_date DESC
     LIMIT 1`,
    [instrumentId, window, BRIEF_RENDERER_VERSION],
  );
  return rows[0]?.brief_text ?? null;
}

/**
 * Asks the worker to render a missing brief. Fire-and-forget by design: this
 * request serves the deterministic template, and the generated text appears on a
 * later view — the same warm-on-demand path `ingest_instrument` already uses.
 *
 * The idempotency key carries no user identity, and collapses every user asking
 * for the same (instrument, window, version) into one job.
 */
export async function requestBrief(
  pool: Pool,
  instrumentId: bigint,
  symbol: string,
  window: BriefWindow,
): Promise<void> {
  await enqueueJob(pool, {
    jobType: 'render_brief',
    payload: { instrumentId: String(instrumentId), symbol, window },
    idempotencyKey: `render_brief:${instrumentId}:${window}:v${BRIEF_RENDERER_VERSION}:${new Date().toISOString().slice(0, 10)}`,
  });
}
