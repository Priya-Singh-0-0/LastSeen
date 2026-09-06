import type { Pool, PoolClient } from '../db.js';
import { query } from '../db.js';
import type { ProviderAdapter } from '../provider/index.js';

/**
 * Popular-stocks sync — the write side of the watchlist's empty-state suggestion board
 * (defect 8).
 *
 * `popular_stocks` is small (top N) and always meant to reflect only the provider's
 * latest screener read, so unlike the instrument catalog this is a full
 * truncate-and-replace inside one transaction rather than an incremental upsert — there
 * is no "deactivated" row to preserve, a symbol either is or isn't on the current list.
 */

export const DEFAULT_POPULAR_LIMIT = 30;

export interface PopularSyncResult {
  readonly fetched: number;
}

export async function syncPopularStocks(
  pool: Pool,
  adapter: ProviderAdapter,
  limit: number = DEFAULT_POPULAR_LIMIT,
): Promise<PopularSyncResult> {
  const actives = await adapter.fetchMostActives(limit);

  // An empty provider response leaves the existing board alone — the empty-state
  // suggestion board disappearing entirely reads as broken, not as "no popular stocks".
  if (actives.length === 0) {
    return { fetched: 0 };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE popular_stocks');
    await insertBatch(client, actives);
    await client.query('COMMIT');
    return { fetched: actives.length };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export interface SchedulerHandle {
  stop(): void;
}

/**
 * Starts the recurring popular-stocks sync loop, on its own (slower) cadence from the
 * snapshot scheduler (defect 1) — a most-actives ranking does not meaningfully change
 * every 10 minutes the way a price does. Runs one sync immediately, then every
 * `intervalMs`; a failed sync is logged and retried on the next tick, never thrown.
 */
export function startPopularScheduler(
  pool: Pool,
  adapter: ProviderAdapter,
  intervalMs: number,
  limit: number = DEFAULT_POPULAR_LIMIT,
): SchedulerHandle {
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const result = await syncPopularStocks(pool, adapter, limit);
      console.log(JSON.stringify({ event: 'popular_sync_tick', ...result }));
    } catch (err) {
      console.error(JSON.stringify({ event: 'popular_sync_tick_failed', error: (err as Error).message }));
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);

  return {
    stop(): void {
      clearInterval(timer);
    },
  };
}

async function insertBatch(
  client: PoolClient,
  actives: readonly { symbol: string; rank: number; tradeCount: number; volume: number }[],
): Promise<void> {
  const params: unknown[] = [];
  const tuples = actives.map((a, index) => {
    const base = index * 4;
    params.push(a.symbol, a.rank, a.tradeCount, a.volume);
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
  });

  await query(
    client,
    `INSERT INTO popular_stocks (symbol, rank, trade_count, volume)
     VALUES ${tuples.join(', ')}`,
    params,
  );
}
