import type { Pool, PoolClient } from '../db.js';
import { query } from '../db.js';

/**
 * instrument_tracking maintenance (T12 — INV-1, INV-3).
 *
 * The API manages follower_count and tracking_state.
 * It NEVER writes last_ingested_at — that column is worker-only (INV-3, enforced by DB role T6).
 *
 * Semantic: follower_count = count of DISTINCT users tracking this instrument
 * (not watchlist items — a user with 2 watchlists counts once per user).
 */

/**
 * Called when a user adds an instrument to any of their watchlists.
 * Upserts tracking; increments follower_count only when the user is newly tracking.
 * Uses a dedicated function to compute the distinct-user count correctly.
 */
export async function onItemAdded(
  client: Pool | PoolClient,
  userId: bigint,
  instrumentId: bigint,
): Promise<void> {
  // Recompute follower_count from source of truth to stay consistent.
  await upsertTrackingFromCount(client, instrumentId);
}

/**
 * Called when a user removes an instrument from one of their watchlists.
 * Decrements follower_count (may set IDLE) only when the user no longer tracks it at all.
 */
export async function onItemRemoved(
  client: Pool | PoolClient,
  userId: bigint,
  instrumentId: bigint,
): Promise<void> {
  await upsertTrackingFromCount(client, instrumentId);
}

/**
 * Recomputes follower_count from watchlist_items for one instrument.
 * This is the reconciliation function — safe to call at any time.
 */
async function upsertTrackingFromCount(
  client: Pool | PoolClient,
  instrumentId: bigint,
): Promise<void> {
  // Count distinct users currently tracking this instrument.
  const { rows } = await query<{ cnt: string }>(
    client,
    `SELECT COUNT(DISTINCT w.user_id) AS cnt
     FROM watchlist_items wi
     JOIN watchlists w ON w.id = wi.watchlist_id
     WHERE wi.instrument_id = $1`,
    [instrumentId],
  );
  const followerCount = parseInt(rows[0]?.cnt ?? '0', 10);
  const trackingState = followerCount > 0 ? 'ACTIVE' : 'IDLE';
  const priority = followerCount; // simple: more followers = higher priority

  await query(
    client,
    `INSERT INTO instrument_tracking (instrument_id, tracking_state, follower_count, priority, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (instrument_id) DO UPDATE
       SET tracking_state = EXCLUDED.tracking_state,
           follower_count = EXCLUDED.follower_count,
           priority       = EXCLUDED.priority,
           updated_at     = NOW()`,
    // Note: last_ingested_at is NOT included — worker-only column (INV-3).
    [instrumentId, trackingState, followerCount, priority],
  );
}

/**
 * Full reconciliation: recomputes follower_count for every instrument in tracking.
 * A no-op on consistent data; corrects drifted counts.
 */
export async function reconcileAllTracking(client: Pool | PoolClient): Promise<void> {
  await query(
    client,
    `WITH counts AS (
       SELECT wi.instrument_id,
              COUNT(DISTINCT w.user_id) AS follower_count
       FROM watchlist_items wi
       JOIN watchlists w ON w.id = wi.watchlist_id
       GROUP BY wi.instrument_id
     )
     INSERT INTO instrument_tracking (instrument_id, tracking_state, follower_count, priority, updated_at)
     SELECT
       c.instrument_id,
       CASE WHEN c.follower_count > 0 THEN 'ACTIVE'::tracking_state ELSE 'IDLE'::tracking_state END,
       c.follower_count,
       c.follower_count,
       NOW()
     FROM counts c
     ON CONFLICT (instrument_id) DO UPDATE
       SET tracking_state = EXCLUDED.tracking_state,
           follower_count = EXCLUDED.follower_count,
           priority       = EXCLUDED.priority,
           updated_at     = NOW()`,
    [],
  );
}
