import { InboxRow } from '../components/InboxRow.js';
import { PopularBoard } from '../components/PopularBoard.js';
import type { InboxResponse, SearchResultWire } from '../types.js';

export interface InboxProps {
  readonly data: InboxResponse;
  readonly onSelectInstrument?: (symbol: string) => void;
  readonly onRemoveInstrument?: (instrumentId: string) => void;
  /** Ids whose unstar is in flight. Those rows hold their rank position until the next read. */
  readonly removingIds?: ReadonlySet<string>;
  /** The empty-state suggestion board (defect 8) — rendered only when the ledger is empty. */
  readonly popular?: readonly SearchResultWire[];
  readonly onSelectSymbol?: (symbol: string) => void;
  readonly onAddSymbol?: (symbol: string) => void;
  readonly onRemoveSymbol?: (symbol: string) => void;
}

const COLUMNS = ['Watch', 'Stock', 'Since you last checked', 'Price', 'Changes'] as const;

const EMPTY_SYMBOLS: ReadonlySet<string> = new Set();

/**
 * The primary surface (architecture §F.4): attention-ranked watched stocks, already ordered by
 * the API's PersonalRanker. This component renders the ranking and every value verbatim — it
 * never re-sorts, scores, or computes a percentage itself (CLAUDE.md). The log is ruled, and
 * entries hold their line.
 */
export function Inbox({
  data,
  onSelectInstrument,
  onRemoveInstrument,
  removingIds,
  popular,
  onSelectSymbol,
  onAddSymbol,
  onRemoveSymbol,
}: InboxProps) {
  if (data.items.length === 0) {
    return (
      <div className="ledger-empty">
        <p className="ledger-empty__head">Nothing on your watchlist yet</p>
        <p className="ledger-empty__body">
          Add stocks to your watchlist by searching for a ticker or company name above.
        </p>
        <span className="ledger-empty__leader" aria-hidden="true" />
        {popular && popular.length > 0 ? (
          <PopularBoard
            stocks={popular}
            // The ledger is empty in this branch by construction, so the board is always
            // fully unstarred — starring anything replaces this whole view on the next read.
            watchedSymbols={EMPTY_SYMBOLS}
            onSelectSymbol={(symbol) => onSelectSymbol?.(symbol)}
            onAdd={(symbol) => onAddSymbol?.(symbol)}
            onRemove={(symbol) => onRemoveSymbol?.(symbol)}
          />
        ) : null}
      </div>
    );
  }
  return (
    <table className="ledger">
      <thead>
        <tr>
          {COLUMNS.map((label) => (
            <th key={label} className={`col col--${label.split(' ')[0]!.toLowerCase()}`} scope="col">
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.items.map((item) => (
          <InboxRow
            key={item.instrumentId}
            item={item}
            removing={removingIds?.has(item.instrumentId) ?? false}
            onSelect={(symbol) => onSelectInstrument?.(symbol)}
            onRemove={(id) => onRemoveInstrument?.(id)}
          />
        ))}
      </tbody>
    </table>
  );
}

/**
 * The ruled blank page. Holds the real column positions and the real row height so nothing moves
 * when the data lands — no shimmer, no spinner: a log that has not been written in yet.
 */
export function InboxSkeleton() {
  return (
    <div aria-busy="true">
      <span className="visually-hidden" role="status">
        Loading your watchlist
      </span>
      <table className="ledger ledger--placeholder" aria-hidden="true">
        <thead>
          <tr>
            {COLUMNS.map((label) => (
              <th key={label} className={`col col--${label.split(' ')[0]!.toLowerCase()}`} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 8 }, (_, index) => (
            <tr key={index} className="ledger-row ledger-row--placeholder">
              <td className="cell cell--margin" />
              <td className="cell cell--stock">
                <span className="placeholder-bar placeholder-bar--symbol" />
                <span className="placeholder-bar placeholder-bar--name" />
              </td>
              <td className="cell cell--since">
                <span className="placeholder-bar placeholder-bar--figure" />
              </td>
              <td className="cell cell--price">
                <span className="placeholder-bar placeholder-bar--price" />
              </td>
              <td className="cell cell--changes" />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
