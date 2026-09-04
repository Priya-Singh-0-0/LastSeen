/**
 * T30 — Instrument detail GET and acknowledge POST (architecture §F.6) (INV-7, INV-15)
 *
 * Requires a live DB: DATABASE_URL (stockwatch_api role, used for the actual HTTP requests)
 * and TEST_DATABASE_URL (superuser, used to seed instruments/instrument_market_state/
 * change_records/instrument_signals — worker-owned tables the API role is SELECT-only on).
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
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDb = DATABASE_URL && TEST_DATABASE_URL ? describe : describe.skip;
const ACK_SECRET = 'test-ack-token-secret-at-least-32-chars-long';

describeWithDb('T30 — Instrument detail GET and acknowledge POST', () => {
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
    await registerInstrumentRoutes(app, pool, ACK_SECRET);
    await registerCheckpointRoutes(app, pool, ACK_SECRET);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await setupPool.end();
    _resetPool();
  });

  /** Registers+logs in a fresh user; returns the session cookie token and the numeric user id. */
  async function registerAndLogin(suffix: string): Promise<{ token: string; userId: string }> {
    const email = `ack_${suffix}_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
    await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { email, password: 'testpassword123' },
    });
    const loginRes = await app.inject({
      method: 'POST', url: '/auth/login',
      payload: { email, password: 'testpassword123' },
    });
    const token = (loginRes.headers['set-cookie'] as string).split(';')[0].split('=')[1];
    const { rows } = await setupPool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
    return { token, userId: rows[0].id };
  }

  /** Creates an instrument with market state, directly via the superuser pool. */
  async function createInstrumentWithMarketState(opts?: {
    price?: string;
    lastPublishedSeq?: number;
  }): Promise<string> {
    const { rows } = await setupPool.query<{ id: string }>(
      `INSERT INTO instruments (resolution_status, last_published_seq)
       VALUES ('RESOLVED', $1) RETURNING id`,
      [opts?.lastPublishedSeq ?? 0],
    );
    const instrumentId = rows[0].id;
    await setupPool.query(
      `INSERT INTO instrument_market_state
         (instrument_id, price, market_timestamp, last_observed_market_ts, source, market_status, value_kind, data_freshness)
       VALUES ($1, $2, NOW(), NOW(), 'test', 'OPEN', 'LIVE', 'FRESH')`,
      [instrumentId, opts?.price ?? '100.000000'],
    );
    return instrumentId;
  }

  /** Adds an instrument to a user's watchlist directly, bypassing symbol resolution. */
  async function addToWatchlist(token: string, instrumentId: string): Promise<void> {
    const wlRes = await app.inject({
      method: 'POST', url: '/watchlists',
      cookies: { [SESSION_COOKIE_NAME]: token },
      payload: { name: `wl-${Date.now()}-${Math.random()}` },
    });
    const wlId = (JSON.parse(wlRes.body) as { id: string }).id;
    await setupPool.query(
      `INSERT INTO watchlist_items (watchlist_id, instrument_id) VALUES ($1, $2)`,
      [wlId, instrumentId],
    );
  }

  async function readCheckpoint(userId: string, instrumentId: string): Promise<Record<string, unknown> | null> {
    const { rows } = await setupPool.query(
      `SELECT * FROM user_instrument_checkpoints WHERE user_id = $1 AND instrument_id = $2`,
      [userId, instrumentId],
    );
    return rows[0] ?? null;
  }

  describe('checkpoint_moves_only_via_post', () => {
    it('a repeated GET leaves the checkpoint byte-identical; only POST advances it', async () => {
      const { token, userId } = await registerAndLogin('idem');
      const instrumentId = await createInstrumentWithMarketState();
      await addToWatchlist(token, instrumentId);

      const get1 = await app.inject({
        method: 'GET', url: `/instruments/${instrumentId}`,
        cookies: { [SESSION_COOKIE_NAME]: token },
      });
      expect(get1.statusCode).toBe(200);
      const body1 = JSON.parse(get1.body) as { ackToken: string };

      const after1 = await readCheckpoint(userId, instrumentId);
      expect(after1).not.toBeNull();

      const get2 = await app.inject({
        method: 'GET', url: `/instruments/${instrumentId}`,
        cookies: { [SESSION_COOKIE_NAME]: token },
      });
      expect(get2.statusCode).toBe(200);

      const after2 = await readCheckpoint(userId, instrumentId);
      expect(after2).toEqual(after1); // byte-identical, including updated_at

      const postRes = await app.inject({
        method: 'POST', url: `/instruments/${instrumentId}/acknowledge`,
        cookies: { [SESSION_COOKIE_NAME]: token },
        payload: { ack_token: body1.ackToken },
      });
      expect(postRes.statusCode).toBe(200);

      const afterPost = await readCheckpoint(userId, instrumentId);
      expect(afterPost!.updated_at).not.toEqual(after2!.updated_at);
    });
  });

  describe('ack_token scoping', () => {
    it('a POST with another user\'s token is rejected and the checkpoint is untouched', async () => {
      const userA = await registerAndLogin('scope_a');
      const userB = await registerAndLogin('scope_b');
      const instrumentId = await createInstrumentWithMarketState();
      await addToWatchlist(userA.token, instrumentId);
      await addToWatchlist(userB.token, instrumentId);

      const getA = await app.inject({
        method: 'GET', url: `/instruments/${instrumentId}`,
        cookies: { [SESSION_COOKIE_NAME]: userA.token },
      });
      const { ackToken } = JSON.parse(getA.body) as { ackToken: string };

      // User B's own checkpoint exists (created by their own GET, implicitly via ensureCheckpoint
      // inside the POST handler's authorization) — but hasn't been created yet since B never GET'd.
      const beforePost = await readCheckpoint(userB.userId, instrumentId);
      expect(beforePost).toBeNull();

      const postRes = await app.inject({
        method: 'POST', url: `/instruments/${instrumentId}/acknowledge`,
        cookies: { [SESSION_COOKIE_NAME]: userB.token },
        payload: { ack_token: ackToken },
      });
      expect(postRes.statusCode).toBe(403);

      // Still no checkpoint for B — the rejected POST created nothing and touched nothing.
      const afterPost = await readCheckpoint(userB.userId, instrumentId);
      expect(afterPost).toBeNull();
    });

    it('a POST whose path instrument differs from the token\'s is rejected', async () => {
      const { token } = await registerAndLogin('wronginstrument');
      const instrumentId1 = await createInstrumentWithMarketState();
      const instrumentId2 = await createInstrumentWithMarketState();
      await addToWatchlist(token, instrumentId1);
      await addToWatchlist(token, instrumentId2);

      const get1 = await app.inject({
        method: 'GET', url: `/instruments/${instrumentId1}`,
        cookies: { [SESSION_COOKIE_NAME]: token },
      });
      const { ackToken } = JSON.parse(get1.body) as { ackToken: string };

      const postRes = await app.inject({
        method: 'POST', url: `/instruments/${instrumentId2}/acknowledge`,
        cookies: { [SESSION_COOKIE_NAME]: token },
        payload: { ack_token: ackToken },
      });
      expect(postRes.statusCode).toBe(403);
    });
  });

  describe('authorization (INV-15)', () => {
    it('GET /instruments/:id for an instrument the user does not track returns 404', async () => {
      const { token } = await registerAndLogin('noaccess');
      const instrumentId = await createInstrumentWithMarketState();
      // Not added to any of this user's watchlists.

      const res = await app.inject({
        method: 'GET', url: `/instruments/${instrumentId}`,
        cookies: { [SESSION_COOKIE_NAME]: token },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('unseen changes with evidence', () => {
    it('returns published change records with signal evidence beyond the checkpoint watermark', async () => {
      const { token } = await registerAndLogin('evidence');
      const instrumentId = await createInstrumentWithMarketState();
      await addToWatchlist(token, instrumentId);

      // Establish the checkpoint first (seen_through = 0, since last_published_seq is 0 here) —
      // then a new change record is published, simulating one that arrives after the user starts
      // watching. ensureCheckpoint's "initial-following" policy means a change published BEFORE
      // the checkpoint exists never surfaces as unseen (see api/src/checkpoints/repo.ts).
      const firstGet = await app.inject({
        method: 'GET', url: `/instruments/${instrumentId}`,
        cookies: { [SESSION_COOKIE_NAME]: token },
      });
      expect(firstGet.statusCode).toBe(200);

      await setupPool.query(`UPDATE instruments SET last_published_seq = 1 WHERE id = $1`, [instrumentId]);
      const { rows: crRows } = await setupPool.query<{ id: string }>(
        `INSERT INTO change_records (instrument_id, published_seq, published_at, latest_at, band, score, shared_explanation, renderer_version)
         VALUES ($1, 1, NOW(), NOW(), 'NOTABLE', '0.500000', 'Shared summary.', 1)
         RETURNING id`,
        [instrumentId],
      );
      const changeRecordId = crRows[0].id;
      await setupPool.query(
        `INSERT INTO instrument_signals (instrument_id, change_record_id, signal_type, detector_version, dedupe_key, evidence, market_timestamp)
         VALUES ($1, $2, 'LARGE_ABSOLUTE_MOVE', 1, 'dedupe-1', '{"pct_change": "0.05"}'::jsonb, NOW())`,
        [instrumentId, changeRecordId],
      );

      const res = await app.inject({
        method: 'GET', url: `/instruments/${instrumentId}`,
        cookies: { [SESSION_COOKIE_NAME]: token },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as {
        unseenChanges: Array<{ publishedSeq: string; signals: Array<{ signalType: string; evidence: Record<string, unknown> }> }>;
      };
      expect(body.unseenChanges).toHaveLength(1);
      expect(body.unseenChanges[0].publishedSeq).toBe('1');
      expect(body.unseenChanges[0].signals).toHaveLength(1);
      expect(body.unseenChanges[0].signals[0].signalType).toBe('LARGE_ABSOLUTE_MOVE');
      expect(body.unseenChanges[0].signals[0].evidence).toEqual({ pct_change: '0.05' });
    });
  });
});
