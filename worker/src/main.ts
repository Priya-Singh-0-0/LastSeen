import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { createAlpacaClient } from './provider/alpaca/client.js';
import { AlpacaAdapter } from './provider/alpaca/adapter.js';
import { startScheduler } from './scheduler.js';
import { startPopularScheduler } from './popular/sync.js';
import { startJobRunner } from './jobs/runner.js';
import { buildHandlers } from './jobs/handlers.js';
import { createGeminiClient } from './explanation/gemini.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL);

  // Fail fast: verify DB connectivity and that migrations have been run.
  const client = await pool.connect();
  try {
    // The worker never runs migrations — it fails fast if they haven't been applied.
    const { rows } = await client.query<{ name: string }>(
      `SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1`,
    );
    const latest = rows[0]?.name ?? '(none)';
    console.log(JSON.stringify({ event: 'worker_started', latestMigration: latest }));
  } catch (err) {
    const msg = (err as Error).message;
    // schema_migrations missing → migrations not run → fail loudly
    console.error(JSON.stringify({ event: 'worker_start_failed', error: msg }));
    await pool.end();
    process.exit(1);
  } finally {
    client.release();
  }

  const adapter = new AlpacaAdapter(
    createAlpacaClient({
      keyId: config.ALPACA_API_KEY_ID,
      secret: config.ALPACA_API_SECRET_KEY,
      feed: config.ALPACA_FEED,
    }),
  );
  const scheduler = startScheduler(pool, adapter, config.POLL_INTERVAL_MS);
  const popularScheduler = startPopularScheduler(pool, adapter, config.POPULAR_SYNC_INTERVAL_MS);
  // Drains the `jobs` table the API enqueues into. Without this the queue was write-only:
  // every backfill/ingest job the API created sat unclaimed forever.
  // The model renderer is optional (§F.7). No key configured is a supported
  // steady state: every brief is then the deterministic template, and nothing
  // else about the product changes.
  const gemini = config.GEMINI_API_KEY
    ? createGeminiClient({
        apiKey: config.GEMINI_API_KEY,
        model: config.GEMINI_MODEL,
        timeoutMs: config.GEMINI_TIMEOUT_MS,
      })
    : null;

  const jobRunner = startJobRunner(pool, buildHandlers(adapter, gemini), config.JOB_POLL_INTERVAL_MS);

  // Graceful shutdown
  const shutdown = async () => {
    console.log(JSON.stringify({ event: 'worker_shutting_down' }));
    scheduler.stop();
    popularScheduler.stop();
    jobRunner.stop();
    await pool.end();
    process.exit(0);
  };
  process.once('SIGINT',  () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });

  console.log(JSON.stringify({
    event: 'worker_started_scheduler',
    intervalMs: config.POLL_INTERVAL_MS,
    popularSyncIntervalMs: config.POPULAR_SYNC_INTERVAL_MS,
    jobPollIntervalMs: config.JOB_POLL_INTERVAL_MS,
    modelRenderer: gemini ? config.GEMINI_MODEL : 'disabled (template-only)',
  }));
}

main().catch(err => {
  console.error(JSON.stringify({ event: 'worker_fatal', error: (err as Error).message }));
  process.exit(1);
});
