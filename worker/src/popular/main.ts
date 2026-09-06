import { loadConfig } from '../config.js';
import { createPool } from '../db.js';
import { createAlpacaClient } from '../provider/alpaca/client.js';
import { AlpacaAdapter } from '../provider/alpaca/adapter.js';
import { syncPopularStocks } from './sync.js';

/**
 * Entrypoint for a one-off popular-stocks sync (`npm run sync:popular -w worker`), mirroring
 * `catalog/main.ts`. The recurring version of this same sync runs inside `main.ts` via
 * `startPopularScheduler` — this script exists so the board can be populated (or refreshed)
 * without running the full worker process.
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
    const result = await syncPopularStocks(pool, adapter);
    console.log(JSON.stringify({ event: 'popular_synced', ...result }));
    if (result.fetched === 0) {
      console.error(JSON.stringify({
        event: 'popular_sync_empty',
        msg: 'provider returned no most-actives; board left untouched',
      }));
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ event: 'popular_sync_failed', error: (err as Error).message }));
  process.exit(1);
});
