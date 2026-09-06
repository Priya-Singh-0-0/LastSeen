import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from './api/client.js';
import { ApiError } from './api/client.js';
import { AddInstrumentForm } from './components/AddInstrumentForm.js';
import type { AddInstrumentStatus } from './components/AddInstrumentForm.js';
import { ErrorState } from './components/ErrorState.js';
import { LoadingState } from './components/LoadingState.js';
import { SignInView } from './components/SignInView.js';
import { TopBar } from './components/TopBar.js';
import { Inbox, InboxSkeleton } from './pages/Inbox.js';
import { InstrumentDetail } from './pages/InstrumentDetail.js';
import type {
  BarsResponse,
  InboxResponse,
  InstrumentDetailResponse,
  SearchResultWire,
} from './types.js';

type View = { kind: 'inbox' } | { kind: 'stock'; symbol: string };

/** The implicit watchlist's name. It is never shown: the user has exactly one, always. */
const DEFAULT_WATCHLIST_NAME = 'Watchlist';

/** Warming poll cadence: the worker's job runner drains every ~2s, so match it and give up
 *  after ~40s rather than hammering an instrument the provider simply has no data for. */
const WARMING_POLL_MS = 2000;
const WARMING_POLL_ATTEMPTS = 20;

function parseHash(hash: string): View {
  const match = /^#\/stock\/([^/]+)$/.exec(hash);
  if (match?.[1]) return { kind: 'stock', symbol: decodeURIComponent(match[1]) };
  return { kind: 'inbox' };
}

function navigate(view: View): void {
  window.location.hash = view.kind === 'inbox' ? '#/' : `#/stock/${encodeURIComponent(view.symbol)}`;
}

