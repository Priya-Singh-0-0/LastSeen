/**
 * T12 — instrument_tracking maintenance tests (INV-1, INV-3)
 *
 * Requires a live DB: DATABASE_URL env var.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import pg from 'pg';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { registerAuthRoutes } from '../src/auth/routes.js';
import { registerWatchlistRoutes } from '../src/watchlists/routes.js';
import { reconcileAllTracking } from '../src/watchlists/tracking.js';
import { SESSION_COOKIE_NAME } from '../src/auth/middleware.js';
import { getPool, _resetPool } from '../src/db.js';

pg.types.setTypeParser(1700 as pg.TypeId, (v: string) => v);

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb('T12 — instrument_tracking maintenance', () => {
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

  async function registerAndLogin(email: string): Promise<string> {
    const regRes = await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { email, password: 'testpassword123' },
    });
    if (regRes.statusCode !== 201) throw new Error('Register failed: ' + regRes.statusCode + ' ' + regRes.body);
    const res = await app.inject({
      method: 'POST', url: '/auth/login',
      payload: { email, password: 'testpassword123' },
    });
    if (res.statusCode !== 200) throw new Error('Login failed: ' + res.statusCode + ' ' + res.body);
    return (res.headers['set-cookie'] as string).split(';')[0].split('=')[1];
  }

  async function createWatchlist(token: string, name: string): Promise<string> {
    const res = await app.inject({
      method: 'POST', url: '/watchlists',
      cookies: { [SESSION_COOKIE_NAME]: token },
      payload: { name },
    });
    return (JSON.parse(res.body) as { id: string }).id;
  }

  async function addItem(token: string, wlId: string, symbol: string): Promise<string> {
    const res = await app.inject({
      method: 'POST', url: `/watchlists/${wlId}/items`,
      cookies: { [SESSION_COOKIE_NAME]: token },
      payload: { symbol },
    });
    return (JSON.parse(res.body) as { instrumentId: string }).instrumentId;
  }

  async function getFollowerCount(instrumentId: string): Promise<number> {
    const { rows } = await pool.query<{ follower_count: string }>(
      'SELECT follower_count FROM instrument_tracking WHERE instrument_id = $1',
      [instrumentId],
    );
    return parseInt(rows[0]?.follower_count ?? '0', 10);
  }

  async function getTrackingState(instrumentId: string): Promise<string> {
    const { rows } = await pool.query<{ tracking_state: string }>(
      'SELECT tracking_state FROM instrument_tracking WHERE instrument_id = $1',
      [instrumentId],
    );
    return rows[0]?.tracking_state ?? 'IDLE';
  }

  it('same user adding an instrument to two watchlists increments follower_count once', async () => {
    const ts = Date.now();
    const token = await registerAndLogin(`tracking_a_${ts}@example.com`);
    const wl1 = await createWatchlist(token, 'WL1');
    const wl2 = await createWatchlist(token, 'WL2');
    const sym = `TRKONE${ts}`;

    const instrId = await addItem(token, wl1, sym);
    await addItem(token, wl2, sym);

    expect(await getFollowerCount(instrId)).toBe(1); // One distinct user
  });

  it('removing from one of two watchlists leaves follower_count at 1', async () => {
    const ts = Date.now();
    const token = await registerAndLogin(`tracking_b_${ts}@example.com`);
    const wl1 = await createWatchlist(token, 'WL1');
    const wl2 = await createWatchlist(token, 'WL2');
    const sym = `TRKTWO${ts}`;

    const instrId = await addItem(token, wl1, sym);
    await addItem(token, wl2, sym);

    // Fetch item id from wl1 to remove it.
    const { rows } = await pool.query<{ id: string }>(
      'SELECT wi.id FROM watchlist_items wi WHERE wi.watchlist_id = $1 AND wi.instrument_id = $2',
      [wl1, instrId],
    );
    const itemId = rows[0].id;

    await app.inject({
      method: 'DELETE', url: `/watchlists/${wl1}/items/${itemId}`,
      cookies: { [SESSION_COOKIE_NAME]: token },
    });

    expect(await getFollowerCount(instrId)).toBe(1);
    expect(await getTrackingState(instrId)).toBe('ACTIVE');
  });

  it('removing from both watchlists sets tracking_state to IDLE', async () => {
    const ts = Date.now();
    const token = await registerAndLogin(`tracking_c_${ts}@example.com`);
    const wl1 = await createWatchlist(token, 'WL1');
    const wl2 = await createWatchlist(token, 'WL2');
    const sym = `TRKIDLE${ts}`;

    const instrId = await addItem(token, wl1, sym);
    await addItem(token, wl2, sym);

    const { rows: items } = await pool.query<{ id: string; watchlist_id: string }>(
      'SELECT id, watchlist_id FROM watchlist_items WHERE instrument_id = $1', [instrId],
    );

    for (const item of items) {
      await app.inject({
        method: 'DELETE', url: `/watchlists/${item.watchlist_id}/items/${item.id}`,
        cookies: { [SESSION_COOKIE_NAME]: token },
      });
    }

    expect(await getFollowerCount(instrId)).toBe(0);
    expect(await getTrackingState(instrId)).toBe('IDLE');
  });

  it('attempted write to last_ingested_at as stockwatch_api raises a permission error', async () => {
    // The API role cannot write last_ingested_at — DB-level enforcement from T6.
    // This test connects as stockwatch_api (the default test pool role) and attempts the write.
    const ts = Date.now();
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO instruments (resolution_status) VALUES ('PENDING_RESOLUTION') RETURNING id`,
    );
    const instrId = rows[0].id;

    await pool.query(
      `INSERT INTO instrument_tracking (instrument_id, tracking_state, follower_count, priority)
       VALUES ($1, 'IDLE', 0, 0)`,
      [instrId],
    );

    await expect(
      pool.query(
        `UPDATE instrument_tracking SET last_ingested_at = NOW() WHERE instrument_id = $1`,
        [instrId],
      ),
    ).rejects.toThrow(/permission/i);
  });

  it('reconcile is a no-op on consistent data', async () => {
    const ts = Date.now();
    const token = await registerAndLogin(`tracking_rec_${ts}@example.com`);
    const wl = await createWatchlist(token, 'WL');
    const sym = `RECTEST${ts}`;
    const instrId = await addItem(token, wl, sym);

    const before = await getFollowerCount(instrId);
    await reconcileAllTracking(pool);
    const after = await getFollowerCount(instrId);

    expect(before).toBe(after);
  });

  it('reconcile corrects a deliberately corrupted follower_count', async () => {
    const ts = Date.now();
    const token = await registerAndLogin(`tracking_corrupt_${ts}@example.com`);
    const wl = await createWatchlist(token, 'WL');
    const sym = `CORRUPT${ts}`;
    const instrId = await addItem(token, wl, sym);

    // Corrupt the count.
    await pool.query(
      `UPDATE instrument_tracking SET follower_count = 999 WHERE instrument_id = $1`,
      [instrId],
    );
    expect(await getFollowerCount(instrId)).toBe(999);

    await reconcileAllTracking(pool);
    expect(await getFollowerCount(instrId)).toBe(1); // corrected
  });
});
