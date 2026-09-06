// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TopBar } from '../src/components/TopBar.js';

afterEach(cleanup);

/**
 * The top rule is now logo / centred search / account glyph (surface brief §6). Watchlist
 * create/rename/delete and the standalone Add button are gone, so the assertions that covered
 * them are replaced here rather than dropped: the protection they encoded — that watchlist
 * state is never destroyed by a stray click, and that sign out stays reachable — is asserted
 * against the controls that actually exist now.
 */
function renderTopBar(overrides: Partial<Parameters<typeof TopBar>[0]> = {}) {
  const props = {
    onSignOut: vi.fn(),
    search: <input aria-label="Search stocks" />,
    ...overrides,
  };
  render(<TopBar {...props} />);
  return props;
}

describe('TopBar', () => {
  it('renders the wordmark and the search line it was given', () => {
    renderTopBar();
    expect(screen.getByText('LastSeen')).toBeInTheDocument();
    expect(screen.getByLabelText('Search stocks')).toBeInTheDocument();
  });

  it('exposes no watchlist selection, creation, rename, or delete control', () => {
    renderTopBar();
    expect(screen.queryByLabelText('Watchlist')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New watchlist' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('keeps the account menu closed until the glyph is clicked, so sign out is never a stray click', () => {
    const onSignOut = vi.fn();
    renderTopBar({ onSignOut });

    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Account' })).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    expect(screen.getByRole('button', { name: 'Account' })).toHaveAttribute('aria-expanded', 'true');
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it('calls onSignOut when the menu item is chosen', () => {
    const onSignOut = vi.fn();
    renderTopBar({ onSignOut });

    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('closes the account menu on Escape without signing out', () => {
    const onSignOut = vi.fn();
    renderTopBar({ onSignOut });

    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(onSignOut).not.toHaveBeenCalled();
  });
});
