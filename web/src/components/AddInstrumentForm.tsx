import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { SearchGlyph, StarGlyph } from './icons.js';
import type { SearchResultWire } from '../types.js';

export type AddInstrumentStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'added'; readonly symbol: string; readonly state: 'WARMING' | 'READY' };

export interface AddInstrumentFormProps {
  readonly onAdd: (symbol: string) => Promise<void>;
  readonly status: AddInstrumentStatus;
  readonly onDismissStatus: () => void;
  /**
   * Symbol search. Optional: without it the box is still a working blind add-by-symbol
   * field, just with no suggestions — which is also what it degrades to whenever the
   * catalog has not been synced.
   */
  readonly onSearch?: (q: string, signal: AbortSignal) => Promise<readonly SearchResultWire[]>;
  /** Symbols already on the watchlist, so a result reads as starred the moment it renders. */
  readonly watchedSymbols?: ReadonlySet<string>;
  /** Unstarring a result that is already watched. Absent means results only ever star. */
  readonly onRemoveSymbol?: (symbol: string) => void;
  /** Opens a result's stock detail page. Picking a result navigates; only the star toggles. */
  readonly onSelectSymbol: (symbol: string) => void;
}

/** Long enough that a keystroke burst is one request, short enough to feel immediate. */
const DEBOUNCE_MS = 180;

type ListState = 'idle' | 'results' | 'empty';

/**
 * The search line in the top rule, and the only way a stock enters the watchlist.
 *
 * Suggestions come from `GET /instruments/search`, which reads the worker-synced asset
 * catalog — every symbol and company name shown is a stored provider fact. Nothing is
 * matched client-side against a bundled ticker list (CLAUDE.md: the frontend never
 * originates financial facts).
 *
 * A symbol absent from the catalog can still be submitted directly: the API resolves
 * symbols asynchronously, so a successful submit reports 'added' (READY or WARMING) and
 * never symbol-not-found — the UI genuinely cannot tell "warming up" from "typo".
 *
 * Picking a result opens its stock detail page. The star is the only toggle — a sibling
 * `<button>` that stops propagation before the option's own click navigates, the same pattern
 * the ledger margin's remove control already uses.
 */
