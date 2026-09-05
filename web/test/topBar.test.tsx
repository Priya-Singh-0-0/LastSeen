// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TopBar } from '../src/components/TopBar.js';
import type { WatchlistWire } from '../src/types.js';

afterEach(cleanup);

function watchlist(id: string, name: string): WatchlistWire {
  return { id, userId: 'u1', name, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
}

function renderTopBar(overrides: Partial<Parameters<typeof TopBar>[0]> = {}) {
  const props = {
    watchlists: [watchlist('wl-1', 'Core')],
    selectedWatchlistId: 'wl-1',
    onSelectWatchlist: vi.fn(),
    lastCheckedAt: null,
    onSignOut: vi.fn(),
    onCreateWatchlist: vi.fn().mockResolvedValue(undefined),
    onRenameWatchlist: vi.fn().mockResolvedValue(undefined),
    onDeleteWatchlist: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(<TopBar {...props} />);
  return props;
}

describe('TopBar (T-UI-4)', () => {
  it('renders the watchlist select with exactly one watchlist (old > 1 behavior would have hidden it)', () => {
    renderTopBar({ watchlists: [watchlist('wl-1', 'Core')] });
    expect(screen.getByLabelText('Watchlist')).toBeInTheDocument();
  });

  it('"New watchlist" reveals a form; submitting calls onCreateWatchlist with the typed name; Cancel hides it and calls nothing', async () => {
    const onCreateWatchlist = vi.fn().mockResolvedValue(undefined);
    renderTopBar({ onCreateWatchlist });

    fireEvent.click(screen.getByRole('button', { name: 'New watchlist' }));
    const input = screen.getByLabelText('Watchlist name');
    fireEvent.change(input, { target: { value: 'Growth' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await vi.waitFor(() => expect(onCreateWatchlist).toHaveBeenCalledWith('Growth'));

    // form hides again on success
    await vi.waitFor(() => expect(screen.queryByLabelText('Watchlist name')).not.toBeInTheDocument());

    // Reopen and cancel — should not call onCreateWatchlist again
    fireEvent.click(screen.getByRole('button', { name: 'New watchlist' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Watchlist name')).not.toBeInTheDocument();
    expect(onCreateWatchlist).toHaveBeenCalledTimes(1);
  });

  it('"Rename" seeds its input with the selected watchlist\'s current name', () => {
    renderTopBar({ watchlists: [watchlist('wl-1', 'Core Holdings')], selectedWatchlistId: 'wl-1' });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(screen.getByLabelText('Watchlist name')).toHaveValue('Core Holdings');
  });

  it('"Delete" does not call onDeleteWatchlist until the confirm is clicked; confirm text names the watchlist; Cancel calls nothing', () => {
    const onDeleteWatchlist = vi.fn().mockResolvedValue(undefined);
    renderTopBar({ watchlists: [watchlist('wl-1', 'Core Holdings')], selectedWatchlistId: 'wl-1', onDeleteWatchlist });

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDeleteWatchlist).not.toHaveBeenCalled();
    expect(screen.getByText(/Delete 'Core Holdings'\?/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onDeleteWatchlist).not.toHaveBeenCalled();
    expect(screen.queryByText(/Delete 'Core Holdings'\?/)).not.toBeInTheDocument();
  });

  it('sign out still works and calls onSignOut', () => {
    const onSignOut = vi.fn();
    renderTopBar({ onSignOut });
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalled();
  });
});
