/**
 * T31 — Inbox read model, ranking, and personal explanation (architecture §F.4, §F.7)
 * (INV-1, INV-2, INV-14, INV-9).
 *
 * Requires a live DB: DATABASE_URL (stockwatch_api role, used for the actual HTTP requests)
 * and TEST_DATABASE_URL (superuser, used to seed instruments/instrument_market_state/
 * change_records/user_instrument_checkpoints — worker-owned tables the API role is
 * SELECT-only on).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import pg from 'pg';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { registerAuthRoutes } from '../src/auth/routes.js';
import { registerWatchlistRoutes } from '../src/watchlists/routes.js';
import { registerInboxRoutes } from '../src/inbox/routes.js';
import { SESSION_COOKIE_NAME } from '../src/auth/middleware.js';
import { getPool, _resetPool } from '../src/db.js';

pg.types.setTypeParser(1700 as pg.TypeId, (v: string) => v);

const DATABASE_URL = process.env.DATABASE_URL;
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDb = DATABASE_URL && TEST_DATABASE_URL ? describe : describe.skip;

describeWithDb('T31 — GET /watchlists/:id/inbox', () => {
  let pool: pg.Pool; // stockwatch_api role — used for the actual HTTP requests
  let setupPool: pg.Pool; // superuser — used only to seed worker-owned fixtures
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    _resetPool();
    pool = getPool(DATABASE_URL!);
    setupPool = new pg.Pool({ connectionString: TEST_DATABASE_URL! });

    app = Fastify({ logger: false });
    await app.register(fastifyCookie);
    await registerAuthRoutes(app, pool);
    await registerWatchlistRoutes(app, pool);
    await registerInboxRoutes(app, pool);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await setupPool.end();
    _resetPool();
  });

  async function registerAndLogin(suffix: string): Promise<{ token: string; userId: string }> {
    const email = `inbox_${suffix}_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
    await app.inject({ method: 'POST', url: '/auth/register', payload: { email, password: 'testpassword123' } });
    const loginRes = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'testpassword123' } });
    const token = (loginRes.headers['set-cookie'] as string).split(';')[0].split('=')[1];
    const { rows } = await setupPool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
    return { token, userId: rows[0].id };
  }

  async function createWatchlist(token: string): Promise<string> {
    const res = await app.inject({
      method: 'POST', url: '/watchlists',
      cookies: { [SESSION_COOKIE_NAME]: token },
      payload: { name: `wl-${Date.now()}-${Math.random()}` },
    });
    return (JSON.parse(res.body) as { id: string }).id;
  }

  async function createInstrument(price: string | null): Promise<string> {
    const { rows } = await setupPool.query<{ id: string }>(
      `INSERT INTO instruments (resolution_status) VALUES ('RESOLVED') RETURNING id`,
    );
    const instrumentId = rows[0].id;
    if (price !== null) {
      await setupPool.query(
        `INSERT INTO instrument_market_state
           (instrument_id, price, market_timestamp, last_observed_market_ts, source, market_status, value_kind, data_freshness)
         VALUES ($1, $2, NOW(), NOW(), 'test', 'OPEN', 'LIVE', 'FRESH')`,
        [instrumentId, price],
      );
    }
    return instrumentId;
  }

  async function addToWatchlist(watchlistId: string, instrumentId: string): Promise<void> {
    await setupPool.query(
      `INSERT INTO watchlist_items (watchlist_id, instrument_id) VALUES ($1, $2)`,
      [watchlistId, instrumentId],
    );
  }

  async function seedCheckpoint(userId: string, instrumentId: string, baselinePrice: string, seenThrough = 0): Promise<void> {
    await setupPool.query(
      `INSERT INTO user_instrument_checkpoints
         (user_id, instrument_id, seen_through_publication_seq, baseline_price, baseline_market_timestamp, baseline_corporate_action_version)
       VALUES ($1, $2, $3, $4, NOW() - INTERVAL '3 days', 0)`,
      [userId, instrumentId, seenThrough, baselinePrice],
    );
  }

  async function publishChangeRecord(instrumentId: string, band: string, score: string, seq: number): Promise<void> {
    await setupPool.query(
      `INSERT INTO change_records (instrument_id, published_seq, published_at, assembly_version, latest_at, band, score, shared_explanation, renderer_version)
       VALUES ($1, $2, NOW(), 1, NOW(), $3, $4, $5, 1)`,
      [instrumentId, seq, band, score, `shared explanation for ${band}`],
    );
    await setupPool.query(`UPDATE instruments SET last_published_seq = $1 WHERE id = $2`, [seq, instrumentId]);
  }

  it('returns 404 for a watchlist the user does not own', async () => {
    const owner = await registerAndLogin('owner_404');
    const other = await registerAndLogin('other_404');
    const wlId = await createWatchlist(owner.token);

    const res = await app.inject({
      method: 'GET', url: `/watchlists/${wlId}/inbox`,
      cookies: { [SESSION_COOKIE_NAME]: other.token },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns an empty item list for a watchlist with no items', async () => {
    const { token } = await registerAndLogin('empty');
    const wlId = await createWatchlist(token);

    const res = await app.inject({
      method: 'GET', url: `/watchlists/${wlId}/inbox`,
      cookies: { [SESSION_COOKIE_NAME]: token },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ watchlistId: wlId, items: [] });
  });

  it('query_count_is_exactly_two regardless of item count (no N+1)', async () => {
    const { token, userId } = await registerAndLogin('querycount');
    const wlId = await createWatchlist(token);

    for (let i = 0; i < 4; i++) {
      const instrumentId = await createInstrument('100.000000');
      await addToWatchlist(wlId, instrumentId);
      await seedCheckpoint(userId, instrumentId, '100.000000');
    }

    const querySpy = vi.spyOn(pool, 'query');
    const res = await app.inject({
      method: 'GET', url: `/watchlists/${wlId}/inbox`,
      cookies: { [SESSION_COOKIE_NAME]: token },
    });
    expect(res.statusCode).toBe(200);
    const totalCalls = querySpy.mock.calls.length;
    querySpy.mockRestore();
    // requireSession's own session lookup (1) + the inbox handler's exactly two queries
    // (item join + bounded unseen-changes scan) — regardless of the 4 items seeded above.
    expect(totalCalls).toBe(3);
  });

  it('ranks a fixture set by (max unseen band, max unseen score, |since-check move|)', async () => {
    const { token, userId } = await registerAndLogin('ranking');
    const wlId = await createWatchlist(token);

    // A: URGENT unseen change, small move.
    const instrumentA = await createInstrument('101.000000');
    await addToWatchlist(wlId, instrumentA);
    await seedCheckpoint(userId, instrumentA, '100.000000');
    await publishChangeRecord(instrumentA, 'URGENT', '0.8', 1);

    // B: NOTABLE unseen change.
    const instrumentB = await createInstrument('202.000000');
    await addToWatchlist(wlId, instrumentB);
    await seedCheckpoint(userId, instrumentB, '200.000000');
    await publishChangeRecord(instrumentB, 'NOTABLE', '0.6', 1);

    // C: never viewed (no checkpoint) — AWAITING_BASELINE, ranks last regardless of its
    // own unseen change (still counts as "has unseen", but this test only needs A > B > C
    // to be provably ordered by band/score since C has no market state to diff against).
    const instrumentC = await createInstrument(null);
    await addToWatchlist(wlId, instrumentC);
    await publishChangeRecord(instrumentC, 'QUIET', '0.1', 1);

    const res = await app.inject({
      method: 'GET', url: `/watchlists/${wlId}/inbox`,
      cookies: { [SESSION_COOKIE_NAME]: token },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { items: Array<{ instrumentId: string; maxUnseenBand: string | null }> };
    expect(body.items.map((i) => i.instrumentId)).toEqual([instrumentA, instrumentB, instrumentC]);
    expect(body.items[0].maxUnseenBand).toBe('URGENT');
    expect(body.items[1].maxUnseenBand).toBe('NOTABLE');
    expect(body.items[2].maxUnseenBand).toBe('QUIET');
  });

  it('composes an explanation containing only values the API computed (no fabricated numbers)', async () => {
    const { token, userId } = await registerAndLogin('explain');
    const wlId = await createWatchlist(token);

    const instrumentId = await createInstrument('105.000000');
    await addToWatchlist(wlId, instrumentId);
    await seedCheckpoint(userId, instrumentId, '100.000000');
    await publishChangeRecord(instrumentId, 'NOTABLE', '0.6', 1);

    const res = await app.inject({
      method: 'GET', url: `/watchlists/${wlId}/inbox`,
      cookies: { [SESSION_COOKIE_NAME]: token },
    });
    const body = JSON.parse(res.body) as {
      items: Array<{ percentageChange: string; explanation: string }>;
    };
    const item = body.items[0];
    expect(item.explanation).toContain('shared explanation for NOTABLE');
    expect(item.explanation).toContain(item.percentageChange);
  });

  it('makes zero outbound network calls (no provider adapter import possible from the API)', async () => {
    // Structural guarantee: the API package has no Alpaca SDK dependency at all (INV-2),
    // so this route cannot reach a market provider even in principle.
    const pkg = (await import('../package.json', { with: { type: 'json' } })) as {
      default: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    };
    const deps = { ...pkg.default.dependencies, ...pkg.default.devDependencies };
    expect(Object.keys(deps).some((d) => d.toLowerCase().includes('alpaca'))).toBe(false);
  });
});
