import type { FastifyInstance } from 'fastify';
import { requireSession } from '../auth/middleware.js';
import { query } from '../db.js';
import type { Pool } from '../db.js';

/**
 * Symbol search (`GET /instruments/search?q=`).
 *
 * Reads `instrument_catalog` — the asset master the worker syncs from the provider —
 * never the provider itself: a user-facing read must not make a synchronous provider
 * call (CLAUDE.md), and the API holds no provider credentials.
 *
 * Every returned field is a stored catalog fact. Nothing here invents a symbol, a
 * company name, or a price.
 */

const MAX_QUERY_LENGTH = 32;
const RESULT_LIMIT = 20;

export interface SearchResult {
  readonly symbol: string;
  readonly name: string;
  readonly exchange: string | null;
}

/** Escapes the LIKE metacharacters so a user typing `%` searches for a literal `%`. */
function escapeLike(value: string): string {
  return value.replace(/([\\%_])/g, '\\$1');
}

export async function searchCatalog(pool: Pool, rawQuery: string): Promise<SearchResult[]> {
  const q = rawQuery.trim().slice(0, MAX_QUERY_LENGTH);
  if (q === '') return [];

  const prefix = `${escapeLike(q)}%`;
  const { rows } = await query<{ symbol: string; name: string; exchange: string | null }>(
    pool,
    `SELECT symbol, name, exchange
       FROM instrument_catalog
      WHERE status = 'active'
        AND tradable
        AND (symbol LIKE upper($1) ESCAPE '\\' OR lower(name) LIKE lower($1) ESCAPE '\\')
      ORDER BY
        (symbol = upper($2)) DESC,                  -- exact ticker first
        (symbol LIKE upper($1) ESCAPE '\\') DESC,   -- then ticker prefix, then name prefix
        -- Within ticker matches, the shorter ticker is the more prominent listing.
        -- Within name matches ticker length means nothing, so they fall through to name.
        CASE WHEN symbol LIKE upper($1) ESCAPE '\\' THEN length(symbol) ELSE 0 END,
        name,
        symbol
      LIMIT ${RESULT_LIMIT}`,
    [prefix, q],
  );

  return rows.map((row) => ({ symbol: row.symbol, name: row.name, exchange: row.exchange }));
}

export async function registerSearchRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  const auth = requireSession(pool);

  // Registered before `/instruments/:id` would ever be consulted — Fastify matches the
  // static segment first regardless of registration order, so `search` is never an id.
  app.get('/instruments/search', { preHandler: auth }, async (request, reply) => {
    const { q } = request.query as { q?: string };
    const results = await searchCatalog(pool, q ?? '');
    return reply.send({ results });
  });
}
