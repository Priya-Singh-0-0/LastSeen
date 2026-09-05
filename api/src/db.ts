import pg from 'pg';

// ─── NUMERIC-as-string type parser (INV-9) ────────────────────────────────────
// OID 1700 = NUMERIC. The pg default parses NUMERIC to a JS float, losing precision.
// We override it to return the raw string, which parseDecimal() then wraps.
pg.types.setTypeParser(1700, (value: string) => value);

export type { Pool, PoolClient, QueryResult } from 'pg';

let _pool: pg.Pool | null = null;

/**
 * Returns the singleton pg.Pool for the given connection string.
 * Call once at startup; subsequent calls with any string return the same pool.
 */
export function getPool(connectionString: string): pg.Pool {
  if (!_pool) {
    _pool = new pg.Pool({ connectionString, max: 10 });
    _pool.on('error', (err) => {
      console.error('[db] unexpected pool error', err);
    });
  }
  return _pool;
}

/** Exposed for tests — resets the singleton so a new pool can be created. */
export function _resetPool(): void {
  _pool = null;
}

/**
 * Thin parameterized query helper. Always use this — never string-interpolate SQL.
 */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  client: pg.Pool | pg.PoolClient,
  sql: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return client.query<T>(sql, params);
}
