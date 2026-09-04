import type { Observation } from '@stockwatch/contracts';
import type { Pool, PoolClient } from '../db.js';
import { query } from '../db.js';

/**
 * Monotonic-guarded market state upsert (T15 — INV-4, INV-5, INV-11).
 *
 * The WHERE predicate `excluded.market_timestamp > instrument_market_state.market_timestamp`
 * ensures an older observation can never overwrite newer state (INV-4).
 *
 * All three semantic envelope columns (market_status, value_kind, data_freshness) are
 * written together — never partially (INV-11).
 *
 * Running the same observation twice is a no-op (INV-5).
 */
export async function upsertMarketState(
  client: Pool | PoolClient,
  instrumentId: bigint,
  obs: Observation,
): Promise<{ written: boolean }> {
  const result = await query(
    client,
    `INSERT INTO instrument_market_state (
       instrument_id,
       price,
       currency,
       market_timestamp,
       last_observed_market_ts,
       ingested_at,
       source,
       market_status,
       value_kind,
       data_freshness,
       session_date,
       open,
       high,
       low,
       volume,
       prev_close,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
     ON CONFLICT (instrument_id) DO UPDATE
       SET price                 = EXCLUDED.price,
           currency              = EXCLUDED.currency,
           market_timestamp      = EXCLUDED.market_timestamp,
           last_observed_market_ts = EXCLUDED.last_observed_market_ts,
           ingested_at           = EXCLUDED.ingested_at,
           source                = EXCLUDED.source,
           market_status         = EXCLUDED.market_status,
           value_kind            = EXCLUDED.value_kind,
           data_freshness        = EXCLUDED.data_freshness,
           session_date          = EXCLUDED.session_date,
           open                  = EXCLUDED.open,
           high                  = EXCLUDED.high,
           low                   = EXCLUDED.low,
           volume                = EXCLUDED.volume,
           prev_close            = EXCLUDED.prev_close,
           updated_at            = NOW()
       WHERE EXCLUDED.market_timestamp > instrument_market_state.market_timestamp`,
    [
      instrumentId,
      obs.price.toFixed(6),
      obs.currency,
      new Date(obs.marketTimestamp),
      new Date(obs.ingestedAt),
      obs.source,
      obs.marketStatus,
      obs.valueKind,
      obs.dataFreshness,
      null,            // session_date: set by backfill_bars job (T17)
      obs.open?.toFixed(6) ?? null,
      obs.high?.toFixed(6) ?? null,
      obs.low?.toFixed(6) ?? null,
      obs.volume ? String(BigInt(obs.volume.toFixed(0))) : null,
      obs.prevClose?.toFixed(6) ?? null,
    ],
  );

  // If rowCount is 0, the WHERE predicate rejected the update (older observation).
  return { written: (result.rowCount ?? 0) > 0 };
}
