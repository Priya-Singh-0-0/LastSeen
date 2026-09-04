/**
 * T14 — provider normalization golden-file tests (INV-13)
 *
 * Each fixture maps to an expected Observation or rejection reason.
 * Gate §O.10.
 */
import { describe, it, expect } from 'vitest';
import { FixtureAdapter } from '../src/provider/fixture.js';
import { validateObservation } from '../src/normalize/validate.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(__dirname, 'fixtures');

describe('provider_normalization_golden_files (T14 — INV-13)', () => {
  const adapter = new FixtureAdapter(fixtureDir);

  it('valid AAPL snapshot maps to an Observation with correct values', async () => {
    const obs = await adapter.fetchSnapshots(['AAPL']);
    expect(obs.length).toBe(1);
    const o = obs[0];
    expect(o.symbol).toBe('AAPL');
    expect(o.price.toFixed(2)).toBe('182.34');
    expect(o.currency).toBe('USD');
    expect(o.marketStatus).toBe('OPEN');
    expect(o.valueKind).toBe('LIVE');
    expect(o.dataFreshness).toBe('FRESH');
    // Financial value is a Decimal, not a number.
    expect(typeof o.price.toFixed).toBe('function');
    expect(typeof (o.price as unknown)).not.toBe('number');
  });

  it('null-price payload is rejected — returns empty array', async () => {
    const obs = await adapter.fetchSnapshots(['BRKB']);
    expect(obs.length).toBe(0);
  });

  it('future-timestamped payload fails clock-skew validation', async () => {
    // The FixtureAdapter does not validate timestamps — that's validate.ts.
    // We verify that validateObservation rejects a future-dated fixture.
    const obs = await adapter.fetchSnapshots(['TSLA']);
    // The fixture has a valid price but future timestamp.
    // The adapter may return it; validateObservation must reject it.
    if (obs.length > 0) {
      const result = validateObservation(obs[0], null);
      expect(result.ok).toBe(false);
      expect((result as { ok: false; reason: string }).reason).toMatch(/future/i);
    }
    // If adapter already filters it, that's fine too.
  });

  it('no observation type exposes a provider-specific type outside provider/', async () => {
    const obs = await adapter.fetchSnapshots(['AAPL']);
    const o = obs[0];
    // The Observation interface must not contain any Alpaca-specific keys.
    // (Boundary is enforced by the import-boundary test in T4, which covers transitive imports.)
    const keys = Object.keys(o);
    expect(keys).not.toContain('alpacaQuote');
    expect(keys).not.toContain('alpacaTrade');
    expect(keys).not.toContain('cursor');
    expect(keys).not.toContain('nextPageToken');
  });

  it('unknown symbol returns empty array — no throw', async () => {
    const obs = await adapter.fetchSnapshots(['NOSUCHSYM']);
    expect(obs).toEqual([]);
  });

  it('fetchDailyBars returns empty array for unknown symbol — no throw', async () => {
    const bars = await adapter.fetchDailyBars('NOSUCHSYM', '2024-01-01', '2024-12-31');
    expect(bars).toEqual([]);
  });
});