export function AddInstrumentForm({
  onAdd,
  status,
  onDismissStatus,
  onSearch,
  watchedSymbols,
  onRemoveSymbol,
  onSelectSymbol,
}: AddInstrumentFormProps) {
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const [results, setResults] = useState<readonly SearchResultWire[]>([]);
  const [listState, setListState] = useState<ListState>('idle');
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const listboxId = useId();

  // Latest-wins: an in-flight search for a stale prefix is aborted, never rendered.
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (onSearch === undefined) return;
    const q = value.trim();
    if (q === '') {
      setResults([]);
      setListState('idle');
      setOpen(false);
      return;
    }

    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      void onSearch(q, controller.signal)
        .then((found) => {
          if (controller.signal.aborted) return;
          setResults(found);
          setListState(found.length > 0 ? 'results' : 'empty');
          setOpen(true);
          setHighlighted(-1);
        })
        .catch(() => {
          // A failed search is not a failed add — the box stays usable, without suggestions.
          if (!controller.signal.aborted) {
            setResults([]);
            setListState('idle');
            setOpen(false);
          }
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [value, onSearch]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // The 'added' toast is transient feedback, not a persistent status line: it clears itself
  // so a refresh (or navigating away, handled by the parent resetting `status`) is never the
  // only way to dismiss it.
  useEffect(() => {
    if (status.kind !== 'added') return;
    const timer = setTimeout(onDismissStatus, 4000);
    return () => clearTimeout(timer);
  }, [status, onDismissStatus]);

  function isWatched(symbol: string): boolean {
    return watchedSymbols?.has(symbol) ?? false;
  }

  async function submit(symbol: string) {
    if (symbol === '') return;
    setPending(true);
    setOpen(false);
    try {
      await onAdd(symbol);
      setValue('');
      setResults([]);
      setListState('idle');
    } catch {
      // The parent owns error presentation via `status`; the input is preserved for correction.
    } finally {
      setPending(false);
    }
  }

  /** Picking a result toggles it: starred stocks are unstarred, unstarred ones are starred. */
  function choose(symbol: string) {
    if (isWatched(symbol) && onRemoveSymbol) {
      setOpen(false);
      onRemoveSymbol(symbol);
      return;
    }
    void submit(symbol);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const chosen = highlighted >= 0 ? results[highlighted] : undefined;
    if (chosen) {
      // Enter on a highlighted result opens its detail page, same as clicking it — the star
      // is the only toggle now.
      setOpen(false);
      onSelectSymbol(chosen.symbol);
      return;
    }
    // Typed blind (no result highlighted) still goes through `choose`: a symbol already on the
    // watchlist must unstar, not silently re-POST an idempotent add and report "Added" for a
    // stock that was already there.
    choose(value.trim().toUpperCase());
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((i) => (i + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      setHighlighted(-1);
    }
  }

  const activeId =
    highlighted >= 0 && results[highlighted]
      ? `${listboxId}-option-${results[highlighted].symbol}`
      : undefined;

  return (
    <form className="search" onSubmit={handleSubmit} role="search" aria-busy={pending}>
      <div className="search__line">
        <span className="search__glyph">
          <SearchGlyph />
        </span>
        <input
          type="text"
          className="search__input"
          aria-label="Search stocks"
          placeholder="Search by ticker or company"
          maxLength={32}
          required
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          {...(activeId ? { 'aria-activedescendant': activeId } : {})}
          autoComplete="off"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          disabled={pending}
        />
      </div>

      {open && listState === 'results' ? (
        <ul className="search__results" id={listboxId} role="listbox" aria-label="Search results">
          {results.map((result, index) => {
            const watched = isWatched(result.symbol);
            return (
              <li
                key={result.symbol}
                id={`${listboxId}-option-${result.symbol}`}
                role="option"
                aria-selected={index === highlighted}
                className={`search__result ${index === highlighted ? 'is-active' : ''}`}
                onMouseDown={(event) => {
                  // mousedown, not click: blur would close the list before click fires.
                  event.preventDefault();
                }}
                onClick={() => {
                  setOpen(false);
                  onSelectSymbol(result.symbol);
                }}
                onMouseEnter={() => setHighlighted(index)}
              >
                <button
                  type="button"
                  className={`search__star ${watched ? 'is-watched' : ''}`}
                  aria-label={
                    watched
                      ? `Remove ${result.symbol} from your watchlist`
                      : `Add ${result.symbol} to your watchlist`
                  }
                  onMouseDown={(event) => {
                    // Also prevent default, same as the option's own mousedown: without it,
                    // stopping propagation here would let the input blur and close the list
                    // before the click below fires.
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    choose(result.symbol);
                  }}
                >
                  <StarGlyph filled={watched} />
                </button>
                <span className="search__result-symbol">{result.symbol}</span>
                <span className="search__result-name">{result.name}</span>
                {result.exchange !== null ? (
                  <span className="search__result-exchange">{result.exchange}</span>
                ) : null}
                {watched ? <span className="visually-hidden">On your watchlist</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {open && listState === 'empty' ? (
        <div className="search__results search__results--empty">
          <p className="search__no-match">No match</p>
          <p className="search__no-match-body">
            No US-listed stock in the catalogue matches that ticker or company name.
          </p>
        </div>
      ) : null}

      {status.kind === 'error' ? (
        <p className="search__status search__status--error" role="alert">
          {status.message}
          <button type="button" className="search__dismiss" onClick={onDismissStatus}>
            Dismiss
          </button>
        </p>
      ) : null}
      {status.kind === 'added' ? (
        <p className="search__status search__status--added" role="status">
          {status.state === 'READY'
            ? `Added ${status.symbol}.`
            : `Added ${status.symbol}. Market data is still warming up — it will appear here once the worker has ingested it.`}
          <button type="button" className="search__dismiss" onClick={onDismissStatus}>
            Dismiss
          </button>
        </p>
      ) : null}
    </form>
  );
}
