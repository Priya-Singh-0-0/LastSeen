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
    getInstrumentBySymbol: vi.fn(),
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
  vi.mocked(api.getInstrumentBySymbol).mockReset();
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
  it('surfaces a failed unstar inline via addStatus, not by replacing the screen with ErrorState', async () => {
    vi.mocked(api.getWatchlists).mockResolvedValue([watchlist]);
    vi.mocked(api.getInbox).mockResolvedValue(inboxWith('AAPL', '101'));
    vi.mocked(api.getWatchlistItems).mockResolvedValue(itemsFor('101'));
    vi.mocked(api.removeWatchlistItem).mockRejectedValue(new Error('Remove failed on server'));

    render(<App />);

    await screen.findByText('AAPL');

    // The two-step confirm is gone; the margin star is the whole control now.
    fireEvent.click(screen.getByRole('button', { name: 'Remove AAPL from your watchlist' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Remove failed on server');

    // The screen must not have been replaced with the app-wide ErrorState.
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    // The top rule — and the account control that holds sign out — must still be present.
    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument();
    // And the ledger itself is still on screen, with the row holding its rank position.
    expect(screen.getByText('AAPL')).toBeInTheDocument();
  });
});

describe('App transient UI state resets (T-UI-fix)', () => {
  it('clears addStatus, detail, loadError, and the item map on sign out', async () => {
    vi.mocked(api.getWatchlists).mockResolvedValue([watchlist]);
    vi.mocked(api.getInbox).mockResolvedValue(inboxWith('AAPL', '101'));
    vi.mocked(api.getWatchlistItems).mockResolvedValue(itemsFor('101'));
    vi.mocked(api.addWatchlistItem).mockResolvedValue({ instrumentId: '202', state: 'READY' });

    render(<App />);
    await screen.findByText('AAPL');

    // Produce an addStatus banner. Typing an already-watched symbol (AAPL) would now unstar it
    // instead of re-adding (T-UI-fix defect 3), so an unwatched symbol is used here.
    const searchInput = screen.getByLabelText('Search stocks');
    fireEvent.change(searchInput, { target: { value: 'MSFT' } });
    fireEvent.submit(searchInput.closest('form')!);
    await screen.findByText(/Added MSFT\./);

    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(api.logout).toHaveBeenCalled());

    // Sign back in as (possibly) a different user. Hold the new inbox load open so we can
    // inspect the screen in the gap between "watchlists loaded" (the top rule mounts) and
    // "inbox loaded" — exactly the window in which a value from the previous session would leak
    // through. (The "Updated …" stamp this also used to cover no longer exists: the top rule is
    // wordmark / search / account only, per surface brief §6.)
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

    await waitFor(() => expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument());

    // No stale artifact from the previous session should be visible before the new inbox lands.
    expect(screen.queryByText(/Added MSFT\./)).not.toBeInTheDocument();
    expect(screen.queryByText('AAPL')).not.toBeInTheDocument();

    resolveInbox({ watchlistId: watchlistTwo.id, items: [] });
    await screen.findByText(/nothing on your watchlist yet/i);
  });
});

/**
 * Watchlist selection, creation, rename and deletion are gone from the UI (surface brief §6):
 * the user has exactly one watchlist and never sees it as an object. The switch-reset test that
 * lived here has no subject any more, so what replaces it is the behaviour that took its place —
 * the watchlist is created silently, without ever prompting for a name.
 */
describe('App implicit watchlist (surface brief §2)', () => {
  it('creates a watchlist silently when the user has none, and never asks for a name', async () => {
    vi.mocked(api.getWatchlists).mockResolvedValue([]);
    vi.mocked(api.createWatchlist).mockResolvedValue(watchlist);
    vi.mocked(api.getInbox).mockResolvedValue({ watchlistId: watchlist.id, items: [] });
    vi.mocked(api.getWatchlistItems).mockResolvedValue([]);

    render(<App />);

    await waitFor(() => expect(api.createWatchlist).toHaveBeenCalledTimes(1));
    await screen.findByText(/nothing on your watchlist yet/i);

    expect(screen.queryByLabelText('Watchlist name')).not.toBeInTheDocument();
    expect(screen.queryByText(watchlist.name)).not.toBeInTheDocument();
  });
});
