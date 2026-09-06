/**
 * T-decouple — viewing registers ingestion demand (architecture §D: "Tracking is API-owned
 * because it expresses demand, not market fact").
 *
 * Before this change, `GET /instruments/by-symbol/:symbol` for a catalog symbol nobody had
 * starred returned an identity-only ("tier 2") sheet with `instrumentId: null` — nothing would
 * ever ingest it, so the UI's "Warming up…" never resolved. Now the first view of such a symbol
 * registers the instrument + a low-priority ACTIVE `instrument_tracking` row
 * (`tracking_source = 'VIEWED'`) and enqueues the same jobs a watchlist add would, without
 * creating any watchlist membership.
 *
 * Requires a live DB: DATABASE_URL (stockwatch_api role, used for the actual HTTP requests)
 * and TEST_DATABASE_URL (superuser, used to seed `instrument_catalog` and to clean up jobs —
 * the API role has no DELETE grant on jobs, T6).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { registerAuthRoutes } from '../src/auth/routes.js';
import { registerWatchlistRoutes } from '../src/watchlists/routes.js';
import { registerInstrumentRoutes } from '../src/instruments/routes.js';
import { SESSION_COOKIE_NAME } from '../src/auth/middleware.js';
import { getPool, _resetPool } from '../src/db.js';

pg.types.setTypeParser(1700 as pg.TypeId, (v: string) => v);

const DATABASE_URL = process.env.DATABASE_URL;
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDb = DATABASE_URL && TEST_DATABASE_URL ? describe : describe.skip;
const ACK_SECRET = 'test-ack-token-secret-at-least-32-chars-long';

describeWithDb('T-decouple — GET /instruments/by-symbol/:symbol registers view demand', () => {
  let pool: pg.Pool; // stockwatch_api role
  let setupPool: pg.Pool; // superuser
  let app: ReturnType<typeof Fastify>;
  let testsStartedAt: Date;

  beforeAll(async () => {
    _resetPool();
    pool = getPool(DATABASE_URL!);
    setupPool = new pg.Pool({ connectionString: TEST_DATABASE_URL! });

    app = Fastify({ logger: false });
    await app.register(fastifyCookie);
    await registerAuthRoutes(app, pool);
    await registerWatchlistRoutes(app, pool);
    await registerInstrumentRoutes(app, pool, ACK_SECRET);
    await app.ready();
    testsStartedAt = new Date();
  });

  afterAll(async () => {
    await setupPool.query('DELETE FROM jobs WHERE created_at >= $1', [testsStartedAt]);
    await app.close();
    await pool.end();
    await setupPool.end();
    _resetPool();
  });

  async function registerAndLogin(suffix: string): Promise<string> {
    const email = `viewdemand_${suffix}_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
    await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { email, password: 'testpassword123' },
    });
    const loginRes = await app.inject({
      method: 'POST', url: '/auth/login',
      payload: { email, password: 'testpassword123' },
    });
    return (loginRes.headers['set-cookie'] as string).split(';')[0].split('=')[1];
  }

  async function seedCatalogSymbol(symbol: string, name: string): Promise<void> {
    await setupPool.query(
      `INSERT INTO instrument_catalog (symbol, name, exchange, asset_class, status, tradable)
       VALUES ($1, $2, 'NASDAQ', 'us_equity', 'active', TRUE)
       ON CONFLICT (symbol) DO NOTHING`,
      [symbol, name],
    );
  }

  async function getTracking(instrumentId: string): Promise<{
    tracking_state: string;
    tracking_source: string;
    follower_count: number;
    priority: number;
  } | null> {
    const { rows } = await setupPool.query(
      `SELECT tracking_state, tracking_source, follower_count, priority
       FROM instrument_tracking WHERE instrument_id = $1`,
      [instrumentId],
    );
    return rows[0] ?? null;
  }

  it('a never-viewed, never-starred catalog symbol registers an instrument and ACTIVE/VIEWED tracking', async () => {
    const token = await registerAndLogin('a');
    const symbol = `VD${Date.now()}`;
    await seedCatalogSymbol(symbol, 'View Demand Test Corp');

    const res = await app.inject({
      method: 'GET', url: `/instruments/by-symbol/${symbol}`,
      cookies: { [SESSION_COOKIE_NAME]: token },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { instrumentId: string | null; symbol: string; comparisonStatus: string };

    // No longer identity-only: an instrument row now exists.
    expect(body.instrumentId).not.toBeNull();
    expect(body.symbol).toBe(symbol);
    expect(body.comparisonStatus).toBe('AWAITING_BASELINE'); // no market state yet — still WARMING

    const tracking = await getTracking(body.instrumentId!);
    expect(tracking).not.toBeNull();
    expect(tracking!.tracking_state).toBe('ACTIVE');
    expect(tracking!.tracking_source).toBe('VIEWED');
    expect(tracking!.follower_count).toBe(0); // viewing is not watchlist membership
    expect(tracking!.priority).toBe(0); // low priority relative to a starred instrument

    // No watchlist membership was created by viewing.
    const { rows: items } = await setupPool.query(
      `SELECT 1 FROM watchlist_items WHERE instrument_id = $1`,
      [body.instrumentId],
    );
    expect(items).toHaveLength(0);
  });

  it('an ingest job is enqueued for a symbol registered purely by viewing', async () => {
    const token = await registerAndLogin('b');
    const symbol = `VDJ${Date.now()}`;
    await seedCatalogSymbol(symbol, 'View Demand Job Test Corp');

    const res = await app.inject({
      method: 'GET', url: `/instruments/by-symbol/${symbol}`,
      cookies: { [SESSION_COOKIE_NAME]: token },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { instrumentId: string };

    const { rows: jobs } = await setupPool.query<{ job_type: string }>(
      `SELECT job_type FROM jobs WHERE payload->>'instrumentId' = $1`,
      [body.instrumentId],
    );
    const jobTypes = jobs.map((j) => j.job_type);
    expect(jobTypes).toContain('resolve_instrument');
    expect(jobTypes).toContain('backfill_bars');
  });

  it('viewing the same symbol twice does not duplicate the instrument or tracking row', async () => {
    const token = await registerAndLogin('c');
    const symbol = `VDD${Date.now()}`;
    await seedCatalogSymbol(symbol, 'View Demand Dedupe Test Corp');

    const res1 = await app.inject({
      method: 'GET', url: `/instruments/by-symbol/${symbol}`,
      cookies: { [SESSION_COOKIE_NAME]: token },
    });
    const res2 = await app.inject({
      method: 'GET', url: `/instruments/by-symbol/${symbol}`,
      cookies: { [SESSION_COOKIE_NAME]: token },
    });
    const body1 = JSON.parse(res1.body) as { instrumentId: string };
    const body2 = JSON.parse(res2.body) as { instrumentId: string };
    expect(body2.instrumentId).toBe(body1.instrumentId);

    const { rows } = await setupPool.query(
      `SELECT 1 FROM instrument_tracking WHERE instrument_id = $1`,
      [body1.instrumentId],
    );
    expect(rows).toHaveLength(1);
  });

  it('starring a previously view-only instrument promotes tracking_source to STARRED and raises priority', async () => {
    const token = await registerAndLogin('d');
    const symbol = `VDS${Date.now()}`;
    await seedCatalogSymbol(symbol, 'View Then Star Test Corp');

    const viewRes = await app.inject({
      method: 'GET', url: `/instruments/by-symbol/${symbol}`,
      cookies: { [SESSION_COOKIE_NAME]: token },
    });
    const { instrumentId } = JSON.parse(viewRes.body) as { instrumentId: string };

    const before = await getTracking(instrumentId);
    expect(before!.tracking_source).toBe('VIEWED');
    expect(before!.priority).toBe(0);

    const wlRes = await app.inject({
      method: 'POST', url: '/watchlists',
      cookies: { [SESSION_COOKIE_NAME]: token },
      payload: { name: `wl-star-${Date.now()}` },
    });
    const wlId = (JSON.parse(wlRes.body) as { id: string }).id;

    const addRes = await app.inject({
      method: 'POST', url: `/watchlists/${wlId}/items`,
      cookies: { [SESSION_COOKIE_NAME]: token },
      payload: { symbol },
    });
    expect(addRes.statusCode).toBe(201);

    const after = await getTracking(instrumentId);
    expect(after!.tracking_source).toBe('STARRED');
    expect(after!.tracking_state).toBe('ACTIVE');
    expect(after!.follower_count).toBe(1);
    expect(after!.priority).toBeGreaterThan(before!.priority);
  });

  it('an unknown symbol not in the catalog still 404s (no instrument invented for garbage input)', async () => {
    const token = await registerAndLogin('e');
    const res = await app.inject({
      method: 'GET', url: `/instruments/by-symbol/NOTAREALSYMBOLXYZ`,
      cookies: { [SESSION_COOKIE_NAME]: token },
    });
    expect(res.statusCode).toBe(404);
  });
});
