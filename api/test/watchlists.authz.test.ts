/**
 * T10 — watchlist authorization tests (INV-15).
 *
 * cross_user_authorization_denied — parameterized table over all routes.
 * New routes MUST be added here to keep the gate green.
 *
 * Requires a live DB: DATABASE_URL env var.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { registerAuthRoutes } from '../src/auth/routes.js';
import { registerWatchlistRoutes } from '../src/watchlists/routes.js';
import { registerInstrumentRoutes } from '../src/instruments/routes.js';
import { registerCheckpointRoutes } from '../src/checkpoints/routes.js';
import { SESSION_COOKIE_NAME } from '../src/auth/middleware.js';
import { getPool, _resetPool } from '../src/db.js';

pg.types.setTypeParser(1700 as pg.TypeId, (v: string) => v);

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;
const ACK_SECRET = 'test-ack-token-secret-at-least-32-chars-long';

describeWithDb('T10 — cross_user_authorization_denied', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof Fastify>;
  let userAToken: string;
  let userBToken: string;
  let userAWatchlistId: string;
  let userAInstrumentId: string;
  let userAAckToken: string;

  beforeAll(async () => {
    _resetPool();
    pool = getPool(DATABASE_URL!);

    app = Fastify({ logger: false });
    await app.register(fastifyCookie);
    await registerAuthRoutes(app, pool);
    await registerWatchlistRoutes(app, pool);
    await registerInstrumentRoutes(app, pool, ACK_SECRET);
    await registerCheckpointRoutes(app, pool, ACK_SECRET);
    await app.ready();

    // Register user A and B, login, and create a watchlist for user A.
    await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { email: 'authz_a@example.com', password: 'passwordAAAAAA' },
    });
    await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { email: 'authz_b@example.com', password: 'passwordBBBBBB' },
    });

    const loginA = await app.inject({
      method: 'POST', url: '/auth/login',
      payload: { email: 'authz_a@example.com', password: 'passwordAAAAAA' },
    });
    const loginB = await app.inject({
      method: 'POST', url: '/auth/login',
      payload: { email: 'authz_b@example.com', password: 'passwordBBBBBB' },
    });

    userAToken = (loginA.headers['set-cookie'] as string).split(';')[0].split('=')[1];
    userBToken = (loginB.headers['set-cookie'] as string).split(';')[0].split('=')[1];

    // Create a watchlist as user A.
    const wlRes = await app.inject({
      method: 'POST', url: '/watchlists',
      cookies: { [SESSION_COOKIE_NAME]: userAToken },
      payload: { name: 'A\'s watchlist' },
    });
    userAWatchlistId = (JSON.parse(wlRes.body) as { id: string }).id;

    // Create an instrument (no market state — WARMING) and add it to A's watchlist directly,
    // bypassing symbol resolution (T30 — instrument-owned routes need coverage here too).
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO instruments (resolution_status) VALUES ('RESOLVED') RETURNING id`,
    );
    userAInstrumentId = rows[0].id;
    await pool.query(
      `INSERT INTO watchlist_items (watchlist_id, instrument_id) VALUES ($1, $2)`,
      [userAWatchlistId, userAInstrumentId],
    );

    const getA = await app.inject({
      method: 'GET', url: `/instruments/${userAInstrumentId}`,
      cookies: { [SESSION_COOKIE_NAME]: userAToken },
    });
    userAAckToken = (JSON.parse(getA.body) as { ackToken: string }).ackToken;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    _resetPool();
  });

  /**
   * Parameterized table — add every user-owned route here.
   * Each entry is [description, method, url factory].
   * User B must receive 404 for every route accessing user A's resource.
   */
  const routes: Array<[string, string, (wlId: string) => string]> = [
    ['GET /watchlists/:id',             'GET',    (id) => `/watchlists/${id}`],
    ['PATCH /watchlists/:id',           'PATCH',  (id) => `/watchlists/${id}`],
    ['DELETE /watchlists/:id',          'DELETE', (id) => `/watchlists/${id}`],
    ['GET /watchlists/:id/items',       'GET',    (id) => `/watchlists/${id}/items`],
    ['POST /watchlists/:id/items',      'POST',   (id) => `/watchlists/${id}/items`],
    ['DELETE /watchlists/:id/items/999','DELETE', (id) => `/watchlists/${id}/items/999`],
  ];

  it.each(routes)(
    'cross_user_authorization_denied: user B → 404 on %s',
    async (_label, method, urlFn) => {
      const res = await app.inject({
        method: method as 'GET' | 'POST' | 'PATCH' | 'DELETE',
        url: urlFn(userAWatchlistId),
        cookies: { [SESSION_COOKIE_NAME]: userBToken },
        payload: method === 'PATCH' ? { name: 'stolen' } : undefined,
      });
      expect(res.statusCode).toBe(404);
    },
  );

  it('cross_user_authorization_denied: user B → 404 on GET /instruments/:id (T30)', async () => {
    const res = await app.inject({
      method: 'GET', url: `/instruments/${userAInstrumentId}`,
      cookies: { [SESSION_COOKIE_NAME]: userBToken },
    });
    expect(res.statusCode).toBe(404);
  });

  it('cross_user_authorization_denied: user B → rejected on POST /instruments/:id/acknowledge with A\'s token (T30)', async () => {
    const res = await app.inject({
      method: 'POST', url: `/instruments/${userAInstrumentId}/acknowledge`,
      cookies: { [SESSION_COOKIE_NAME]: userBToken },
      payload: { ack_token: userAAckToken },
    });
    expect(res.statusCode).toBe(403);
  });

  it('GET /watchlists returns only the authenticated user\'s own watchlists', async () => {
    // Create a watchlist for B.
    await app.inject({
      method: 'POST', url: '/watchlists',
      cookies: { [SESSION_COOKIE_NAME]: userBToken },
      payload: { name: 'B\'s watchlist' },
    });

    const res = await app.inject({
      method: 'GET', url: '/watchlists',
      cookies: { [SESSION_COOKIE_NAME]: userBToken },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Array<{ id: string }>;
    // B's list must not contain A's watchlist.
    expect(body.find((w) => w.id === userAWatchlistId)).toBeUndefined();
  });
});
