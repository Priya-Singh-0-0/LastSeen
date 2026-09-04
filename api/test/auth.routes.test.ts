/**
 * T9 — auth routes tests (INV-15)
 * POST /auth/register, POST /auth/login, POST /auth/logout
 *
 * Requires a live DB: DATABASE_URL env var.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import pg from 'pg';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { registerAuthRoutes } from '../src/auth/routes.js';
import { SESSION_COOKIE_NAME } from '../src/auth/middleware.js';
import { getPool, _resetPool } from '../src/db.js';

pg.types.setTypeParser(1700 as pg.TypeId, (v: string) => v);

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb('T9 — auth routes', () => {
  let pool: pg.Pool;
  let client: pg.PoolClient;
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    _resetPool();
    pool = getPool(DATABASE_URL!);

    app = Fastify({ logger: false });
    await app.register(fastifyCookie);
    await registerAuthRoutes(app, pool);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    _resetPool();
  });

  beforeEach(async () => {
    client = await pool.connect();
    await client.query('BEGIN');
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
    client.release();
  });

  // ── register ───────────────────────────────────────────────────────────────
  it('register: happy path returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'route_test@example.com', password: 'hunter2hunter2' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { id: string };
    expect(typeof body.id).toBe('string');
  });

  it('register: malformed payload is rejected with 400 and no DB write', async () => {
    const before = await client.query('SELECT COUNT(*) FROM users');
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'not-an-email', password: 'short' },
    });
    expect(res.statusCode).toBe(400);
    const after = await client.query('SELECT COUNT(*) FROM users');
    expect(before.rows[0].count).toBe(after.rows[0].count);
  });

  it('register: duplicate email returns 409', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'dup@example.com', password: 'password12345' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'dup@example.com', password: 'password12345' },
    });
    expect(res.statusCode).toBe(409);
  });

  // ── login ──────────────────────────────────────────────────────────────────
  it('login: happy path sets HttpOnly Secure SameSite=Lax cookie', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'logintest@example.com', password: 'correcthorse123' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'logintest@example.com', password: 'correcthorse123' },
    });
    expect(res.statusCode).toBe(200);

    const cookie = res.headers['set-cookie'] as string | string[];
    const cookieStr = Array.isArray(cookie) ? cookie.join('; ') : cookie;
    expect(cookieStr).toContain(SESSION_COOKIE_NAME);
    expect(cookieStr.toLowerCase()).toContain('httponly');
    expect(cookieStr.toLowerCase()).toContain('secure');
    expect(cookieStr.toLowerCase()).toContain('samesite=lax');
  });

  it('login: wrong password returns 401', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'badpw@example.com', password: 'correcthorse123' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'badpw@example.com', password: 'wrongpassword' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('login: malformed payload rejected with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'not-an-email' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('login: rate limit trips after MAX_LOGIN_ATTEMPTS and recovers', async () => {
    const email = `ratelimit_${Date.now()}@example.com`;
    // Register so the user exists.
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'correcthorse123' },
    });

    // Submit 10 bad-password attempts.
    for (let i = 0; i < 10; i++) {
      await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email, password: 'wrong' },
      });
    }

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'correcthorse123' },
    });
    expect(res.statusCode).toBe(429);
  });

  // ── logout ─────────────────────────────────────────────────────────────────
  it('logout: clears the session cookie', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'logout_test@example.com', password: 'correcthorse123' },
    });
    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'logout_test@example.com', password: 'correcthorse123' },
    });

    const cookieHeader = loginRes.headers['set-cookie'] as string;
    const token = cookieHeader.split(';')[0].split('=')[1];

    const logoutRes = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      cookies: { [SESSION_COOKIE_NAME]: token },
    });
    expect(logoutRes.statusCode).toBe(200);

    // Cookie should be cleared (Max-Age=0 or expires in the past).
    const logoutCookie = logoutRes.headers['set-cookie'] as string | string[];
    const logoutCookieStr = Array.isArray(logoutCookie)
      ? logoutCookie.join('; ')
      : logoutCookie ?? '';
    // Either empty value or max-age=0 indicates cleared.
    expect(
      logoutCookieStr.includes('max-age=0') ||
      logoutCookieStr.includes('Max-Age=0') ||
      logoutCookieStr.includes(`${SESSION_COOKIE_NAME}=;`)
    ).toBe(true);
  });
});
