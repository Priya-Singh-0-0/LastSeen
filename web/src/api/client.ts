import type {
  AddItemResultWire,
  BarsResponse,
  InboxResponse,
  InstrumentDetailResponse,
  SearchResultWire,
  WatchlistItemWire,
  WatchlistWire,
} from '../types.js';

/**
 * A 401 is a distinct, expected outcome (no session yet) — never thrown as a generic error.
 * Callers branch on `ApiError.status` rather than parsing message strings.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Only declare a JSON body when there actually is one. Fastify rejects a bodyless request
  // that still carries `Content-Type: application/json` with 400 FST_ERR_CTP_EMPTY_JSON_BODY —
  // which is what silently broke sign-out, watchlist delete, and instrument removal.
  const headers: Record<string, string> = {
    ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(init?.headers as Record<string, string> | undefined),
  };
  const res = await fetch(`/api${path}`, { credentials: 'include', ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as Record<string, unknown>);
    const message = typeof body.error === 'string' ? body.error : `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function login(email: string, password: string): Promise<{ ok: true }> {
  return request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
}

export function logout(): Promise<{ ok: true }> {
  return request('/auth/logout', { method: 'POST' });
}

export function getWatchlists(): Promise<readonly WatchlistWire[]> {
  return request('/watchlists');
}

export function getInbox(watchlistId: string): Promise<InboxResponse> {
  return request(`/watchlists/${watchlistId}/inbox`);
}

/**
 * Resolves a stock's detail sheet by symbol — servable whether or not it has been starred
 * (identity always comes from the catalog; the full envelope only once an instrument row
 * exists). See `api/src/instruments/routes.ts`'s `by-symbol` route.
 */
export function getInstrumentBySymbol(symbol: string): Promise<InstrumentDetailResponse> {
  return request(`/instruments/by-symbol/${encodeURIComponent(symbol)}`);
}

/**
 * OHLCV history for the price chart. The `range` block (high, low, change) is computed by the
 * API — the chart plots what it is given and derives no financial value of its own.
 */
export function getInstrumentBars(instrumentId: string, days = 260): Promise<BarsResponse> {
  return request(`/instruments/${instrumentId}/bars?days=${days}`);
}

export function acknowledge(instrumentId: string, ackToken: string): Promise<void> {
  return request(`/instruments/${instrumentId}/acknowledge`, {
    method: 'POST',
    body: JSON.stringify({ ack_token: ackToken }),
  });
}

export function register(email: string, password: string): Promise<{ id: string }> {
  return request('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) });
}

export function createWatchlist(name: string): Promise<WatchlistWire> {
  return request('/watchlists', { method: 'POST', body: JSON.stringify({ name }) });
}

export function renameWatchlist(id: string, name: string): Promise<{ ok: true }> {
  return request(`/watchlists/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
}

export function deleteWatchlist(id: string): Promise<void> {
  return request(`/watchlists/${id}`, { method: 'DELETE' });
}

export function getWatchlistItems(watchlistId: string): Promise<readonly WatchlistItemWire[]> {
  return request(`/watchlists/${watchlistId}/items`);
}

export function addWatchlistItem(
  watchlistId: string,
  symbol: string,
): Promise<AddItemResultWire> {
  return request(`/watchlists/${watchlistId}/items`, {
    method: 'POST',
    body: JSON.stringify({ symbol }),
  });
}

export function removeWatchlistItem(watchlistId: string, itemId: string): Promise<void> {
  return request(`/watchlists/${watchlistId}/items/${itemId}`, { method: 'DELETE' });
}

export async function searchInstruments(
  q: string,
  signal?: AbortSignal,
): Promise<readonly SearchResultWire[]> {
  const { results } = await request<{ results: readonly SearchResultWire[] }>(
    `/instruments/search?q=${encodeURIComponent(q)}`,
    signal ? { signal } : undefined,
  );
  return results;
}

/**
 * The empty watchlist's suggestion board (defect 8) — same shape as search results, a
 * stored provider fact (the worker's screener sync), never a client-side guess.
 */
export async function getPopularStocks(): Promise<readonly SearchResultWire[]> {
  const { results } = await request<{ results: readonly SearchResultWire[] }>('/popular');
  return results;
}
