import type {
  AddItemResultWire,
  InboxResponse,
  InstrumentDetailResponse,
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
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
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

export function getInstrument(instrumentId: string): Promise<InstrumentDetailResponse> {
  return request(`/instruments/${instrumentId}`);
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
