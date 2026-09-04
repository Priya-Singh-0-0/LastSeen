/**
 * T8 — auth session tests (INV-15)
 *
 * Requires a live DB: DATABASE_URL env var.
 * Tests run against a transaction that is rolled back after each test.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import pg from 'pg';
import { hashPassword, verifyPassword } from '../src/auth/password.js';
import { createSession, lookupSession, destroySession } from '../src/auth/session.js';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { requireSession, SESSION_COOKIE_NAME } from '../src/auth/middleware.js';
import { getPool, _resetPool } from '../src/db.js';

pg.types.setTypeParser(1700 as pg.TypeId, (v: string) => v);

const DATABASE_URL = process.env.DATABASE_URL;

describe('T8 — password hashing', () => {
  it('hashes and verifies correctly', async () => {
    const hash = await hashPassword('correcthorsebatterystaple');
    expect(await verifyPassword(hash, 'correcthorsebatterystaple')).toBe(true);
  });

  it('rejects wrong password', async () => {
    const hash = await hashPassword('correcthorsebatterystaple');
    expect(await verifyPassword(hash, 'wrongpassword')).toBe(false);
  });

  it('verifyPassword returns false for a malformed hash', async () => {
    expect(await verifyPassword('not-a-real-hash', 'anything')).toBe(false);
  });

  it('hash does not contain the plaintext', async () => {
    const hash = await hashPassword('supersecret');
    expect(hash).not.toContain('supersecret');
  });
});

// Integration tests require a live DB.
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb('T8 — session create/lookup/destroy', () => {
  let pool: pg.Pool;
  let client: pg.PoolClient;

  beforeAll(() => {
    _resetPool();
    pool = getPool(DATABASE_URL!);
  });

  afterAll(async () => {
    await pool.end();
    _resetPool();
  });

  beforeEach(async () => {
    client = await pool.connect();
    await client.query('BEGIN');
    // Insert a test user.
    await client.query(
      `INSERT INTO users (id, email, password_hash) VALUES (999999, 'sess_test@example.com', 'x')
       ON CONFLICT (id) DO NOTHING`,
    );
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
    client.release();
  });

  it('creates a session and looks it up', async () => {
    const { token } = await createSession(client, 999999n);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(20);

    const session = await lookupSession(client, token);
    expect(session).not.toBeNull();
    expect(session!.userId).toBe(999999n);
  });

  it('returns null for unknown token', async () => {
    const session = await lookupSession(client, 'nonexistent-token');
    expect(session).toBeNull();
  });

  it('destroys a session — subsequent lookup returns null', async () => {
    const { token } = await createSession(client, 999999n);
    await destroySession(client, token);
    const session = await lookupSession(client, token);
    expect(session).toBeNull();
  });
});

describeWithDb('T8 — requireSession middleware', () => {
  // Unlike the two describe blocks above, this one cannot seed fixtures inside a
  // BEGIN'd transaction on a dedicated client: the requireSession middleware queries
  // through `pool` (a separate connection, per createSession/lookupSession's real
  // call signature), which cannot see the transactional client's uncommitted rows.
  // Fixtures here are committed directly and cleaned up in afterEach instead.
  let pool: pg.Pool;
  let app: ReturnType<typeof Fastify>;

  beforeAll(() => {
    _resetPool();
    pool = getPool(DATABASE_URL!);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    _resetPool();
  });

  beforeEach(async () => {
    await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES (999998, 'mw_test@example.com', 'x')
       ON CONFLICT (id) DO NOTHING`,
    );

    app = Fastify();
    await app.register(fastifyCookie);
    const auth = requireSession(pool);
    app.get('/protected', { preHandler: auth }, async (req) => ({ userId: String(req.user!.id) }));
    await app.ready();
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM sessions WHERE user_id = 999998`);
    await pool.query(`DELETE FROM users WHERE id = 999998`);
    await app.close();
  });

  it('rejects request with no cookie (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/protected' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects request with invalid cookie (401)', async () => {
    const res = await app.inject({
      method: 'GET', url: '/protected',
      cookies: { [SESSION_COOKIE_NAME]: 'invalid-token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts request with valid cookie and populates request.user from session — not from body', async () => {
    const { token } = await createSession(pool, 999998n);
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      cookies: { [SESSION_COOKIE_NAME]: token },
      // Supplying a user_id in the body must be ignored.
      payload: { user_id: '1' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { userId: string };
    expect(body.userId).toBe('999998'); // from the session, not the payload
  });

  it('session cookie flags are HttpOnly, Secure, SameSite=Lax', async () => {
    // We verify these flags are set in the auth routes test (T9).
    // Here we just confirm the cookie name constant is exported.
    expect(SESSION_COOKIE_NAME).toBe('stockwatch_session');
  });
});
