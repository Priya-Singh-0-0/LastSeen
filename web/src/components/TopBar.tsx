import { useState } from 'react';
import type { FormEvent } from 'react';
import { formatRelativeTime } from '../format.js';
import type { WatchlistWire } from '../types.js';

export interface WatchlistNameFormProps {
  readonly initialValue?: string;
  readonly submitLabel: string;
  readonly onSubmit: (name: string) => Promise<void>;
  readonly onCancel?: () => void;
}

/**
 * The shared inline-form shape for both creating and renaming a watchlist (brief: "the same
 * shape of inline form"). A failed submit keeps the form open with the typed value intact and
 * shows the failure locally (mirroring AddInstrumentForm's inline `status` treatment) — it must
 * never rely on an app-wide error state that would unmount this very form.
 */
export function WatchlistNameForm({ initialValue = '', submitLabel, onSubmit, onCancel }: WatchlistNameFormProps) {
  const [value, setValue] = useState(initialValue);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = value.trim();
    if (name === '') return;
    setPending(true);
    setError(null);
    try {
      await onSubmit(name);
      setValue('');
    } catch (err) {
      // Preserve the typed value so the user can retry; show the failure right here.
      setError(err instanceof Error ? err.message : 'Failed to save the watchlist name.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="watchlist-name-form" onSubmit={(event) => void handleSubmit(event)}>
      <input
        type="text"
        className="watchlist-name-form__input"
        aria-label="Watchlist name"
        maxLength={100}
        required
        value={value}
        onChange={(event) => setValue(event.target.value)}
        disabled={pending}
      />
      <button type="submit" className="button button--primary" disabled={pending}>
        {submitLabel}
      </button>
      {onCancel ? (
        <button type="button" className="button" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
      ) : null}
      {error !== null ? (
        <p className="watchlist-name-form__error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export interface TopBarProps {
  readonly watchlists: readonly WatchlistWire[];
  readonly selectedWatchlistId: string;
  readonly onSelectWatchlist: (id: string) => void;
  readonly lastCheckedAt: string | null;
  readonly onSignOut: () => void;
  readonly onCreateWatchlist: (name: string) => Promise<void>;
  readonly onRenameWatchlist: (id: string, name: string) => Promise<void>;
  readonly onDeleteWatchlist: (id: string) => Promise<void>;
}

type OpenForm = 'none' | 'create' | 'rename' | 'delete';

export function TopBar({
  watchlists,
  selectedWatchlistId,
  onSelectWatchlist,
  lastCheckedAt,
  onSignOut,
  onCreateWatchlist,
  onRenameWatchlist,
  onDeleteWatchlist,
}: TopBarProps) {
  const [openForm, setOpenForm] = useState<OpenForm>('none');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const selected = watchlists.find((wl) => wl.id === selectedWatchlistId);

  async function handleCreateSubmit(name: string) {
    await onCreateWatchlist(name);
    setOpenForm('none');
  }

  async function handleRenameSubmit(name: string) {
    if (!selected) return;
    await onRenameWatchlist(selected.id, name);
    setOpenForm('none');
  }

  function openDeleteConfirm() {
    setDeleteError(null);
    setOpenForm('delete');
  }

  function cancelDeleteConfirm() {
    setDeleteError(null);
    setOpenForm('none');
  }

  async function handleDeleteConfirm() {
    if (!selected) return;
    setDeleteError(null);
    try {
      await onDeleteWatchlist(selected.id);
      setOpenForm('none');
    } catch (err) {
      // Keep the confirm open — with the failure shown right here — so the user can retry.
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete the watchlist.');
    }
  }

  return (
    <header className="top-bar">
      <span className="top-bar__wordmark">LastSeen</span>
      {watchlists.length > 0 ? (
        <>
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
          {openForm === 'create' ? (
            <WatchlistNameForm submitLabel="Create" onSubmit={handleCreateSubmit} onCancel={() => setOpenForm('none')} />
          ) : (
            <button type="button" className="button" onClick={() => setOpenForm('create')}>
              New watchlist
            </button>
          )}
          {selected ? (
            openForm === 'rename' ? (
              <WatchlistNameForm
                key={`rename-${selected.id}`}
                initialValue={selected.name}
                submitLabel="Save"
                onSubmit={handleRenameSubmit}
                onCancel={() => setOpenForm('none')}
              />
            ) : (
              <button type="button" className="button" onClick={() => setOpenForm('rename')}>
                Rename
              </button>
            )
          ) : null}
          {selected ? (
            openForm === 'delete' ? (
              <span className="watchlist-delete-confirm">
                <span>Delete &apos;{selected.name}&apos;? This removes the watchlist, not your account.</span>
                <button type="button" className="button" onClick={() => void handleDeleteConfirm()}>
                  Delete
                </button>
                <button type="button" className="button" onClick={cancelDeleteConfirm}>
                  Cancel
                </button>
                {deleteError !== null ? (
                  <span className="watchlist-delete-confirm__error" role="alert">
                    {deleteError}
                  </span>
                ) : null}
              </span>
            ) : (
              <button type="button" className="button" onClick={openDeleteConfirm}>
                Delete
              </button>
            )
          ) : null}
        </>
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
