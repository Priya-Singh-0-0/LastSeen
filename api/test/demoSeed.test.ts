/**
 * T38 — Demo seed (architecture §P, plan T38).
 *
 * Runs db/seeds/demo.sql (via api/src/seed.ts) against a disposable, freshly migrated
 * database — never against the shared dev/test database other suites use, since the seed
 * is not idempotent (fixed demo user email) and isn't meant to coexist with other tests'
 * fixtures. Requires TEST_DATABASE_URL (superuser — creates/drops the scratch database and
 * runs migrations/seed against it).
 *
 * Named behavior (plan T38 "Done when"): after seeding, the demo user's inbox ranks the
 * intended instrument (TSLA — a large volatility-adjusted move + earnings) first, and the
 * split instrument (AAPL — a 4-for-1 split whose checkpoint baseline predates it) shows an
 * adjusted comparison rather than a suppressed or crashed one.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { runMigrations } from '../src/migrate.js';
import { runDemoSeed } from '../src/seed.js';
import { registerAuthRoutes } from '../src/auth/routes.js';
import { registerInboxRoutes } from '../src/inbox/routes.js';
import { registerInstrumentRoutes } from '../src/instruments/routes.js';
import { SESSION_COOKIE_NAME } from '../src/auth/middleware.js';
import { getPool, _resetPool } from '../src/db.js';

pg.types.setTypeParser(1700 as pg.TypeId, (v: string) => v);

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDb = TEST_DATABASE_URL ? describe : describe.skip;

const ACK_SECRET = 'test-ack-secret';
const SCRATCH_DB = `stockwatch_demo_seed_test_${Date.now()}`;

function withDbName(baseUrl: string, dbName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${dbName}`;
  return url.toString();
}

describeWithDb('T38 — demo seed', () => {
  let adminPool: pg.Pool; // superuser, connected to the default 'postgres' db — can CREATE/DROP DATABASE
  let setupPool: pg.Pool; // superuser, connected to the scratch db — seeding + assertions on raw rows
  let pool: pg.Pool; // stockwatch_api role, connected to the scratch db — the actual HTTP requests
  let app: ReturnType<typeof Fastify>;
  let demoWatchlistId: string;

  beforeAll(async () => {
    const superuserUrl = withDbName(TEST_DATABASE_URL!, SCRATCH_DB);
    const apiUrl = superuserUrl.replace(/\/\/[^@]+@/, '//stockwatch_api:stockwatch_api@');

    adminPool = new pg.Pool({ connectionString: withDbName(TEST_DATABASE_URL!, 'postgres') });
    await adminPool.query(`CREATE DATABASE ${SCRATCH_DB}`);

    // Both use getPool()'s module-level singleton internally — end it before moving on,
    // or its lingering connection to the scratch db gets forcibly killed by afterAll's
    // DROP DATABASE ... WITH (FORCE) and logs a spurious pool error.
    await runMigrations(superuserUrl);
    await runDemoSeed(superuserUrl);
    await getPool(superuserUrl).end();
    _resetPool();

    setupPool = new pg.Pool({ connectionString: superuserUrl });
    pool = getPool(apiUrl);

    app = Fastify({ logger: false });
    await app.register(fastifyCookie);
    await registerAuthRoutes(app, pool);
    await registerInboxRoutes(app, pool);
    await registerInstrumentRoutes(app, pool, ACK_SECRET);
    await app.ready();

    const { rows } = await setupPool.query<{ id: string }>(
      `SELECT id FROM watchlists WHERE name = 'Demo Watchlist'`,
    );
    demoWatchlistId = rows[0]!.id;
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
    await setupPool.end();
    _resetPool();
    await adminPool.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
    await adminPool.end();
  });

  async function loginAsDemoUser(): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'demo@stockwatch.dev', password: 'demo12345' },
    });
    expect(res.statusCode).toBe(200);
    return (res.headers['set-cookie'] as string).split(';')[0]!.split('=')[1]!;
  }

  async function instrumentIdFor(symbol: string): Promise<string> {
    const { rows } = await setupPool.query<{ instrument_id: string }>(
      `SELECT instrument_id FROM instrument_symbols WHERE symbol = $1`,
      [symbol],
    );
    return rows[0]!.instrument_id;
  }

  it('seeds ~30-50 liquid tickers with 400 sessions of bars each', async () => {
    const { rows: countRows } = await setupPool.query<{ count: string }>(
      `SELECT count(*) FROM instruments`,
    );
    const total = Number(countRows[0]!.count);
    expect(total).toBeGreaterThanOrEqual(30);
    expect(total).toBeLessThanOrEqual(50);

    const { rows: barCountRows } = await setupPool.query<{ min: string; max: string }>(
      `SELECT min(c), max(c) FROM (SELECT count(*) c FROM instrument_bars GROUP BY instrument_id) t`,
    );
    expect(Number(barCountRows[0]!.min)).toBe(400);
    expect(Number(barCountRows[0]!.max)).toBe(400);
  });

  it("ranks TSLA (the large volatility-adjusted move + earnings instrument) first in the demo user's inbox", async () => {
    const token = await loginAsDemoUser();
    const tslaId = await instrumentIdFor('TSLA');

    const res = await app.inject({
      method: 'GET',
      url: `/watchlists/${demoWatchlistId}/inbox`,
      cookies: { [SESSION_COOKIE_NAME]: token },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { items: Array<{ instrumentId: string; maxUnseenBand: string | null }> };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0]!.instrumentId).toBe(tslaId);
    expect(body.items[0]!.maxUnseenBand).toBe('URGENT');
  });

  it('shows an adjusted (not suppressed, not crashed) comparison for AAPL across its seeded 4-for-1 split', async () => {
    const token = await loginAsDemoUser();
    const aaplId = await instrumentIdFor('AAPL');

    const res = await app.inject({
      method: 'GET',
      url: `/instruments/${aaplId}`,
      cookies: { [SESSION_COOKIE_NAME]: token },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      comparisonStatus: string;
      percentageChange?: string;
      adjustmentLabels?: readonly string[];
    };

    // Not suppressed, not awaiting a baseline — the adjustment genuinely applied. It is
    // INSUFFICIENT_HISTORY rather than OK because this route always passes sigma20: null
    // (a pre-existing, documented gap — see api/src/instruments/routes.ts and the T30
    // addendum in docs/plans/current-state.md: FeatureExtractor is not wired into any
    // ingestion/persistence path yet, so no read path has a real sigma20 to offer). Per
    // T27, INSUFFICIENT_HISTORY still carries the real percentageChange — only
    // volatilityMultiple is omitted — so the adjustment is exercised for real regardless.
    expect(body.comparisonStatus).toBe('INSUFFICIENT_HISTORY');
    expect(body.percentageChange).toBeDefined();
    // Never a naive, un-adjusted ~-75% crash reading (architecture §O.1).
    expect(Number(body.percentageChange)).toBeGreaterThan(-0.5);
    expect(body.adjustmentLabels).toContain('adjusted for 4-for-1 split');
  });
});
