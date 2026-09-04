import type { Pool, PoolClient } from '../db.js';
import { query } from '../db.js';
import type { MarketStateRow } from './envelope.js';

/**
 * Read-only market queries (T16 — INV-2, INV-3).
 * No writes, no provider calls. Returns raw DB rows for assembly by envelope.ts.
 */

/** Fetch market state for a single instrument. Returns null if none exists. */
export async function getMarketState(
  client: Pool | PoolClient,
  instrumentId: bigint,
): Promise<MarketStateRow | null> {
  const { rows } = await query<MarketStateRow>(
    client,
    `SELECT
       price,
       currency,
       market_timestamp,
       ingested_at,
       source,
       market_status,
       value_kind,
       data_freshness,
       precision_hint
     FROM instrument_market_state
     WHERE instrument_id = $1`,
    [instrumentId],
  );
  return rows[0] ?? null;
}

/** Fetch market state for a batch of instruments (for watchlist list endpoint). */
export async function getMarketStateBatch(
  client: Pool | PoolClient,
  instrumentIds: bigint[],
): Promise<Map<string, MarketStateRow>> {
  if (instrumentIds.length === 0) return new Map();

  const { rows } = await query<MarketStateRow & { instrument_id: string }>(
    client,
    `SELECT
       instrument_id,
       price,
       currency,
       market_timestamp,
       ingested_at,
       source,
       market_status,
       value_kind,
       data_freshness,
       precision_hint
     FROM instrument_market_state
     WHERE instrument_id = ANY($1)`,
    [instrumentIds.map(String)],
  );

  const result = new Map<string, MarketStateRow>();
  for (const row of rows) {
    result.set(row.instrument_id, row);
  }
  return result;
}
