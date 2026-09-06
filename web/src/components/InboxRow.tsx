import type { KeyboardEvent, MouseEvent } from 'react';
import { EnvelopePrice, EnvelopeStatus } from './EnvelopeBadge.js';
import { FreshnessChip } from './FreshnessChip.js';
import { SinceLastChecked } from './SinceLastChecked.js';
import { StarGlyph } from './icons.js';
import type { InboxItemWire } from '../types.js';

export interface InboxRowProps {
  readonly item: InboxItemWire;
  /** Navigates by symbol, not the internal instrument id (`#/stock/AAPL`). */
  readonly onSelect: (symbol: string) => void;
  readonly onRemove?: (instrumentId: string) => void;
  /** True while this row's unstar is in flight — the row holds its rank position meanwhile. */
  readonly removing?: boolean;
}

/** Rail extent is the band's primary carrier; the caps word is the second; hue is the weakest. */
const BAND_RAIL: Record<string, string> = {
  URGENT: 'rail--urgent',
  NOTABLE: 'rail--notable',
  MINOR: 'rail--minor',
  QUIET: 'rail--quiet',
};

const BAND_LABEL: Record<string, string> = {
  URGENT: 'margin__band--urgent',
  NOTABLE: 'margin__band--notable',
  MINOR: 'margin__band--minor',
  QUIET: 'margin__band--quiet',
};

/**
 * One ledger entry. Reads margin-first: band rail, unseen flag, star — then the stock, then the
 * comparison anchored to the user's own checkpoint, then price with its three separate status
 * marks, then what changed.
 *
 * The row itself is the activation target (a `<tr>` with `tabIndex`, not an anchor) and the star
 * is a sibling `<button>` that stops propagation — a `<button>` inside an `<a>` would be invalid
 * markup and unpredictable under screen readers.
 */
export function InboxRow({ item, onSelect, onRemove, removing = false }: InboxRowProps) {
  const dimmed =
    item.dataFreshness === 'STALE' || item.dataFreshness === 'UNAVAILABLE' || item.current === null;
  const railClass = item.maxUnseenBand !== null ? BAND_RAIL[item.maxUnseenBand] : 'rail--none';
  const companyName = item.name !== undefined && item.name !== item.symbol ? item.name : null;

  function activate() {
    onSelect(item.symbol);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTableRowElement>) {
    // Only the row itself should activate on Enter/Space — a keydown that bubbled up from a
    // descendant control (the star) must be left alone so that control's own handler runs
    // instead of navigating away.
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate();
    }
  }

  function handleStarClick(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    onRemove?.(item.instrumentId);
  }

  return (
    <tr
      className={`ledger-row ${dimmed ? 'is-dimmed' : ''} ${removing ? 'is-removing' : ''}`}
      tabIndex={0}
      role="row"
      onClick={activate}
      onKeyDown={handleKeyDown}
    >
      <td className="cell cell--margin">
        <span className={`rail ${railClass}`} aria-hidden="true" />
        <div className="margin">
          <span className="margin__stack">
            {item.maxUnseenBand !== null ? (
              <span className={`margin__band ${BAND_LABEL[item.maxUnseenBand]}`}>
                {item.maxUnseenBand}
              </span>
            ) : null}
            {/* An unseen count of zero renders no flag at all: quiet, not a zero badge. */}
            {item.unseenCount > 0 ? (
              <span className="margin__flag">
                <span className="numeral">{item.unseenCount}</span>
                <span className="visually-hidden">unseen changes</span>
              </span>
            ) : null}
          </span>
          <button
            type="button"
            className="star"
            aria-label={`Remove ${item.symbol} from your watchlist`}
            onClick={handleStarClick}
          >
            {/* Every ledger row is watched by definition, so the resting state is always filled;
                hover and focus switch to outline to preview exactly what the click produces. */}
            <StarGlyph filled={!removing} />
          </button>
        </div>
      </td>

      <td className="cell cell--stock">
        <div className="stock">
          <span className="stock__symbol">{item.symbol}</span>
          {companyName !== null ? <span className="stock__name">{companyName}</span> : null}
          {item.exchange !== null ? <span className="stock__exchange">{item.exchange}</span> : null}
        </div>
      </td>

      <td className="cell cell--since">
        {/* Spread rather than enumerated: an absent diff field must stay absent, not become an
            explicit `undefined` (the project compiles with exactOptionalPropertyTypes). */}
        <SinceLastChecked {...item} awaitingData={item.current === null} />
      </td>

      <td className="cell cell--price">
        <EnvelopePrice envelope={item.current} />
        {item.current !== null ? (
          <EnvelopeStatus envelope={item.current} />
        ) : (
          <span className="envelope-status">
            <FreshnessChip kind="dataFreshness" value={item.dataFreshness} />
          </span>
        )}
      </td>

      <td className="cell cell--changes">
        <p className="what__text">{item.explanation}</p>
        <span className="what__more" aria-hidden="true">
          More
        </span>
      </td>
    </tr>
  );
}
