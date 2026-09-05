// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { App } from '../src/App.js';
import type { InboxResponse, WatchlistItemWire, WatchlistWire } from '../src/types.js';

vi.mock('../src/api/client.js', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client.js')>(
    '../src/api/client.js',
  );
  return {
    ...actual,
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    getWatchlists: vi.fn(),
    getInbox: vi.fn(),
    getWatchlistItems: vi.fn(),
    getInstrument: vi.fn(),
    acknowledge: vi.fn(),
    createWatchlist: vi.fn(),
    renameWatchlist: vi.fn(),
    deleteWatchlist: vi.fn(),
    addWatchlistItem: vi.fn(),
    removeWatchlistItem: vi.fn(),
  };
});

import * as api from '../src/api/client.js';

afterEach(cleanup);

beforeEach(() => {
  window.location.hash = '';
  vi.mocked(api.login).mockReset();
  vi.mocked(api.logout).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(api.register).mockReset();
  vi.mocked(api.getWatchlists).mockReset();
  vi.mocked(api.getInbox).mockReset();
  vi.mocked(api.getWatchlistItems).mockReset();
  vi.mocked(api.getInstrument).mockReset();
  vi.mocked(api.acknowledge).mockReset();
  vi.mocked(api.createWatchlist).mockReset();
  vi.mocked(api.renameWatchlist).mockReset();
  vi.mocked(api.deleteWatchlist).mockReset();
  vi.mocked(api.addWatchlistItem).mockReset();
  vi.mocked(api.removeWatchlistItem).mockReset();
});

const watchlist: WatchlistWire = {
  id: 'w1',
  userId: 'u1',
  name: 'Core',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const watchlistTwo: WatchlistWire = {
  id: 'w2',
  userId: 'u1',
  name: 'Growth',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function inboxWith(symbol: string, instrumentId: string): InboxResponse {
  return {
    watchlistId: watchlist.id,
    items: [
      {
        instrumentId,
        symbol,
        exchange: 'NASDAQ',
        comparisonStatus: 'OK',
        dataFreshness: 'FRESH',
        current: {
          value: '100.00',
          currency: 'USD',
          marketTimestamp: '2026-09-04T20:00:00.000Z',
          ingestedAt: '2026-09-04T20:00:05.000Z',
          source: 'alpaca',
          marketStatus: 'OPEN',
          valueKind: 'LIVE',
          dataFreshness: 'FRESH',
          precisionHint: 2,
        },
        percentageChange: '1.00',
        sessionsElapsed: 1,
        unseenCount: 0,
        maxUnseenBand: null,
        maxUnseenScore: null,
        explanation: 'Nothing notable.',
      },
    ],
  };
}

function itemsFor(instrumentId: string): readonly WatchlistItemWire[] {
  return [{ id: 'item-1', instrumentId, addedAt: '2026-01-01T00:00:00.000Z' }];
}

describe('App remove-instrument error handling (T-UI-fix)', () => {
  it('surfaces a failed remove inline via addStatus, not by replacing the screen with ErrorState', async () => {
    vi.mocked(api.getWatchlists).mockResolvedValue([watchlist]);
    vi.mocked(api.getInbox).mockResolvedValue(inboxWith('AAPL', '101'));
    vi.mocked(api.getWatchlistItems).mockResolvedValue(itemsFor('101'));
    vi.mocked(api.removeWatchlistItem).mockRejectedValue(new Error('Remove failed on server'));

    render(<App />);

    await screen.findByText('AAPL');

    fireEvent.click(screen.getByRole('button', { name: 'Remove AAPL from this watchlist' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove AAPL' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Remove failed on server');

    // The screen must not have been replaced with the app-wide ErrorState.
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    // TopBar (and its Sign out affordance) must still be present.
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });
});

describe('App transient UI state resets (T-UI-fix)', () => {
  it('clears addStatus, lastCheckedAt, detail, loadError, and item map on sign out', async () => {
    vi.mocked(api.getWatchlists).mockResolvedValue([watchlist]);
    vi.mocked(api.getInbox).mockResolvedValue(inboxWith('AAPL', '101'));
    vi.mocked(api.getWatchlistItems).mockResolvedValue(itemsFor('101'));
    vi.mocked(api.addWatchlistItem).mockResolvedValue({ instrumentId: '101', state: 'READY' });

    render(<App />);
    await screen.findByText('AAPL');

    // Produce an addStatus banner and a lastCheckedAt value.
    fireEvent.change(screen.getByLabelText('Add a symbol'), { target: { value: 'AAPL' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText(/Added AAPL\./);
    expect(screen.getByText(/Last checked/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(api.logout).toHaveBeenCalled());

    // Sign back in as (possibly) a different user. Hold the new inbox load open so we can
    // inspect the screen in the gap between "watchlists loaded" (TopBar mounts) and "inbox
    // loaded" (the only point at which lastCheckedAt would legitimately be set again) — this is
    // exactly the window in which a stale value from the previous session would leak through.
    let resolveInbox: (value: InboxResponse) => void = () => {};
    const inboxPromise = new Promise<InboxResponse>((resolve) => {
      resolveInbox = resolve;
    });
    vi.mocked(api.getWatchlists).mockResolvedValue([watchlistTwo]);
    vi.mocked(api.getInbox).mockReturnValue(inboxPromise);
    vi.mocked(api.getWatchlistItems).mockResolvedValue([]);
    vi.mocked(api.login).mockResolvedValue({ ok: true });

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'next@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument());

    // No stale artifact from the previous session should be visible before the new inbox lands.
    expect(screen.queryByText(/Added AAPL\./)).not.toBeInTheDocument();
    expect(screen.queryByText(/Last checked/)).not.toBeInTheDocument();

    resolveInbox({ watchlistId: watchlistTwo.id, items: [] });
    await screen.findByText(/nothing on this watchlist yet/i);
  });
});

describe('App watchlist-switch state reset (T-UI-fix)', () => {
  it('clears addStatus when the user switches watchlists', async () => {
    vi.mocked(api.getWatchlists).mockResolvedValue([watchlist, watchlistTwo]);
    vi.mocked(api.getInbox).mockImplementation((watchlistId: string) =>
      Promise.resolve(
        watchlistId === watchlist.id
          ? inboxWith('AAPL', '101')
          : { watchlistId: watchlistTwo.id, items: [] },
      ),
    );
    vi.mocked(api.getWatchlistItems).mockResolvedValue(itemsFor('101'));
    vi.mocked(api.addWatchlistItem).mockResolvedValue({ instrumentId: '101', state: 'READY' });

    render(<App />);
    await screen.findByText('AAPL');

    fireEvent.change(screen.getByLabelText('Add a symbol'), { target: { value: 'AAPL' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText(/Added AAPL\./);

    fireEvent.change(screen.getByLabelText('Watchlist'), { target: { value: watchlistTwo.id } });

    await screen.findByText(/nothing on this watchlist yet/i);
    expect(screen.queryByText(/Added AAPL\./)).not.toBeInTheDocument();
  });
});
