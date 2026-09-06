import { loadConfig } from '../config.js';
import { createPool } from '../db.js';
import { createAlpacaClient } from '../provider/alpaca/client.js';
import { AlpacaAdapter } from '../provider/alpaca/adapter.js';
import { syncInstrumentCatalog } from './sync.js';

/**
 * Entrypoint for the catalog sync (`npm run sync:catalog -w worker`).
 *
 * A standalone command rather than a queued job: `worker/src/main.ts`'s scheduler is
 * still a placeholder, and this needs no per-instrument fan-out. Run it on whatever
 * schedule you like (daily is what the underlying data justifies) — it is idempotent.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL);
  const adapter = new AlpacaAdapter(
    createAlpacaClient({
      keyId: config.ALPACA_API_KEY_ID,
      secret: config.ALPACA_API_SECRET_KEY,
      feed: config.ALPACA_FEED,
    }),
  );

  try {
    const result = await syncInstrumentCatalog(pool, adapter);
    console.log(JSON.stringify({ event: 'catalog_synced', ...result }));
    if (result.fetched === 0) {
      console.error(JSON.stringify({
        event: 'catalog_sync_empty',
        msg: 'provider returned no assets; catalog left untouched',
      }));
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ event: 'catalog_sync_failed', error: (err as Error).message }));
  process.exit(1);
});
