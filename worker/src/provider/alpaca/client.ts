import { Alpaca, TimeFrame } from '@alpacahq/alpaca-trade-api';
import type { AlpacaAsset, AlpacaBar, AlpacaClock, AlpacaMostActive, AlpacaSnapshotMap } from './dto.js';

/** StockHistoricalFeed (bars) has no `delayed_sip` value — only the live-quote feed does. */
function toHistoricalFeed(
  feed: 'iex' | 'sip' | 'delayed_sip' | 'otc',
): 'iex' | 'sip' | 'otc' | undefined {
  return feed === 'delayed_sip' ? undefined : feed;
}

/**
 * The sole file in this codebase importing the Alpaca SDK (T37 — INV-13, INV-17).
 * Enforced by `test/provider.alpaca.contract.test.ts`'s source-scan boundary test.
 */
export interface AlpacaMarketDataClient {
  fetchSnapshots(symbols: string[]): Promise<AlpacaSnapshotMap>;
  fetchDailyBars(symbol: string, start: Date, end: Date): Promise<AlpacaBar[]>;
  fetchClock(): Promise<AlpacaClock>;
  fetchAssets(): Promise<AlpacaAsset[]>;
  fetchMostActives(top: number): Promise<AlpacaMostActive[]>;
}

export interface AlpacaClientOptions {
  readonly keyId: string;
  readonly secret: string;
  /** Feed tier (§ capability verification: paper accounts get `iex`). Defaults to `iex`. */
  readonly feed?: 'iex' | 'sip' | 'delayed_sip' | 'otc';
  /** Overrides the fetch implementation — tests only, to stub HTTP without a live network call. */
  readonly fetchApi?: typeof fetch;
}

/**
 * Wraps the official Alpaca Node SDK. The SDK's own proactive rate limiter
 * (~200 requests/minute per host, applied independently to trading vs. market-data) and its
 * default retry/backoff policy (3 attempts, exponential 250ms..5s, on 429/5xx, safe verbs only)
 * are left at their documented defaults rather than reimplemented here — this is "a global
 * token bucket and backoff on 429/5xx" per T37, already built into the SDK layer this file wraps.
 */
export function createAlpacaClient(options: AlpacaClientOptions): AlpacaMarketDataClient {
  const feed = options.feed ?? 'iex';
  const alpaca = new Alpaca({
    keyId: options.keyId,
    secret: options.secret,
    paper: true,
    ...(options.fetchApi !== undefined ? { fetchApi: options.fetchApi } : {}),
  });

  return {
    async fetchSnapshots(symbols: string[]): Promise<AlpacaSnapshotMap> {
      if (symbols.length === 0) return {};
      const resp = await alpaca.marketData.stocks.stockSnapshots({
        symbols: symbols.join(','),
        feed,
      });
      return resp as unknown as AlpacaSnapshotMap;
    },

    async fetchDailyBars(symbol: string, start: Date, end: Date): Promise<AlpacaBar[]> {
      const historicalFeed = toHistoricalFeed(feed);
      const bars = await alpaca.marketData.getStockBarsFor(symbol, {
        timeframe: TimeFrame.Day,
        start,
        end,
        ...(historicalFeed !== undefined ? { feed: historicalFeed } : {}),
      });
      return bars.map((b) => ({
        t: b.timestamp.toISOString(),
        o: b.open,
        h: b.high,
        l: b.low,
        c: b.close,
        v: b.volume,
      }));
    },

    async fetchClock(): Promise<AlpacaClock> {
      const clock = await alpaca.trading.clock.legacyClock();
      return { isOpen: clock.isOpen };
    },

    async fetchAssets(): Promise<AlpacaAsset[]> {
      // One unpaginated call — Alpaca returns the whole US-equity master (~11k rows).
      const assets = await alpaca.trading.assets.getV2Assets({
        status: 'active',
        assetClass: 'us_equity',
      });
      return assets.map((a) => ({
        symbol: a.symbol,
        name: a.name,
        exchange: a.exchange,
        assetClass: a._class,
        status: a.status,
        tradable: a.tradable,
      }));
    },

    async fetchMostActives(top: number): Promise<AlpacaMostActive[]> {
      const resp = await alpaca.marketData.screener.mostActives({ top, by: 'volume' });
      return resp.mostActives.map((a) => ({
        symbol: a.symbol,
        tradeCount: a.tradeCount,
        volume: a.volume,
      }));
    },
  };
}
