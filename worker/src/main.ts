import { loadConfig } from './config.js';
import { createPool } from './db.js';

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

  // Graceful shutdown
  const shutdown = async () => {
    console.log(JSON.stringify({ event: 'worker_shutting_down' }));
    await pool.end();
    process.exit(0);
  };
  process.once('SIGINT',  () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });

  // Scheduler loop placeholder — filled in T13+
  console.log(JSON.stringify({ event: 'worker_idle', msg: 'scheduler not yet implemented' }));
}

main().catch(err => {
  console.error(JSON.stringify({ event: 'worker_fatal', error: (err as Error).message }));
  process.exit(1);
});
