import { describe, it, expect, afterEach, vi } from 'vitest';
import { acknowledge, getInbox } from '../src/api/client.js';

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
});
