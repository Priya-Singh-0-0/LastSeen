import type { MostActive, Observation } from '@stockwatch/contracts';

/**
 * ProviderAdapter — the boundary between provider-specific code and the rest of the worker (T14).
 *
 * INV-13: Only implementations inside worker/src/provider/ may import Alpaca SDK types.
 *         This interface exposes only domain types from @stockwatch/contracts.
 * INV-2:  The API never calls this interface; it lives only in the worker.
 */
export interface ProviderAdapter {
  /**
   * Fetch the current market observation for a set of symbols.
   * Returns one Observation per symbol in the input list.
   * Symbols with no available data are omitted from the result.
   */
  fetchSnapshots(symbols: string[]): Promise<Observation[]>;

  /**
   * Fetch daily bars for a symbol over a date range.
   * Dates are ISO 8601 YYYY-MM-DD strings.
   */
  fetchDailyBars(
    symbol: string,
    from: string,
    to: string,
  ): Promise<import('@stockwatch/contracts').DailyBar[]>;

  /**
   * Fetch the provider's full tradable-asset master for US equities.
   * Reference data, not market data: one call returns every listed symbol, so this
   * scales with the market's size, never with users or watchlists.
   */
  fetchAssets(): Promise<import('@stockwatch/contracts').AssetRef[]>;

  /**
   * Fetch the provider's screener "most actives" list, ranked by trade volume
   * (defect 8). Reference data — one call covers the whole board, no per-user or
   * per-watchlist fan-out.
   */
  fetchMostActives(limit: number): Promise<MostActive[]>;
}
