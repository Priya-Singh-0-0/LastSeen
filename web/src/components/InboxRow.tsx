import type { KeyboardEvent } from 'react';
import { AttentionBand } from './AttentionBand.js';
import { EnvelopePrice, EnvelopeStatus } from './EnvelopeBadge.js';
import { Monogram } from './Monogram.js';
import type { InboxItemWire } from '../types.js';

export interface InboxRowProps {
  readonly rank: number;
  readonly item: InboxItemWire;
  readonly onSelect: (instrumentId: string) => void;
}

const BAND_RAIL: Record<string, string> = {
  URGENT: 'inbox-row--rail-urgent',
  NOTABLE: 'inbox-row--rail-notable',
  MINOR: 'inbox-row--rail-minor',
  QUIET: 'inbox-row--rail-quiet',
};

export function InboxRow({ rank, item, onSelect }: InboxRowProps) {
  const dimmed = item.dataFreshness === 'STALE' || item.dataFreshness === 'UNAVAILABLE' || item.current === null;
  const railClass = item.maxUnseenBand !== null ? BAND_RAIL[item.maxUnseenBand] : 'inbox-row--rail-none';

  function activate() {
    onSelect(item.instrumentId);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTableRowElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate();
    }
  }

  return (
    <tr
      className={`inbox-row ${railClass} ${dimmed ? 'inbox-row--dimmed' : ''}`}
      tabIndex={0}
      role="row"
      onClick={activate}
      onKeyDown={handleKeyDown}
    >
      <td className="inbox-row__rank">{rank}</td>
      <td className="inbox-row__instrument">
        <Monogram symbol={item.symbol} band={item.maxUnseenBand} />
        <span className="inbox-row__instrument-text">
          <span className="inbox-row__symbol">{item.symbol}</span>
          {item.exchange !== null ? <span className="inbox-row__exchange">{item.exchange}</span> : null}
        </span>
      </td>
      <td className="inbox-row__price">
        <EnvelopePrice envelope={item.current} />
      </td>
      <td className="inbox-row__change">
        {item.comparisonStatus === 'SUPPRESSED_CORPORATE_ACTION' ? (
          <span className="inbox-row__cant-compare">
            Can't compare
            <span className="inbox-row__cant-compare-reason">Unsupported corporate action</span>
          </span>
        ) : item.comparisonStatus === 'AWAITING_BASELINE' || item.current === null ? (
          <span className="inbox-row__warming">Warming up</span>
        ) : item.percentageChange !== undefined ? (
          <span className={`inbox-row__change-value ${item.percentageChange.startsWith('-') ? 'is-down' : 'is-up'}`}>
            <span className="inbox-row__percentage">
              {item.percentageChange.startsWith('-') ? '' : '+'}
              {item.percentageChange}%
            </span>
            {item.absoluteChange !== undefined ? (
              <span className="inbox-row__absolute">{item.absoluteChange}</span>
            ) : null}
          </span>
        ) : (
          <span className="inbox-row__no-change">—</span>
        )}
      </td>
      <td className="inbox-row__sessions">{item.sessionsElapsed ?? '—'}</td>
      <td className="inbox-row__attention">
        <AttentionBand band={item.maxUnseenBand} />
      </td>
      <td className="inbox-row__unseen">
        {item.unseenCount > 0 ? <span className="inbox-row__unseen-badge">{item.unseenCount}</span> : null}
      </td>
      <td className="inbox-row__data">
        {item.current !== null ? (
          <EnvelopeStatus envelope={item.current} />
        ) : (
          <span className="chip chip--unavailable">{item.dataFreshness}</span>
        )}
      </td>
      <td className="inbox-row__explanation">{item.explanation}</td>
    </tr>
  );
}