export function App() {
  const [view, setView] = useState<View>(() => parseHash(window.location.hash));
  const [signedIn, setSignedIn] = useState<boolean | null>(null); // null = still checking
  const [signInError, setSignInError] = useState<string | null>(null);
  const [selectedWatchlistId, setSelectedWatchlistId] = useState<string | null>(null);
  const [inbox, setInbox] = useState<InboxResponse | null>(null);
  const [itemIdByInstrumentId, setItemIdByInstrumentId] = useState<ReadonlyMap<string, string>>(
    new Map(),
  );
  const [removingIds, setRemovingIds] = useState<ReadonlySet<string>>(new Set());
  const [addStatus, setAddStatus] = useState<AddInstrumentStatus>({ kind: 'idle' });
  const [detail, setDetail] = useState<InstrumentDetailResponse | null>(null);
  const [bars, setBars] = useState<BarsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [popular, setPopular] = useState<readonly SearchResultWire[]>([]);

  useEffect(() => {
    function onHashChange() {
      setView(parseHash(window.location.hash));
      // The "Added X." toast is feedback for the view it happened on — it must not follow
      // the user onto whatever they navigate to next.
      setAddStatus({ kind: 'idle' });
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const loadWatchlists = useCallback(async () => {
    try {
      const wls = await api.getWatchlists();
      // Exactly one watchlist per user, created silently. The user never names, picks, or
      // manages one — it is an implementation detail of "your watchlist".
      if (wls.length === 0) {
        const created = await api.createWatchlist(DEFAULT_WATCHLIST_NAME);
        setSelectedWatchlistId(created?.id ?? null);
      } else {
        setSelectedWatchlistId((current) => current ?? wls[0]?.id ?? null);
      }
      setSignedIn(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setSignedIn(false);
      } else {
        setLoadError(err instanceof Error ? err.message : 'Failed to load your watchlist');
        setSignedIn(true);
      }
    }
  }, []);

  useEffect(() => {
    void loadWatchlists();
  }, [loadWatchlists]);

  const loadInbox = useCallback(async (watchlistId: string) => {
    try {
      const [data, items] = await Promise.all([
        api.getInbox(watchlistId),
        api.getWatchlistItems(watchlistId),
      ]);
      setInbox(data);
      setItemIdByInstrumentId(new Map(items.map((item) => [item.instrumentId, item.id])));
      setRemovingIds(new Set());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load your watchlist');
    }
  }, []);

  // Watchlist membership (`inbox`, `itemIdByInstrumentId`) is app-level state, not
  // inbox-view-only: the search box and the detail star both need it to render starred
  // correctly no matter which view is mounted. Still refetched on every view transition so
  // navigating back to the ledger picks up unseen-count changes from an acknowledge.
  useEffect(() => {
    if (signedIn && selectedWatchlistId) {
      void loadInbox(selectedWatchlistId);
    }
  }, [signedIn, selectedWatchlistId, view.kind, loadInbox]);

  // The empty-watchlist suggestion board (defect 8) — a stored worker fact, fetched once per
  // session rather than on every inbox read, since it changes on the worker's own slow cadence.
  useEffect(() => {
    if (!signedIn) return;
    void api
      .getPopularStocks()
      .then(setPopular)
      .catch(() => {
        // Non-critical: the board simply stays empty and the empty state falls back to its
        // plain copy. Never surfaced as `loadError`, which would replace the ledger itself.
      });
  }, [signedIn]);

  const loadDetail = useCallback(async (symbol: string) => {
    try {
      const data = await api.getInstrumentBySymbol(symbol);
      setDetail(data);
      setLoadError(null);

      // Bars are a second, non-blocking request: the sheet is useful without a chart, so a
      // missing or failed history must never take the whole page down. An instrument with no
      // bars yet (just registered, backfill still queued) simply renders no chart.
      setBars(null);
      if (data.instrumentId !== null) {
        api
          .getInstrumentBars(data.instrumentId)
          .then(setBars)
          .catch(() => {
            // Non-critical, same reasoning as the popular board.
          });
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load this stock');
    }
  }, []);

  useEffect(() => {
    if (signedIn && view.kind === 'stock') {
      void loadDetail(view.symbol);
    } else {
      setDetail(null);
      setBars(null);
    }
  }, [signedIn, view, loadDetail]);

  // Re-fetch while a freshly registered instrument is still warming.
  //
  // Opening a stock nobody has viewed before *enqueues* its ingestion, so the response to that
  // very request is legitimately empty — the worker fills it in a second or two later. Without
  // this the page rendered "warming up" and never looked again, which read as a permanent
  // failure even though the price had landed almost immediately.
  //
  // A re-armed `setTimeout` rather than an interval: each poll is scheduled only after the
  // previous load has settled, so a slow response can't stack requests. The attempt counter
  // lives in a ref and resets per symbol — putting it in state would re-trigger this effect and
  // restart its own cap.
  const warmAttempts = useRef(0);
  useEffect(() => {
    warmAttempts.current = 0;
  }, [view]);

  useEffect(() => {
    if (!signedIn || view.kind !== 'stock' || detail === null) return;

    const priceReady = detail.current !== null;
    const chartReady = bars !== null && bars.bars.length > 0;
    if (priceReady && chartReady) return;
    if (warmAttempts.current >= WARMING_POLL_ATTEMPTS) return;

    const timer = setTimeout(() => {
      warmAttempts.current += 1;
      void loadDetail(view.symbol);
    }, WARMING_POLL_MS);
    return () => clearTimeout(timer);
  }, [signedIn, view, detail, bars, loadDetail]);

  async function handleSignIn(email: string, password: string) {
    try {
      await api.login(email, password);
      setSignInError(null);
      // Auth is an entry point, not a resumption: the previous session's URL has no claim
      // on a new one. A stale #/stock/:symbol hash left over from before sign-in would
      // otherwise route the newly authenticated user straight into a detail view they may
      // not be able to see.
      navigate({ kind: 'inbox' });
      setView({ kind: 'inbox' });
      await loadWatchlists();
    } catch (err) {
      setSignInError(err instanceof Error ? err.message : 'Sign-in failed');
    }
  }

  async function handleRegister(email: string, password: string) {
    try {
      await api.register(email, password);
      await api.login(email, password);
      setSignInError(null);
      navigate({ kind: 'inbox' });
      setView({ kind: 'inbox' });
      await loadWatchlists();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setSignInError('An account with that email already exists.');
      } else if (err instanceof ApiError && err.status === 400) {
        setSignInError('Check your email and password — passwords need at least 8 characters.');
      } else {
        setSignInError(err instanceof Error ? err.message : 'Registration failed');
      }
    }
  }

  async function handleSignOut() {
    // Sign out locally whatever the server says. A failed POST /auth/logout must never leave the
    // user staring at a dead button — the worst case is a session row that outlives its cookie.
    try {
      await api.logout();
    } catch {
      // Intentionally swallowed: the local sign-out below is the user-visible contract.
    }
    setSignedIn(false);
    setInbox(null);
    setSelectedWatchlistId(null);
    setItemIdByInstrumentId(new Map());
    setRemovingIds(new Set());
    setAddStatus({ kind: 'idle' });
    setDetail(null);
    setLoadError(null);
  }

  async function handleAcknowledge() {
    // Catalog-only stocks (no instrument row yet) have no ackToken and no unseen changes to
    // acknowledge — this should be unreachable via the UI, but guards the type regardless.
    if (!detail || detail.instrumentId === null || detail.ackToken === null) return;
    try {
      await api.acknowledge(detail.instrumentId, detail.ackToken);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        // A refused token is non-destructive: the changes simply stay unread. Refresh the sheet
        // for a fresh token and say so quietly rather than raising a dialog.
        await loadDetail(detail.symbol);
        setLoadError('That acknowledgement was refused — the changes are still unread.');
        return;
      }
      setLoadError(err instanceof Error ? err.message : 'Failed to acknowledge');
    }
  }

  async function handleAddInstrument(symbol: string) {
    if (!selectedWatchlistId) return;
    try {
      const result = await api.addWatchlistItem(selectedWatchlistId, symbol);
      setAddStatus({ kind: 'added', symbol, state: result.state });
      await loadInbox(selectedWatchlistId);
    } catch (err) {
      setAddStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to add that stock',
      });
      throw err;
    }
  }

  async function handleRemoveInstrument(instrumentId: string) {
    if (!selectedWatchlistId) return;
    const itemId = itemIdByInstrumentId.get(instrumentId);
    if (itemId === undefined) {
      // The map is stale relative to a concurrent change — refetch rather than guessing an id.
      await loadInbox(selectedWatchlistId);
      return;
    }
    // The row holds its rank position while the unstar is in flight, and only disappears on the
    // next successful read. It is never animated out from under the cursor.
    setRemovingIds((current) => new Set(current).add(instrumentId));
    try {
      await api.removeWatchlistItem(selectedWatchlistId, itemId);
      await loadInbox(selectedWatchlistId);
    } catch (err) {
      // Report inline like every other mutation on this screen rather than via the app-wide
      // `loadError`, which would replace the ledger — and the top rule's sign-out — for what is
      // a routine, recoverable failure. Unstarring is undone by starring again, so a mis-click
      // is reversible without a confirmation step.
      setRemovingIds((current) => {
        const next = new Set(current);
        next.delete(instrumentId);
        return next;
      });
      setAddStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to remove that stock',
      });
    }
  }

  const watchedSymbols = useMemo(
    () => new Set((inbox?.items ?? []).map((item) => item.symbol)),
    [inbox],
  );

  function handleRemoveSymbol(symbol: string) {
    const match = (inbox?.items ?? []).find((item) => item.symbol === symbol);
    if (match) void handleRemoveInstrument(match.instrumentId);
  }

  /**
   * The detail sheet's own star — the same starring mechanic as the ledger and search, reachable
   * from a stock that isn't watched yet. Starring promotes a catalogue-only sheet to the full one
   * on the next read (`resolveOrRegisterSymbol`); the reload below picks that up.
   */
  async function handleToggleDetailStar() {
    if (!detail) return;
    try {
      if (watchedSymbols.has(detail.symbol)) {
        if (detail.instrumentId !== null) await handleRemoveInstrument(detail.instrumentId);
      } else {
        await handleAddInstrument(detail.symbol);
      }
    } catch {
      // Status is already reported by handleAddInstrument/handleRemoveInstrument.
    }
    await loadDetail(detail.symbol);
  }

  if (signedIn === null) return <LoadingState label="Checking your session…" />;
  if (signedIn === false) {
    return (
      <SignInView
        onSignIn={handleSignIn}
        onRegister={handleRegister}
        error={signInError}
        onModeChange={() => setSignInError(null)}
      />
    );
  }

  // Rendered inside the top rule so it is operable while the ledger is still loading — a user
  // who knows what they want to add should not wait on a list they are not reading.
  const search = (
    <AddInstrumentForm
      onAdd={handleAddInstrument}
      status={addStatus}
      onDismissStatus={() => setAddStatus({ kind: 'idle' })}
      onSearch={api.searchInstruments}
      watchedSymbols={watchedSymbols}
      onRemoveSymbol={handleRemoveSymbol}
      onSelectSymbol={(symbol) => navigate({ kind: 'stock', symbol })}
    />
  );

  return (
    <div className="app-shell">
      <TopBar onSignOut={() => void handleSignOut()} search={search} />
      <main className="app-shell__main">
        {loadError !== null ? (
          <ErrorState
            message={loadError}
            onRetry={() => {
              setLoadError(null);
              if (view.kind === 'inbox' && selectedWatchlistId) void loadInbox(selectedWatchlistId);
              if (view.kind === 'stock') void loadDetail(view.symbol);
            }}
          />
        ) : view.kind === 'stock' ? (
          detail ? (
            <InstrumentDetail
              data={detail}
              watched={watchedSymbols.has(detail.symbol)}
              bars={bars}
              onToggleStar={() => void handleToggleDetailStar()}
              onAcknowledge={() => void handleAcknowledge()}
              onBack={() => navigate({ kind: 'inbox' })}
            />
          ) : (
            <LoadingState label="Loading this stock…" />
          )
        ) : inbox ? (
          <Inbox
            data={inbox}
            removingIds={removingIds}
            onSelectInstrument={(symbol) => navigate({ kind: 'stock', symbol })}
            onRemoveInstrument={(id) => void handleRemoveInstrument(id)}
            popular={popular}
            onSelectSymbol={(symbol) => navigate({ kind: 'stock', symbol })}
            onAddSymbol={(symbol) => void handleAddInstrument(symbol).catch(() => {})}
            onRemoveSymbol={handleRemoveSymbol}
          />
        ) : (
          <InboxSkeleton />
        )}
      </main>
    </div>
  );
}
