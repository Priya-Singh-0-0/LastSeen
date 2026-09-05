/**
 * T37 — AlpacaAdapter on the official Node SDK (INV-2, INV-13, INV-17).
 *
 * Golden-file contract tests: AlpacaAdapter must satisfy the same contract as FixtureAdapter
 * (T14) — normalization to domain Observation/DailyBar, no throw on missing data, no
 * provider-specific key ever leaking onto an Observation. Fixtures under
 * test/fixtures/alpaca/ are real payloads recorded from a live spike against the paper
 * account (see README.md "Alpaca capability verification (T37)").
 *
 * No test in this file performs a live network call.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateObservation } from '../src/normalize/validate.js';
import { AlpacaAdapter } from '../src/provider/alpaca/adapter.js';
import { createAlpacaClient } from '../src/provider/alpaca/client.js';
import type { AlpacaMarketDataClient } from '../src/provider/alpaca/client.js';
import type { AlpacaBar, AlpacaSnapshotMap } from '../src/provider/alpaca/dto.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(__dirname, 'fixtures/alpaca');

/** Test-only stub: reads recorded fixtures instead of calling the SDK. */
class FixtureAlpacaClient implements AlpacaMarketDataClient {
  constructor(private readonly isOpen: boolean = true) {}

  async fetchSnapshots(symbols: string[]): Promise<AlpacaSnapshotMap> {
    const map: AlpacaSnapshotMap = {};
    for (const symbol of symbols) {
      try {
        const raw = JSON.parse(
          readFileSync(resolve(fixtureDir, `snapshot_${symbol.toLowerCase()}.json`), 'utf8'),
        ) as AlpacaSnapshotMap;
        Object.assign(map, raw);
      } catch {
        // No fixture for this symbol — omit, matching a real "no data" response.
      }
    }
    return map;
  }

  async fetchDailyBars(symbol: string, start: Date, end: Date): Promise<AlpacaBar[]> {
    let raws: AlpacaBar[];
    try {
      raws = JSON.parse(
        readFileSync(resolve(fixtureDir, `bars_${symbol.toLowerCase()}.json`), 'utf8'),
      ) as AlpacaBar[];
    } catch {
      return [];
    }
    return raws.filter((b) => b.t >= start.toISOString() && b.t <= end.toISOString());
  }

  async fetchClock() {
    return { isOpen: this.isOpen };
  }
}

describe('AlpacaAdapter — golden-file contract (T37, gate §O.10 extended)', () => {
  it('valid AAPL snapshot maps to an Observation with correct values', async () => {
    const adapter = new AlpacaAdapter(new FixtureAlpacaClient(true));
    const obs = await adapter.fetchSnapshots(['AAPL']);
    expect(obs.length).toBe(1);
    const o = obs[0]!;
    expect(o.symbol).toBe('AAPL');
    expect(o.price.toFixed(2)).toBe('319.80');
    expect(o.currency).toBe('USD');
    expect(o.marketStatus).toBe('OPEN');
    expect(o.valueKind).toBe('LIVE');
    expect(typeof o.price.toFixed).toBe('function');
    expect(typeof (o.price as unknown)).not.toBe('number');
  });

  it('market closed maps to CLOSED / SESSION_CLOSE', async () => {
    const adapter = new AlpacaAdapter(new FixtureAlpacaClient(false));
    const obs = await adapter.fetchSnapshots(['AAPL']);
    expect(obs[0]!.marketStatus).toBe('CLOSED');
    expect(obs[0]!.valueKind).toBe('SESSION_CLOSE');
  });

  it('snapshot with no trade or bar data is omitted — no throw', async () => {
    const adapter = new AlpacaAdapter(new FixtureAlpacaClient());
    const obs = await adapter.fetchSnapshots(['BRKB']);
    expect(obs.length).toBe(0);
  });

  it('future-timestamped payload fails clock-skew validation', async () => {
    const adapter = new AlpacaAdapter(new FixtureAlpacaClient());
    const obs = await adapter.fetchSnapshots(['TSLA']);
    expect(obs.length).toBe(1);
    const result = validateObservation(obs[0]!, null);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toMatch(/future/i);
  });

  it('no observation exposes a provider-specific key outside provider/alpaca/', async () => {
    const adapter = new AlpacaAdapter(new FixtureAlpacaClient());
    const obs = await adapter.fetchSnapshots(['AAPL']);
    const keys = Object.keys(obs[0]!);
    expect(keys).not.toContain('latestTrade');
    expect(keys).not.toContain('dailyBar');
    expect(keys).not.toContain('cursor');
    expect(keys).not.toContain('nextPageToken');
  });

  it('unknown symbol returns empty array — no throw', async () => {
    const adapter = new AlpacaAdapter(new FixtureAlpacaClient());
    const obs = await adapter.fetchSnapshots(['NOSUCHSYM']);
    expect(obs).toEqual([]);
  });

  it('fetchDailyBars normalizes real recorded AAPL bars to DailyBar', async () => {
    const adapter = new AlpacaAdapter(new FixtureAlpacaClient());
    const bars = await adapter.fetchDailyBars('AAPL', '2024-01-01', '2024-01-10');
    expect(bars.length).toBe(6);
    expect(bars[0]!.sessionDate).toBe('2024-01-02');
    expect(bars[0]!.close.toFixed(2)).toBe('185.64');
  });

  it('fetchDailyBars returns empty array for unknown symbol — no throw', async () => {
    const adapter = new AlpacaAdapter(new FixtureAlpacaClient());
    const bars = await adapter.fetchDailyBars('NOSUCHSYM', '2024-01-01', '2024-12-31');
    expect(bars).toEqual([]);
  });
});

describe('AlpacaAdapter — rate-limit backoff (T37)', () => {
  it('recovers from a stubbed 429 via the SDK default retry policy — no live network call', async () => {
    let calls = 0;
    const fetchApi: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ message: 'rate limited' }), { status: 429 });
      }
      return new Response(
        JSON.stringify({ AAPL: { latestTrade: { p: 100, t: '2024-01-01T00:00:00Z' } } }),
        { status: 200 },
      );
    };

    const client = createAlpacaClient({ keyId: 'test', secret: 'test', fetchApi });
    const snapshots = await client.fetchSnapshots(['AAPL']);

    expect(calls).toBeGreaterThan(1);
    expect(snapshots.AAPL?.latestTrade?.p).toBe(100);
  });
});

describe('AlpacaAdapter — SDK import boundary (T37, extends T4)', () => {
  it('the Alpaca SDK is imported only by provider/alpaca/client.ts', () => {
    const providerDir = resolve(__dirname, '../src/provider');
    const offenders: string[] = [];

    function scan(dir: string): void {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          scan(path);
        } else if (entry.name.endsWith('.ts')) {
          const contents = readFileSync(path, 'utf8');
          if (/@alpacahq\//.test(contents) && !path.endsWith('/provider/alpaca/client.ts')) {
            offenders.push(path);
          }
        }
      }
    }
    scan(providerDir);

    expect(offenders).toEqual([]);
  });
});
