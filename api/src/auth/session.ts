import { randomBytes, createHash } from 'node:crypto';
import type { Pool, PoolClient } from '../db.js';
import { query } from '../db.js';

/**
 * Session management (T8 — INV-15).
 *
 * Opaque session tokens: 32 random bytes → base64url.
 * Stored in the DB as SHA-256(token) — the raw token never persists.
 * Sessions expire after SESSION_TTL_HOURS (24h default).
 */

const SESSION_TTL_HOURS = 24;

export interface Session {
  id: bigint;
  userId: bigint;
  expiresAt: Date;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Create a new session for a user.
 * Returns the opaque token (sent to client) and its expiry.
 * The token hash is stored in the DB — the raw token is never stored.
 */
export async function createSession(
  client: Pool | PoolClient,
  userId: bigint,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);

  await query(client,
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt],
  );

  return { token, expiresAt };
}

/**
 * Look up a session by the raw token.
 * Returns null if the token is unknown, expired, or malformed.
 */
export async function lookupSession(
  client: Pool | PoolClient,
  token: string,
): Promise<{ userId: bigint; expiresAt: Date } | null> {
  const tokenHash = hashToken(token);

  const { rows } = await query<{ user_id: string; expires_at: Date }>(
    client,
    `SELECT user_id, expires_at
     FROM sessions
     WHERE token_hash = $1
       AND expires_at > NOW()`,
    [tokenHash],
  );

  if (rows.length === 0) return null;
  return { userId: BigInt(rows[0].user_id), expiresAt: rows[0].expires_at };
}

/**
 * Destroy a session (logout). Silent no-op if the token is unknown.
 */
export async function destroySession(
  client: Pool | PoolClient,
  token: string,
): Promise<void> {
  const tokenHash = hashToken(token);
  await query(client, `DELETE FROM sessions WHERE token_hash = $1`, [tokenHash]);
}
