/**
 * T11 — watchlist add-item tests (INV-1, INV-2, INV-3)
 *
 * No outbound HTTP occurs on this path.
 * Requires a live DB: DATABASE_URL env var.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { registerAuthRoutes } from '../src/auth/routes.js';
import { registerWatchlistRoutes } from '../src/watchlists/routes.js';
import { SESSION_COOKIE_NAME } from '../src/auth/middleware.js';
import { getPool, _resetPool } from '../src/db.js';

pg.types.setTypeParser(1700 as pg.TypeId, (v: string) => v);

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb('T11 — watchlist add-item', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    _resetPool();
    pool = getPool(DATABASE_URL!);

    app = Fastify({ logger: false });
    await app.register(fastifyCookie);
    await registerAuthRoutes(app, pool);
    await registerWatchlistRoutes(app, pool);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    _resetPool();
  });

  // Each test uses its own account to avoid cross-test pollution.
  async function registerAndLogin(suffix: string): Promise<{ token: string; watchlistId: string }> {
    const email = `additem_${suffix}_${Date.now()}@example.com`;
    await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { email, password: 'testpassword123' },
    });
    const loginRes = await app.inject({
      method: 'POST', url: '/auth/login',
      payload: { email, password: 'testpassword123' },
    });
    const token = (loginRes.headers['set-cookie'] as string).split(';')[0].split('=')[1];

    const wlRes = await app.inject({
      method: 'POST', url: '/watchlists',
      cookies: { [SESSION_COOKIE_NAME]: token },
      payload: { name: 'My list' },
    });
    const wlId = (JSON.parse(wlRes.body) as { id: string }).id;
    return { token, watchlistId: wlId };
  }

  it('adding an unknown symbol returns 201 with state: WARMING — no outbound HTTP', async () => {
    const { token, watchlistId } = await registerAndLogin('warming');

    const res = await app.inject({
      method: 'POST',
      url: `/watchlists/${watchlistId}/items`,
      cookies: { [SESSION_COOKIE_NAME]: token },
      payload: { symbol: 'UNKNOWNSYM' },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { state: string };
    expect(body.state).toBe('WARMING');
  });

  it('duplicate add is idempotent — no second row in watchlist_items', async () => {
    const { token, watchlistId } = await registerAndLogin('dup');

    const res1 = await app.inject({
      method: 'POST',
      url: `/watchlists/${watchlistId}/items`,
      cookies: { [SESSION_COOKIE_NAME]: token },
      payload: { symbol: 'DUPSYM' },
    });
    const res2 = await app.inject({
      method: 'POST',
      url: `/watchlists/${watchlistId}/items`,
      cookies: { [SESSION_COOKIE_NAME]: token },
      payload: { symbol: 'DUPSYM' },
    });
    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(201);

    // Should be exactly 1 watchlist_item row.
    const { rows } = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM watchlist_items WHERE watchlist_id = $1`, [watchlistId],
    );
    expect(parseInt(rows[0].cnt, 10)).toBe(1);
  });

  it('enqueued resolve_instrument job carries an idempotency_key', async () => {
    const { token, watchlistId } = await registerAndLogin('idem');
    const symbol = `IDEMKEY${Date.now()}`;

    await app.inject({
      method: 'POST',
      url: `/watchlists/${watchlistId}/items`,
      cookies: { [SESSION_COOKIE_NAME]: token },
      payload: { symbol },
    });

    const { rows } = await pool.query<{ idempotency_key: string; job_type: string }>(
      `SELECT idempotency_key, job_type FROM jobs WHERE idempotency_key = $1`,
      [`resolve:${symbol}`],
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].job_type).toBe('resolve_instrument');
    expect(rows[0].idempotency_key).toBe(`resolve:${symbol}`);
  });
});
