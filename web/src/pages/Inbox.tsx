import { InboxRow } from '../components/InboxRow.js';
import type { InboxResponse } from '../types.js';
import '../styles.css';

export interface InboxProps {
  readonly data: InboxResponse;
  readonly onSelectInstrument?: (instrumentId: string) => void;
  readonly onRemoveInstrument?: (instrumentId: string) => void;
}

/**
 * The primary surface (architecture §F.4): attention-ranked watched instruments, already
 * ordered by the API's PersonalRanker. This component renders the ranking and every value
 * verbatim — it never re-sorts, scores, or computes a percentage itself (CLAUDE.md).
 */
export function Inbox({ data, onSelectInstrument, onRemoveInstrument }: InboxProps) {
  if (data.items.length === 0) {
    return (
      <div className="inbox__empty">
        <p>Nothing on this watchlist yet. Add a symbol above.</p>
      </div>
    );
  }
  return (
    <table className="inbox-table">
      <thead>
        <tr>
          <th className="inbox-table__col-rank">#</th>
          <th className="inbox-table__col-instrument">Instrument</th>
          <th className="inbox-table__col-price">Price</th>
          <th className="inbox-table__col-change">Since you last checked</th>
          <th className="inbox-table__col-sessions">Sessions</th>
          <th className="inbox-table__col-attention">Attention</th>
          <th className="inbox-table__col-unseen">Unseen</th>
          <th className="inbox-table__col-data">Data</th>
          <th className="inbox-table__col-explanation">What changed</th>
          <th className="inbox-table__col-remove">
            <span className="visually-hidden">Remove</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {data.items.map((item, index) => (
          <InboxRow
            key={item.instrumentId}
            rank={index + 1}
            item={item}
            onSelect={(id) => onSelectInstrument?.(id)}
            onRemove={(id) => onRemoveInstrument?.(id)}
          />
        ))}
      </tbody>
    </table>
  );
}
