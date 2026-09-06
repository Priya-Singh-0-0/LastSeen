/**
 * Symbol search — GET /instruments/search (INV-2: reads the worker-synced catalog,
 * never a provider).
 *
 * Requires a live DB: DATABASE_URL (stockwatch_api role, used for the HTTP requests)
 * and TEST_DATABASE_URL (superuser, used to seed `instrument_catalog` — a worker-owned
 * table the API role is SELECT-only on).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { registerAuthRoutes } from '../src/auth/routes.js';
import { registerSearchRoutes } from '../src/instruments/search.js';
import { getPool, _resetPool } from '../src/db.js';

pg.types.setTypeParser(1700 as pg.TypeId, (v: string) => v);

const DATABASE_URL = process.env.DATABASE_URL;
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDb = DATABASE_URL && TEST_DATABASE_URL ? describe : describe.skip;

interface SearchBody {
  results: Array<{ symbol: string; name: string; exchange: string | null }>;
}

describeWithDb('GET /instruments/search', () => {
  let pool: pg.Pool;
  let setupPool: pg.Pool;
  let app: ReturnType<typeof Fastify>;
  let token: string;

  beforeAll(async () => {
    _resetPool();
    pool = getPool(DATABASE_URL!);
    setupPool = new pg.Pool({ connectionString: TEST_DATABASE_URL! });

    await setupPool.query(`DELETE FROM instrument_catalog WHERE symbol LIKE 'ZS%'`);
    await setupPool.query(
      `INSERT INTO instrument_catalog (symbol, name, exchange, asset_class, status, tradable)
       VALUES
         ('ZS',    'Zscaler, Inc. Common Stock',            'NASDAQ', 'us_equity', 'active',   TRUE),
         ('ZSAB',  'Zsab Holdings Corporation',             'NYSE',   'us_equity', 'active',   TRUE),
         ('ZSDEL', 'Zsdel Delisted Inc.',                   'NYSE',   'us_equity', 'inactive', FALSE),
         ('ZSNT',  'Zsnt Untradable Inc.',                  'NYSE',   'us_equity', 'active',   FALSE),
         ('ZSNM',  'Zscaler Adjacent Name Only Corp.',      'NASDAQ', 'us_equity', 'active',   TRUE)`,
    );

    app = Fastify({ logger: false });
    await app.register(fastifyCookie);
    await registerAuthRoutes(app, pool);
    await registerSearchRoutes(app, pool);
    await app.ready();

    const email = `search_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
    await app.inject({ method: 'POST', url: '/auth/register', payload: { email, password: 'testpassword123' } });
    const loginRes = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'testpassword123' } });
    token = (loginRes.headers['set-cookie'] as string).split(';')[0].split('=')[1];
  });

  afterAll(async () => {
    await setupPool.query(`DELETE FROM instrument_catalog WHERE symbol LIKE 'ZS%'`);
    await app.close();
    await pool.end();
    await setupPool.end();
    _resetPool();
  });

  function search(q: string) {
    return app.inject({
      method: 'GET',
      url: `/instruments/search?q=${encodeURIComponent(q)}`,
      cookies: { stockwatch_session: token },
    });
  }

  it('requires a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/instruments/search?q=ZS' });
    expect(res.statusCode).toBe(401);
  });

  it('matches a ticker prefix case-insensitively and ranks the exact ticker first', async () => {
    const res = await search('zs');
    expect(res.statusCode).toBe(200);
    const body = res.json<SearchBody>();
    expect(body.results[0]).toEqual({
      symbol: 'ZS',
      name: 'Zscaler, Inc. Common Stock',
      exchange: 'NASDAQ',
    });
    expect(body.results.map((r) => r.symbol)).toContain('ZSAB');
  });

  it('matches on company name, not only ticker', async () => {
    const body = (await search('Zscaler Adjacent')).json<SearchBody>();
    expect(body.results.map((r) => r.symbol)).toEqual(['ZSNM']);
  });

  it('excludes inactive and untradable catalog rows', async () => {
    const symbols = (await search('ZS')).json<SearchBody>().results.map((r) => r.symbol);
    expect(symbols).not.toContain('ZSDEL');
    expect(symbols).not.toContain('ZSNT');
  });

  it('returns an empty list for a blank or missing query rather than the whole catalog', async () => {
    expect((await search('   ')).json<SearchBody>().results).toEqual([]);
    const missing = await app.inject({
      method: 'GET',
      url: '/instruments/search',
      cookies: { stockwatch_session: token },
    });
    expect(missing.json<SearchBody>().results).toEqual([]);
  });

  it('treats LIKE wildcards as literal characters', async () => {
    // '%' would otherwise match every row in the catalog.
    expect((await search('%')).json<SearchBody>().results).toEqual([]);
    expect((await search('Z_')).json<SearchBody>().results).toEqual([]);
  });
});
