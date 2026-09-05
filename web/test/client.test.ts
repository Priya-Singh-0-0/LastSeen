import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  acknowledge,
  addWatchlistItem,
  createWatchlist,
  deleteWatchlist,
  getInbox,
  getWatchlistItems,
  register,
  removeWatchlistItem,
  renameWatchlist,
  ApiError,
} from '../src/api/client.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: () => Promise.resolve(response),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('api client (T40)', () => {
  it('sends credentials: include on every request', async () => {
    const fetchMock = stubFetch({ watchlistId: '1', items: [] });
    await getInbox('1');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe('include');
  });

  it('posts the ack_token from the detail response when acknowledging', async () => {
    const fetchMock = stubFetch({ ok: true });
    await acknowledge('101', 'opaque-token');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/instruments/101/acknowledge');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ ack_token: 'opaque-token' });
  });

  it('sends both credentials: include and Content-Type: application/json on a POST', async () => {
    const fetchMock = stubFetch({ ok: true });
    await createWatchlist('Tech');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('registers a user with POST /auth/register', async () => {
    const fetchMock = stubFetch({ id: '42' }, 201);
    const result = await register('a@b.com', 'password123');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/register');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ email: 'a@b.com', password: 'password123' });
    expect(result).toEqual({ id: '42' });
  });

  it('throws an ApiError with status 409 when register conflicts', async () => {
    stubFetch({ error: 'Email already registered' }, 409);
    await expect(register('a@b.com', 'password123')).rejects.toMatchObject({
      status: 409,
    });
    await expect(register('a@b.com', 'password123')).rejects.toBeInstanceOf(ApiError);
  });

  it('creates a watchlist with POST /watchlists', async () => {
    const wl = {
      id: '1',
      userId: '9',
      name: 'Tech',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const fetchMock = stubFetch(wl, 201);
    const result = await createWatchlist('Tech');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/watchlists');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Tech' });
    expect(result).toEqual(wl);
  });

  it('renames a watchlist with PATCH /watchlists/:id', async () => {
    const fetchMock = stubFetch({ ok: true });
    const result = await renameWatchlist('1', 'Renamed');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/watchlists/1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Renamed' });
    expect(result).toEqual({ ok: true });
  });

  it('deletes a watchlist with DELETE /watchlists/:id and resolves on 204 with no body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: () => Promise.reject(new Error('should not be called for 204')),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(deleteWatchlist('1')).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/watchlists/1');
    expect(init.method).toBe('DELETE');
  });

  it('fetches watchlist items with GET /watchlists/:id/items', async () => {
    const items = [{ id: '1', instrumentId: '2', addedAt: '2026-01-01T00:00:00.000Z' }];
    const fetchMock = stubFetch(items);
    const result = await getWatchlistItems('1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/watchlists/1/items');
    expect(init.method).toBeUndefined();
    expect(result).toEqual(items);
  });

  it('adds a watchlist item with POST /watchlists/:id/items', async () => {
    const fetchMock = stubFetch({ instrumentId: '2', state: 'WARMING' }, 201);
    const result = await addWatchlistItem('1', 'AAPL');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/watchlists/1/items');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ symbol: 'AAPL' });
    expect(result).toEqual({ instrumentId: '2', state: 'WARMING' });
  });

  it('removes a watchlist item with DELETE /watchlists/:id/items/:itemId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: () => Promise.reject(new Error('should not be called for 204')),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(removeWatchlistItem('1', '2')).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/watchlists/1/items/2');
    expect(init.method).toBe('DELETE');
  });
});
