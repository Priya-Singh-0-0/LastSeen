import { StarGlyph } from './icons.js';
import type { SearchResultWire } from '../types.js';

export interface PopularBoardProps {
  readonly stocks: readonly SearchResultWire[];
  readonly watchedSymbols: ReadonlySet<string>;
  readonly onSelectSymbol: (symbol: string) => void;
  readonly onAdd: (symbol: string) => void;
  readonly onRemove: (symbol: string) => void;
}

/**
 * The empty watchlist's suggestion board (defect 8) — a stored provider fact (the worker's
 * screener sync), not a client-side guess. Same fill-vs-outline star grammar as the ledger
 * and search, and the same "click opens, star toggles" split as a search result: the row
 * navigates to the stock's detail page, the star is a sibling `<button>` that stops
 * propagation. Starring anything here is what replaces this board with the real ledger, on
 * the next inbox read.
 */
export function PopularBoard({ stocks, watchedSymbols, onSelectSymbol, onAdd, onRemove }: PopularBoardProps) {
  if (stocks.length === 0) return null;

  return (
    <div className="popular-board">
      <p className="popular-board__head">Popular stocks</p>
      <ul className="popular-board__list">
        {stocks.map((stock) => {
          const watched = watchedSymbols.has(stock.symbol);
          return (
            <li key={stock.symbol} className="popular-board__row" onClick={() => onSelectSymbol(stock.symbol)}>
              <button
                type="button"
                className={`popular-board__star ${watched ? 'is-watched' : ''}`}
                aria-label={
                  watched
                    ? `Remove ${stock.symbol} from your watchlist`
                    : `Add ${stock.symbol} to your watchlist`
                }
                onClick={(event) => {
                  event.stopPropagation();
                  if (watched) onRemove(stock.symbol);
                  else onAdd(stock.symbol);
                }}
              >
                <StarGlyph filled={watched} />
              </button>
              <span className="popular-board__symbol">{stock.symbol}</span>
              <span className="popular-board__name">{stock.name}</span>
              {stock.exchange !== null ? (
                <span className="popular-board__exchange">{stock.exchange}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
