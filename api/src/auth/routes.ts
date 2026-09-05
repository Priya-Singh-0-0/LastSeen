import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashPassword, verifyPassword } from './password.js';
import { createSession, destroySession } from './session.js';
import { SESSION_COOKIE_NAME } from './middleware.js';
import { query } from '../db.js';
import type { Pool } from '../db.js';

/**
 * Auth routes (T9 — INV-15).
 *
 * POST /auth/register  — create account
 * POST /auth/login     — create session, set HttpOnly cookie
 * POST /auth/logout    — destroy session, clear cookie
 *
 * Per-identity login-attempt rate limiting uses a DB counter row (INV-16 — no Redis).
 */

const MAX_LOGIN_ATTEMPTS = 10;
const LOGIN_WINDOW_MINUTES = 15;

const RegisterBody = z.object({
  email:    z.string().email().max(254),
  password: z.string().min(8).max(128),
});

const LoginBody = z.object({
  email:    z.string().email().max(254),
  password: z.string().min(1).max(128),
});

export async function registerAuthRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  // ─── POST /auth/register ────────────────────────────────────────────────────
  app.post('/auth/register', async (request, reply) => {
    const parsed = RegisterBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    }
    const { email, password } = parsed.data;

    // Check uniqueness before hashing (fast path).
    const { rows: existing } = await query<{ id: string }>(
      pool, `SELECT id FROM users WHERE email = $1`, [email],
    );
    if (existing.length > 0) {
      return reply.code(409).send({ error: 'Email already registered' });
    }

    const passwordHash = await hashPassword(password);
    const { rows } = await query<{ id: string }>(
      pool,
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       RETURNING id`,
      [email, passwordHash],
    );

    // INSERT ... RETURNING always yields exactly one row.
    return reply.code(201).send({ id: rows[0]!.id });
  });

  // ─── POST /auth/login ───────────────────────────────────────────────────────
  app.post('/auth/login', async (request, reply) => {
    const parsed = LoginBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    }
    const { email, password } = parsed.data;

    // Rate limit: count recent failed attempts per email.
    const { rows: attemptRows } = await query<{ cnt: string }>(
      pool,
      `SELECT COUNT(*) AS cnt
       FROM login_attempts
       WHERE email = $1
         AND attempted_at > NOW() - INTERVAL '${LOGIN_WINDOW_MINUTES} minutes'
         AND success = false`,
      [email],
    );
    const attempts = parseInt(attemptRows[0]?.cnt ?? '0', 10);
    if (attempts >= MAX_LOGIN_ATTEMPTS) {
      return reply.code(429).send({ error: 'Too many login attempts. Try again later.' });
    }

    // Look up user.
    const { rows } = await query<{ id: string; password_hash: string }>(
      pool,
      `SELECT id, password_hash FROM users WHERE email = $1`,
      [email],
    );

    const user = rows[0];
    const valid = user !== undefined && (await verifyPassword(user.password_hash, password));

    // Record attempt.
    await query(
      pool,
      `INSERT INTO login_attempts (email, success)
       VALUES ($1, $2)`,
      [email, valid],
    );

    if (!valid || user === undefined) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const { token, expiresAt } = await createSession(pool, BigInt(user.id));

    reply.setCookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      expires: expiresAt,
      path: '/',
    });

    return reply.code(200).send({ ok: true });
  });

  // ─── POST /auth/logout ──────────────────────────────────────────────────────
  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies?.[SESSION_COOKIE_NAME];
    if (token) {
      await destroySession(pool, token);
    }
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return reply.code(200).send({ ok: true });
  });
}
