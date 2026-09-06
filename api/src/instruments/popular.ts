import type { FastifyInstance } from 'fastify';
import { requireSession } from '../auth/middleware.js';
import { query } from '../db.js';
import type { Pool } from '../db.js';

/**
 * Popular stocks (`GET /popular`) — the empty watchlist's suggestion board (defect 8).
 *
 * Reads `popular_stocks` (the worker's screener sync) joined against `instrument_catalog`
 * for name/exchange — the same reference-only read as symbol search, never the provider
 * itself. Same result shape as search, so the frontend renders both with one component.
 */

const RESULT_LIMIT = 20;

export interface PopularResult {
  readonly symbol: string;
  readonly name: string;
  readonly exchange: string | null;
}

export async function listPopularStocks(pool: Pool): Promise<PopularResult[]> {
  const { rows } = await query<{ symbol: string; name: string | null; exchange: string | null }>(
    pool,
    `SELECT p.symbol, c.name, c.exchange
       FROM popular_stocks p
       LEFT JOIN instrument_catalog c ON c.symbol = p.symbol
      ORDER BY p.rank
      LIMIT ${RESULT_LIMIT}`,
    [],
  );

  return rows.map((row) => ({
    symbol: row.symbol,
    // Never null, never invented — falls back to the symbol itself when the catalog
    // hasn't been synced with this ticker's real name yet.
    name: row.name ?? row.symbol,
    exchange: row.exchange,
  }));
}

export async function registerPopularRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  const auth = requireSession(pool);

  app.get('/popular', { preHandler: auth }, async (_request, reply) => {
    const results = await listPopularStocks(pool);
    return reply.send({ results });
  });
}
