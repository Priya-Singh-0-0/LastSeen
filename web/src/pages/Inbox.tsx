import { AttentionBand } from '../components/AttentionBand.js';
import { EnvelopeBadge } from '../components/EnvelopeBadge.js';
import type { InboxResponse } from '../types.js';
import '../styles.css';

export interface InboxProps {
  readonly data: InboxResponse;
  readonly onSelectInstrument?: (instrumentId: string) => void;
}

/**
 * The primary surface (architecture §F.4): attention-ranked watched instruments, already
 * ordered by the API's PersonalRanker. This component renders the ranking and every value
 * verbatim — it never re-sorts, scores, or computes a percentage itself (CLAUDE.md).
 */
export function Inbox({ data, onSelectInstrument }: InboxProps) {
  if (data.items.length === 0) {
    return <p className="inbox__empty">Nothing on this watchlist yet.</p>;
  }
  return (
    <ul className="inbox">
      {data.items.map((item) => (
        <li
          key={item.instrumentId}
          role="listitem"
          className="inbox__row"
          tabIndex={0}
          onClick={() => onSelectInstrument?.(item.instrumentId)}
        >
          <div className="inbox__row-main">
            <AttentionBand band={item.maxUnseenBand} />
            <EnvelopeBadge envelope={item.current} />
            {item.unseenCount > 0 ? (
              <span className="inbox__unseen-count">{item.unseenCount}</span>
            ) : null}
            {item.percentageChange !== undefined ? (
              <span className="inbox__percentage-change">{item.percentageChange}</span>
            ) : null}
          </div>
          <p className="inbox__explanation">{item.explanation}</p>
        </li>
      ))}
    </ul>
  );
}
