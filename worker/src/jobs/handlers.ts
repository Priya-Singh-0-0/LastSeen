import type { PoolClient } from '../db.js';

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
export function buildHandlers(): Map<string, JobHandler> {
  const handlers = new Map<string, JobHandler>();

  // resolve_instrument — placeholder until T15/T37 (AlpacaAdapter).
  handlers.set('resolve_instrument', async (payload, _client) => {
    // In v1 the actual provider call happens in the ingestion loop, not here.
    // This handler is a no-op until the AlpacaAdapter is wired in (T37).
    const { instrumentId, symbol } = payload as { instrumentId: string; symbol: string };
    console.log(JSON.stringify({ event: 'resolve_instrument_noop', instrumentId, symbol }));
  });

  // backfill_bars — placeholder until T17.
  handlers.set('backfill_bars', async (payload, _client) => {
    const { instrumentId, symbol } = payload as { instrumentId: string; symbol: string };
    console.log(JSON.stringify({ event: 'backfill_bars_noop', instrumentId, symbol }));
  });

  return handlers;
}
