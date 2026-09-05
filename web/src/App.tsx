import { useCallback, useEffect, useState } from 'react';
import * as api from './api/client.js';
import { ApiError } from './api/client.js';
import { ErrorState } from './components/ErrorState.js';
import { SignInView } from './components/SignInView.js';
import { SummaryStrip } from './components/SummaryStrip.js';
import { TopBar } from './components/TopBar.js';
import { Inbox } from './pages/Inbox.js';
import { InstrumentDetail } from './pages/InstrumentDetail.js';
import type { InboxResponse, InstrumentDetailResponse, WatchlistWire } from './types.js';

type View = { kind: 'inbox' } | { kind: 'instrument'; id: string };

function parseHash(hash: string): View {
  const match = /^#\/instrument\/([^/]+)$/.exec(hash);
  if (match?.[1]) return { kind: 'instrument', id: match[1] };
  return { kind: 'inbox' };
}

function navigate(view: View): void {
  window.location.hash = view.kind === 'inbox' ? '#/' : `#/instrument/${view.id}`;
}

export function App() {
  const [view, setView] = useState<View>(() => parseHash(window.location.hash));
  const [signedIn, setSignedIn] = useState<boolean | null>(null); // null = still checking
  const [signInError, setSignInError] = useState<string | null>(null);
  const [watchlists, setWatchlists] = useState<readonly WatchlistWire[]>([]);
  const [selectedWatchlistId, setSelectedWatchlistId] = useState<string | null>(null);
  const [inbox, setInbox] = useState<InboxResponse | null>(null);
  const [detail, setDetail] = useState<InstrumentDetailResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);

  useEffect(() => {
    function onHashChange() {
      setView(parseHash(window.location.hash));
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const loadWatchlists = useCallback(async () => {
    try {
      const wls = await api.getWatchlists();
      setWatchlists(wls);
      setSelectedWatchlistId((current) => current ?? wls[0]?.id ?? null);
      setSignedIn(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setSignedIn(false);
      } else {
        setLoadError(err instanceof Error ? err.message : 'Failed to load watchlists');
      }
    }
  }, []);

  useEffect(() => {
    void loadWatchlists();
  }, [loadWatchlists]);

  const loadInbox = useCallback(async (watchlistId: string) => {
    try {
      const data = await api.getInbox(watchlistId);
      setInbox(data);
      setLastCheckedAt(new Date().toISOString());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load inbox');
    }
  }, []);

  useEffect(() => {
    if (signedIn && selectedWatchlistId && view.kind === 'inbox') {
      void loadInbox(selectedWatchlistId);
    }
  }, [signedIn, selectedWatchlistId, view.kind, loadInbox]);

  const loadDetail = useCallback(async (instrumentId: string) => {
    try {
      const data = await api.getInstrument(instrumentId);
      setDetail(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load instrument');
    }
  }, []);

  useEffect(() => {
    if (signedIn && view.kind === 'instrument') {
      void loadDetail(view.id);
    } else {
      setDetail(null);
    }
  }, [signedIn, view, loadDetail]);

  async function handleSignIn(email: string, password: string) {
    try {
      await api.login(email, password);
      setSignInError(null);
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
    await api.logout();
    setSignedIn(false);
    setInbox(null);
    setWatchlists([]);
    setSelectedWatchlistId(null);
  }

  async function handleAcknowledge() {
    if (!detail) return;
    try {
      await api.acknowledge(detail.instrumentId, detail.ackToken);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        // Expired/tampered ack token — refresh detail to get a fresh one and tell the user plainly.
        await loadDetail(detail.instrumentId);
        setLoadError('That acknowledgement was refused — please try again.');
        return;
      }
      setLoadError(err instanceof Error ? err.message : 'Failed to acknowledge');
    }
  }

  if (signedIn === null) return null;
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

  if (loadError !== null) {
    return (
      <ErrorState
        message={loadError}
        onRetry={() => {
          setLoadError(null);
          if (view.kind === 'inbox' && selectedWatchlistId) void loadInbox(selectedWatchlistId);
          if (view.kind === 'instrument') void loadDetail(view.id);
        }}
      />
    );
  }

  if (view.kind === 'instrument') {
    if (!detail) return null;
    return (
      <InstrumentDetail data={detail} onAcknowledge={() => void handleAcknowledge()} onBack={() => navigate({ kind: 'inbox' })} />
    );
  }

  return (
    <div className="app-shell">
      <TopBar
        watchlists={watchlists}
        selectedWatchlistId={selectedWatchlistId ?? ''}
        onSelectWatchlist={setSelectedWatchlistId}
        lastCheckedAt={lastCheckedAt}
        onSignOut={() => void handleSignOut()}
      />
      {inbox ? (
        <>
          <SummaryStrip items={inbox.items} />
          <main className="app-shell__table-wrap">
            <Inbox data={inbox} onSelectInstrument={(id) => navigate({ kind: 'instrument', id })} />
          </main>
        </>
      ) : null}
    </div>
  );
}
