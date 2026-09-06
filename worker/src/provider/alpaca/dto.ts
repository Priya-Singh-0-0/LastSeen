/**
 * Alpaca-shaped raw types (T37 — INV-13).
 *
 * Mirror the fields this adapter actually reads from the official SDK's stock-snapshot,
 * historical-bar, and market-clock responses. Not exported past worker/src/provider/alpaca/ —
 * `adapter.ts` normalizes these into domain `Observation`/`DailyBar` values from
 * @stockwatch/contracts before anything else in the worker sees them.
 */

/** A single OHLCV bar, using the wire's abbreviated field names. */
export interface AlpacaBar {
  readonly t: string; // ISO 8601 timestamp
  readonly o: number;
  readonly h: number;
  readonly l: number;
  readonly c: number;
  readonly v: number;
}

export interface AlpacaTrade {
  readonly p: number; // price
  readonly t: string; // ISO 8601 timestamp
}

export interface AlpacaSnapshot {
  readonly latestTrade?: AlpacaTrade;
  readonly dailyBar?: AlpacaBar;
  readonly prevDailyBar?: AlpacaBar;
}

/** Keyed by symbol, as returned by the multi-symbol stock-snapshots endpoint. */
export type AlpacaSnapshotMap = Record<string, AlpacaSnapshot>;

export interface AlpacaClock {
  readonly isOpen: boolean;
}

/** One entry of the screener's most-actives list (defect 8). */
export interface AlpacaMostActive {
  readonly symbol: string;
  readonly tradeCount: number;
  readonly volume: number;
}

/** One entry of the assets master (`GET /v2/assets`), as this adapter reads it. */
export interface AlpacaAsset {
  readonly symbol: string;
  readonly name: string;
  readonly exchange: string;
  readonly assetClass: string;
  readonly status: string;
  readonly tradable: boolean;
}
