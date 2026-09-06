import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import type { AssetRef, Observation, DailyBar } from '@stockwatch/contracts';
import { createPool } from '../src/db.js';
import { query } from '../src/db.js';
import { FixtureAdapter } from '../src/provider/fixture.js';
import type { ProviderAdapter } from '../src/provider/index.js';
import { syncInstrumentCatalog } from '../src/catalog/sync.js';

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** A ProviderAdapter that returns exactly the assets a case cares about. */
class StubAssetAdapter implements ProviderAdapter {
  constructor(private readonly assets: AssetRef[]) {}
  async fetchSnapshots(): Promise<Observation[]> { return []; }
  async fetchDailyBars(): Promise<DailyBar[]> { return []; }
  async fetchAssets(): Promise<AssetRef[]> { return this.assets; }
}

function asset(symbol: string, name: string, overrides: Partial<AssetRef> = {}): AssetRef {
  return {
    symbol,
    name,
    exchange: 'NASDAQ',
    assetClass: 'us_equity',
    status: 'active',
    tradable: true,
    ...overrides,
  };
}

describe('FixtureAdapter.fetchAssets', () => {
  it('reads the recorded asset master without touching the network', async () => {
    const assets = await new FixtureAdapter(fixtureDir).fetchAssets();
    const symbols = assets.map((a) => a.symbol);
    expect(symbols).toContain('AAPL');
    expect(assets.find((a) => a.symbol === 'AAPL')?.name).toBe('Apple Inc. Common Stock');
    expect(assets.find((a) => a.symbol === 'NVDA')?.tradable).toBe(false);
  });
});

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb('instrument catalog sync (DB-backed)', () => {
  let pool: pg.Pool;
  /**
   * Every case here calls the real `syncInstrumentCatalog`, whose `deactivateMissing`
   * step is table-wide by design — a stub adapter listing two `ZZT` symbols means every
   * other row in the catalog is one the provider "stopped listing". Against a shared
   * database that silently deactivates the entire asset master, and since the assertions
   * and the cleanup both filter on `ZZT%`, the suite passes while search returns nothing.
   * It happened. The snapshot below restores what these tests deactivate.
   */
  let activeBefore: Array<{ symbol: string; tradable: boolean }> = [];

  beforeAll(async () => {
    pool = createPool(DATABASE_URL!);
    const { rows } = await query<{ symbol: string; tradable: boolean }>(
      pool,
      `SELECT symbol, tradable FROM instrument_catalog
        WHERE status = 'active' AND symbol NOT LIKE 'ZZT%'`,
    );
    activeBefore = rows;
  });

  afterAll(async () => {
    await query(pool, `DELETE FROM instrument_catalog WHERE symbol LIKE 'ZZT%'`);
    if (activeBefore.length > 0) {
      await query(
        pool,
        `UPDATE instrument_catalog c
            SET status = 'active', tradable = v.tradable
           FROM (SELECT unnest($1::text[]) AS symbol, unnest($2::boolean[]) AS tradable) v
          WHERE c.symbol = v.symbol`,
        [activeBefore.map((r) => r.symbol), activeBefore.map((r) => r.tradable)],
      );
    }
    await pool.end();
  });

  beforeEach(async () => {
    await query(pool, `DELETE FROM instrument_catalog WHERE symbol LIKE 'ZZT%'`);
  });

  it('inserts fetched assets', async () => {
    const adapter = new StubAssetAdapter([
      asset('ZZTA', 'Zed Test A Inc.'),
      asset('ZZTB', 'Zed Test B Corp.', { exchange: 'NYSE' }),
    ]);

    const result = await syncInstrumentCatalog(pool, adapter);
    expect(result).toMatchObject({ fetched: 2, upserted: 2 });

    const { rows } = await query<{ symbol: string; name: string; exchange: string }>(
      pool,
      `SELECT symbol, name, exchange FROM instrument_catalog WHERE symbol LIKE 'ZZT%' ORDER BY symbol`,
    );
    expect(rows).toEqual([
      { symbol: 'ZZTA', name: 'Zed Test A Inc.', exchange: 'NASDAQ' },
      { symbol: 'ZZTB', name: 'Zed Test B Corp.', exchange: 'NYSE' },
    ]);
  });

  it('is idempotent — a second identical sync changes no row count and refreshes the name in place', async () => {
    const first = new StubAssetAdapter([asset('ZZTA', 'Zed Test A Inc.')]);
    await syncInstrumentCatalog(pool, first);

    const renamed = new StubAssetAdapter([asset('ZZTA', 'Zed Test A Holdings Inc.')]);
    await syncInstrumentCatalog(pool, renamed);

    const { rows } = await query<{ symbol: string; name: string }>(
      pool,
      `SELECT symbol, name FROM instrument_catalog WHERE symbol LIKE 'ZZT%'`,
    );
    expect(rows).toEqual([{ symbol: 'ZZTA', name: 'Zed Test A Holdings Inc.' }]);
  });

  it('marks a symbol the provider stopped listing as inactive instead of deleting it', async () => {
    await syncInstrumentCatalog(
      pool,
      new StubAssetAdapter([asset('ZZTA', 'Zed Test A Inc.'), asset('ZZTB', 'Zed Test B Corp.')]),
      new Date(Date.now() - 60_000),
    );

    await syncInstrumentCatalog(pool, new StubAssetAdapter([asset('ZZTA', 'Zed Test A Inc.')]));

    const { rows } = await query<{ symbol: string; status: string; tradable: boolean }>(
      pool,
      `SELECT symbol, status, tradable FROM instrument_catalog WHERE symbol LIKE 'ZZT%' ORDER BY symbol`,
    );
    expect(rows).toEqual([
      { symbol: 'ZZTA', status: 'active', tradable: true },
      { symbol: 'ZZTB', status: 'inactive', tradable: false },
    ]);
  });

  it('leaves the catalog untouched when the provider returns nothing', async () => {
    await syncInstrumentCatalog(pool, new StubAssetAdapter([asset('ZZTA', 'Zed Test A Inc.')]));

    const result = await syncInstrumentCatalog(pool, new StubAssetAdapter([]));
    expect(result).toEqual({ fetched: 0, upserted: 0, deactivated: 0 });

    const { rows } = await query<{ status: string }>(
      pool,
      `SELECT status FROM instrument_catalog WHERE symbol = 'ZZTA'`,
    );
    expect(rows).toEqual([{ status: 'active' }]);
  });
});
