import type { FastifyRequest, FastifyReply } from 'fastify';
import { lookupSession } from './session.js';
import type { Pool } from '../db.js';

/**
 * Authentication context attached to every authenticated request (INV-15).
 * Identity comes from the session cookie — NEVER from the request body, query, or path.
 */
export interface AuthenticatedUser {
  id: bigint;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by requireSession when the request carries a valid session cookie. */
    user?: AuthenticatedUser;
  }
}

const SESSION_COOKIE_NAME = 'stockwatch_session';

/**
 * Fastify preHandler hook — rejects the request with 401 if no valid session cookie exists.
 * Populates request.user from the session record; never from any payload field.
 */
export function requireSession(pool: Pool) {
  return async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    const token = request.cookies?.[SESSION_COOKIE_NAME];
    if (!token) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const session = await lookupSession(pool, token);
    if (!session) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    request.user = { id: session.userId };
  };
}

/** Cookie name exported for use in routes and tests. */
export { SESSION_COOKIE_NAME };
