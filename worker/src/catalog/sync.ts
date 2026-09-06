import type { AssetRef } from '@stockwatch/contracts';
import type { Pool, PoolClient } from '../db.js';
import { query } from '../db.js';
import type { ProviderAdapter } from '../provider/index.js';

/**
 * Instrument-catalog sync — the write side of symbol search.
 *
 * The provider's asset master is reference data, so this is a full replace-by-upsert
 * of ~11k rows rather than an incremental feed: one provider call, one transaction,
 * no per-user or per-watchlist fan-out. Re-running it is a no-op beyond refreshing
 * `synced_at`, which is what makes it safe to schedule and safe to retry.
 *
 * Rows the provider no longer lists are marked `status = 'inactive'` rather than
 * deleted — a delisted symbol is a fact worth keeping, and search filters on status.
 */

export interface CatalogSyncResult {
  readonly fetched: number;
  readonly upserted: number;
  readonly deactivated: number;
}

/** Rows per INSERT. Keeps the parameter count well under Postgres' 65535 limit. */
const BATCH_SIZE = 500;

export async function syncInstrumentCatalog(
  pool: Pool,
  adapter: ProviderAdapter,
  now: Date = new Date(),
): Promise<CatalogSyncResult> {
  const assets = await adapter.fetchAssets();

  // An empty provider response is never treated as "the market has no symbols" —
  // deactivating the whole catalog on a bad response would silently break search.
  if (assets.length === 0) {
    return { fetched: 0, upserted: 0, deactivated: 0 };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let upserted = 0;
    for (let i = 0; i < assets.length; i += BATCH_SIZE) {
      upserted += await upsertBatch(client, assets.slice(i, i + BATCH_SIZE), now);
    }

    const deactivated = await deactivateMissing(client, now);

    await client.query('COMMIT');
    return { fetched: assets.length, upserted, deactivated };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function upsertBatch(
  client: PoolClient,
  batch: readonly AssetRef[],
  now: Date,
): Promise<number> {
  const params: unknown[] = [];
  const tuples = batch.map((asset, index) => {
    const base = index * 7;
    params.push(
      asset.symbol,
      asset.name,
      asset.exchange,
      asset.assetClass,
      asset.status,
      asset.tradable,
      now,
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
  });

  const { rowCount } = await query(
    client,
    `INSERT INTO instrument_catalog (symbol, name, exchange, asset_class, status, tradable, synced_at)
     VALUES ${tuples.join(', ')}
     ON CONFLICT (symbol) DO UPDATE SET
       name        = EXCLUDED.name,
       exchange    = EXCLUDED.exchange,
       asset_class = EXCLUDED.asset_class,
       status      = EXCLUDED.status,
       tradable    = EXCLUDED.tradable,
       synced_at   = EXCLUDED.synced_at`,
    params,
  );
  return rowCount ?? 0;
}

/** Any row this run did not touch is no longer listed by the provider. */
async function deactivateMissing(client: PoolClient, now: Date): Promise<number> {
  const { rowCount } = await query(
    client,
    `UPDATE instrument_catalog
        SET status = 'inactive', tradable = FALSE
      WHERE synced_at < $1 AND status <> 'inactive'`,
    [now],
  );
  return rowCount ?? 0;
}
