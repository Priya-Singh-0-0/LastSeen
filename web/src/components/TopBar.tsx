import { formatRelativeTime } from '../format.js';
import type { WatchlistWire } from '../types.js';

export interface TopBarProps {
  readonly watchlists: readonly WatchlistWire[];
  readonly selectedWatchlistId: string;
  readonly onSelectWatchlist: (id: string) => void;
  readonly lastCheckedAt: string | null;
  readonly onSignOut: () => void;
}

export function TopBar({ watchlists, selectedWatchlistId, onSelectWatchlist, lastCheckedAt, onSignOut }: TopBarProps) {
  return (
    <header className="top-bar">
      <span className="top-bar__wordmark">LastSeen</span>
      {watchlists.length > 1 ? (
        <select
          className="top-bar__watchlist-select"
          value={selectedWatchlistId}
          onChange={(e) => onSelectWatchlist(e.target.value)}
          aria-label="Watchlist"
        >
          {watchlists.map((wl) => (
            <option key={wl.id} value={wl.id}>
              {wl.name}
            </option>
          ))}
        </select>
      ) : null}
      <span className="top-bar__spacer" />
      {lastCheckedAt !== null ? (
        <span className="top-bar__last-checked" title={lastCheckedAt}>
          Last checked {formatRelativeTime(lastCheckedAt)}
        </span>
      ) : null}
      <button type="button" className="top-bar__sign-out" onClick={onSignOut}>
        Sign out
      </button>
    </header>
  );
}
