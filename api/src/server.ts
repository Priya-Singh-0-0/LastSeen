import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { loadConfig } from './config.js';
import { getPool } from './db.js';
import { registerAuthRoutes } from './auth/routes.js';
import { registerWatchlistRoutes } from './watchlists/routes.js';
import type { Pool } from './db.js';

/**
 * Build the Fastify app with all routes registered.
 * Accepts an optional pool override so tests can inject a test pool.
 */
export async function buildApp(pool: Pool) {
  const app = Fastify({ logger: true });

  await app.register(fastifyCookie);

  app.get('/health', async () => ({ status: 'ok' }));

  await registerAuthRoutes(app, pool);
  await registerWatchlistRoutes(app, pool);

  return app;
}

// ─── Entry point ─────────────────────────────────────────────────────────────
const config = loadConfig();
const pool = getPool(config.DATABASE_URL);

buildApp(pool).then((app) => {
  app.listen({ port: config.PORT, host: '0.0.0.0' }, (err) => {
    if (err) { app.log.error(err); process.exit(1); }
  });
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
