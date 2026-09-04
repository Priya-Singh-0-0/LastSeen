import type { Pool, PoolClient } from '../db.js';
import { query } from '../db.js';

/**
 * Watchlist repository (T10 — INV-15).
 * Every function verifies ownership — never return or mutate another user's data.
 * Returns null/undefined on not-found (the route layer returns 404, not 403).
 */

export interface WatchlistRow {
  id: string;
  userId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Create a new watchlist owned by userId. */
export async function createWatchlist(
  client: Pool | PoolClient,
  userId: bigint,
  name: string,
): Promise<WatchlistRow> {
  const { rows } = await query<WatchlistRow>(
    client,
    `INSERT INTO watchlists (user_id, name)
     VALUES ($1, $2)
     RETURNING id, user_id AS "userId", name, created_at AS "createdAt", updated_at AS "updatedAt"`,
    [userId, name],
  );
  return rows[0];
}

/** List all watchlists owned by a user. */
export async function listWatchlists(
  client: Pool | PoolClient,
  userId: bigint,
): Promise<WatchlistRow[]> {
  const { rows } = await query<WatchlistRow>(
    client,
    `SELECT id, user_id AS "userId", name, created_at AS "createdAt", updated_at AS "updatedAt"
     FROM watchlists
     WHERE user_id = $1
     ORDER BY created_at`,
    [userId],
  );
  return rows;
}

/** Get a single watchlist, only if owned by userId. Returns null on miss or wrong owner. */
export async function getWatchlist(
  client: Pool | PoolClient,
  userId: bigint,
  watchlistId: bigint,
): Promise<WatchlistRow | null> {
  const { rows } = await query<WatchlistRow>(
    client,
    `SELECT id, user_id AS "userId", name, created_at AS "createdAt", updated_at AS "updatedAt"
     FROM watchlists
     WHERE id = $1 AND user_id = $2`,
    [watchlistId, userId],
  );
  return rows[0] ?? null;
}

/** Rename a watchlist, only if owned by userId. Returns false if not found. */
export async function renameWatchlist(
  client: Pool | PoolClient,
  userId: bigint,
  watchlistId: bigint,
  name: string,
): Promise<boolean> {
  const { rowCount } = await query(
    client,
    `UPDATE watchlists SET name = $1, updated_at = NOW()
     WHERE id = $2 AND user_id = $3`,
    [name, watchlistId, userId],
  );
  return (rowCount ?? 0) > 0;
}

/** Delete a watchlist, only if owned by userId. Returns false if not found. */
export async function deleteWatchlist(
  client: Pool | PoolClient,
  userId: bigint,
  watchlistId: bigint,
): Promise<boolean> {
  const { rowCount } = await query(
    client,
    `DELETE FROM watchlists WHERE id = $1 AND user_id = $2`,
    [watchlistId, userId],
  );
  return (rowCount ?? 0) > 0;
}

/** List items in a watchlist, only if owned by userId. Returns null on wrong owner. */
export async function listWatchlistItems(
  client: Pool | PoolClient,
  userId: bigint,
  watchlistId: bigint,
): Promise<Array<{ id: string; instrumentId: string; addedAt: Date }> | null> {
  // Ownership check via JOIN.
  const { rows: wl } = await query<{ id: string }>(
    client, `SELECT id FROM watchlists WHERE id = $1 AND user_id = $2`, [watchlistId, userId],
  );
  if (wl.length === 0) return null;

  const { rows } = await query<{ id: string; instrumentId: string; addedAt: Date }>(
    client,
    `SELECT id, instrument_id AS "instrumentId", added_at AS "addedAt"
     FROM watchlist_items
     WHERE watchlist_id = $1
     ORDER BY added_at`,
    [watchlistId],
  );
  return rows;
}

/** Remove a watchlist item, only if the watchlist is owned by userId. */
export async function removeWatchlistItem(
  client: Pool | PoolClient,
  userId: bigint,
  watchlistId: bigint,
  itemId: bigint,
): Promise<boolean> {
  const { rowCount } = await query(
    client,
    `DELETE FROM watchlist_items wi
     USING watchlists w
     WHERE wi.id = $1
       AND wi.watchlist_id = $2
       AND w.id = wi.watchlist_id
       AND w.user_id = $3`,
    [itemId, watchlistId, userId],
  );
  return (rowCount ?? 0) > 0;
}
