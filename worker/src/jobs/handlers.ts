import type { PoolClient } from '../db.js';
import type { ProviderAdapter } from '../provider/index.js';
import { upsertDailyBars } from '../persist/bars.js';

/**
 * Job handler type (T13).
 * Each handler receives the job payload and a live PoolClient inside a transaction.
 * Throw to signal failure; the queue will retry per the backoff policy.
 */
export type JobHandler = (
  payload: Record<string, unknown>,
  client: PoolClient,
) => Promise<void>;

/**
 * Build the handler registry.
 * Handlers are added here as subsequent tasks implement them (T15+).
 * Unknown job types are failed immediately by queue.ts.
 */
export function buildHandlers(provider?: ProviderAdapter): Map<string, JobHandler> {
  const handlers = new Map<string, JobHandler>();

  // resolve_instrument — placeholder until T15/T37 (AlpacaAdapter).
  handlers.set('resolve_instrument', async (payload) => {
    // In v1 the actual provider call happens in the ingestion loop, not here.
    // This handler is a no-op until the AlpacaAdapter is wired in (T37).
    const { instrumentId, symbol } = payload as { instrumentId: string; symbol: string };
    console.log(JSON.stringify({ event: 'resolve_instrument_noop', instrumentId, symbol }));
  });

  // backfill_bars — implemented in T17
  handlers.set('backfill_bars', async (payload, client) => {
    const { instrumentId, symbol } = payload as { instrumentId: string; symbol: string };
    if (!provider) {
      console.log(JSON.stringify({ event: 'backfill_bars_skipped', instrumentId, symbol }));
      return;
    }

    // Fetch roughly 2 years of data
    const toDate = new Date().toISOString().slice(0, 10);
    const fromDate = new Date(Date.now() - 600 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const bars = await provider.fetchDailyBars(symbol, fromDate, toDate);
    const fixedBars = bars.map(b => ({ ...b, instrumentId }));

    await upsertDailyBars(client, fixedBars, 'adapter');
    console.log(JSON.stringify({ event: 'backfill_bars_done', instrumentId, count: fixedBars.length }));
  });

  return handlers;
}
