import { MarketStatus, DataFreshness } from '@stockwatch/contracts';
import type { Observation, UtcTimestamp } from '@stockwatch/contracts';
import type { Pool, PoolClient } from '../db.js';
import { query } from '../db.js';

/**
 * Feed-lag thresholds (T36 — INV-11), a judgment call not an architecture-quoted constant:
 * how long `ingestedAt` may trail `marketTimestamp` before the worker itself downgrades a
 * freshly-ingested observation's freshness, independent of whatever the provider claims.
 */
const DELAYED_AFTER_MS = 5 * 60 * 1000;
const STALE_AFTER_MS = 20 * 60 * 1000;

/**
 * Classifies `data_freshness` at ingestion time from the feed's own lag
 * (`ingestedAt - marketTimestamp`), rather than trusting a provider-supplied value — the
 * worker owns market intelligence, not the provider adapter (CLAUDE.md). Only an `OPEN`
 * market can be downgraded: a `CLOSED` session holding its close, or a `HALTED` last trade,
 * is legitimately `FRESH` regardless of elapsed time (architecture §I).
 */
export function classifyFreshness(
  marketStatus: MarketStatus,
  marketTimestamp: UtcTimestamp,
  ingestedAt: UtcTimestamp,
): DataFreshness {
  if (marketStatus !== MarketStatus.OPEN) return DataFreshness.FRESH;
  const lagMs = ingestedAt - marketTimestamp;
  if (lagMs >= STALE_AFTER_MS) return DataFreshness.STALE;
  if (lagMs >= DELAYED_AFTER_MS) return DataFreshness.DELAYED;
  return DataFreshness.FRESH;
}

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
  const dataFreshness = classifyFreshness(obs.marketStatus, obs.marketTimestamp, obs.ingestedAt);
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
      dataFreshness,
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
