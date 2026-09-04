import pg from 'pg';

// ─── NUMERIC-as-string type parser (INV-9) ────────────────────────────────────
// Mirrors api/src/db.ts — both processes must return NUMERIC as string.
pg.types.setTypeParser(1700 as pg.TypeId, (value: string) => value);

export type { Pool, PoolClient } from 'pg';

/**
 * Creates a new pg.Pool using the stockwatch_worker DB role.
 * Worker connections are always fresh (no singleton) — the scheduler
 * manages its own lifetime.
 */
export function createPool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({ connectionString, max: 5 });
  pool.on('error', (err) => {
    console.error('[worker/db] unexpected pool error', err);
  });
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  client: pg.Pool | pg.PoolClient,
  sql: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return client.query<T>(sql, params);
}
