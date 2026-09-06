import { parseDecimal, toSessionDate, toUtcTimestamp, nowUtc } from '@stockwatch/contracts';
import { MarketStatus, ValueKind, DataFreshness } from '@stockwatch/contracts';
import type { Observation, DailyBar, AssetRef, MostActive } from '@stockwatch/contracts';
import type { ProviderAdapter } from '../index.js';
import type { AlpacaMarketDataClient } from './client.js';

/**
 * AlpacaAdapter — ProviderAdapter over the official Alpaca Node SDK (T37 — INV-2, INV-13).
 *
 * Normalizes Alpaca-shaped payloads (via client.ts) into domain Observation/DailyBar values.
 * Polling only — no WebSocket streaming (deferred, architecture §Q).
 *
 * `instrumentId` is always `'0'` here, matching FixtureAdapter (T14): the real instrument id
 * is stamped in by the caller, which already knows it (see worker/src/jobs/handlers.ts).
 */
export class AlpacaAdapter implements ProviderAdapter {
  constructor(private readonly client: AlpacaMarketDataClient) {}

  async fetchSnapshots(symbols: string[]): Promise<Observation[]> {
    if (symbols.length === 0) return [];

    const [snapshots, clock] = await Promise.all([
      this.client.fetchSnapshots(symbols),
      this.client.fetchClock(),
    ]);

    // Judgment call (T37, not an architecture quote): Alpaca's clock only reports an
    // open/closed boolean — PRE_OPEN/POST/HALTED have no producer from this adapter yet.
    const marketStatus = clock.isOpen ? MarketStatus.OPEN : MarketStatus.CLOSED;
    const valueKind = clock.isOpen ? ValueKind.LIVE : ValueKind.SESSION_CLOSE;
    const ingestedAt = nowUtc();

    const observations: Observation[] = [];
    for (const symbol of symbols) {
      const snapshot = snapshots[symbol];
      if (snapshot === undefined) continue; // no data for this symbol — omit, never throw

      const bar = snapshot.dailyBar;
      const price = snapshot.latestTrade?.p ?? bar?.c;
      const rawTimestamp = snapshot.latestTrade?.t ?? bar?.t;
      if (price === undefined || !(price > 0) || rawTimestamp === undefined) {
        continue;
      }

      const marketTimestamp = toUtcTimestamp(Date.parse(rawTimestamp));

      observations.push({
        instrumentId: '0',
        symbol,
        price: parseDecimal(String(price)),
        currency: 'USD',
        marketTimestamp,
        ingestedAt,
        source: 'alpaca',
        marketStatus,
        valueKind,
        dataFreshness: DataFreshness.FRESH, // recomputed at persist time (T36's classifyFreshness)
        ...(bar !== undefined
          ? {
              open: parseDecimal(String(bar.o)),
              high: parseDecimal(String(bar.h)),
              low: parseDecimal(String(bar.l)),
              volume: parseDecimal(String(bar.v)),
            }
          : {}),
        ...(snapshot.prevDailyBar !== undefined
          ? { prevClose: parseDecimal(String(snapshot.prevDailyBar.c)) }
          : {}),
      });
    }

    return observations;
  }

  async fetchDailyBars(symbol: string, from: string, to: string): Promise<DailyBar[]> {
    const bars = await this.client.fetchDailyBars(symbol, new Date(from), new Date(to));
    return bars.map((b) => ({
      instrumentId: '0',
      sessionDate: toSessionDate(b.t.slice(0, 10)),
      open: parseDecimal(String(b.o)),
      high: parseDecimal(String(b.h)),
      low: parseDecimal(String(b.l)),
      close: parseDecimal(String(b.c)),
      volume: parseDecimal(String(b.v)),
    }));
  }

  async fetchAssets(): Promise<AssetRef[]> {
    const assets = await this.client.fetchAssets();
    return assets.map((a) => ({
      symbol: a.symbol,
      name: a.name,
      // Alpaca always sends these; an empty string is not a value worth storing.
      exchange: a.exchange === '' ? null : a.exchange,
      assetClass: a.assetClass === '' ? null : a.assetClass,
      status: a.status,
      tradable: a.tradable,
    }));
  }

  async fetchMostActives(limit: number): Promise<MostActive[]> {
    const actives = await this.client.fetchMostActives(limit);
    // The screener returns its own volume-descending order; rank is that order,
    // stamped here rather than trusted implicitly so a caller never has to re-derive it.
    return actives.map((a, index) => ({
      symbol: a.symbol,
      rank: index + 1,
      tradeCount: a.tradeCount,
      volume: a.volume,
    }));
  }
}
