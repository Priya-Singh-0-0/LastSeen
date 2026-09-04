import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDecimal, toSessionDate } from '@stockwatch/contracts';
import type { Observation, DailyBar, UtcTimestamp } from '@stockwatch/contracts';
import type { ProviderAdapter } from './index.js';
import {
  MarketStatus, ValueKind, DataFreshness,
} from '@stockwatch/contracts';


const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * FixtureAdapter (T14 — INV-13).
 *
 * Reads recorded JSON from test/fixtures/*.json.
 * Makes every downstream test fully deterministic — no network in any test.
 * The interface exposes only domain types: no provider enum, no SDK type, no pagination cursor.
 */
export class FixtureAdapter implements ProviderAdapter {
  private readonly fixtureDir: string;

  constructor(fixtureDir?: string) {
    this.fixtureDir = fixtureDir ?? resolve(__dirname, '../test/fixtures');
  }

  async fetchSnapshots(symbols: string[]): Promise<Observation[]> {
    const results: Observation[] = [];

    for (const symbol of symbols) {
      // Try to load a fixture file named snapshot_<symbol_lower>_valid.json.
      const fileName = `snapshot_${symbol.toLowerCase()}_valid.json`;
      const filePath = resolve(this.fixtureDir, fileName);

      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
      } catch {
        // No fixture for this symbol — skip.
        continue;
      }

      if (raw._malformed || raw.price === null || raw.price === undefined) {
        continue;
      }

      const price = parseDecimal(String(raw.price));
      if (!price.isPositive()) continue;

      const obs: Record<string, unknown> = {
        instrumentId: String(raw.instrumentId ?? '0'),
        symbol,
        price,
        currency: String(raw.currency ?? 'USD'),
        marketTimestamp: Number(raw.marketTimestamp),
        ingestedAt: Number(raw.ingestedAt),
        source: String(raw.source ?? 'fixture'),
        marketStatus: raw.marketStatus,
        valueKind: raw.valueKind,
        dataFreshness: raw.dataFreshness,
      };

      if (raw.volume !== undefined) obs.volume = parseDecimal(String(raw.volume));
      if (raw.open !== undefined) obs.open = parseDecimal(String(raw.open));
      if (raw.high !== undefined) obs.high = parseDecimal(String(raw.high));
      if (raw.low !== undefined) obs.low = parseDecimal(String(raw.low));
      if (raw.prevClose !== undefined) obs.prevClose = parseDecimal(String(raw.prevClose));

      results.push(obs as unknown as Observation);
    }

    return results;
  }

  async fetchDailyBars(symbol: string, from: string, to: string): Promise<DailyBar[]> {
    const fileName = `bars_${symbol.toLowerCase()}.json`;
    const filePath = resolve(this.fixtureDir, fileName);

    let raws: Array<Record<string, unknown>>;
    try {
      raws = JSON.parse(readFileSync(filePath, 'utf8')) as Array<Record<string, unknown>>;
    } catch {
      return [];
    }

    return raws
      .filter((r) => String(r.sessionDate) >= from && String(r.sessionDate) <= to)
      .map((r) => ({
        instrumentId: String(r.instrumentId ?? '0'),
        sessionDate: toSessionDate(String(r.sessionDate)),
        open: parseDecimal(String(r.open)),
        high: parseDecimal(String(r.high)),
        low: parseDecimal(String(r.low)),
        close: parseDecimal(String(r.close)),
        volume: parseDecimal(String(r.volume)),
      }));
  }
}
