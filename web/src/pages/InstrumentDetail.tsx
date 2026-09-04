import { useEffect, useRef } from 'react';
import { EnvelopeBadge } from '../components/EnvelopeBadge.js';
import { EvidencePanel } from '../components/EvidencePanel.js';
import type { InstrumentDetailResponse } from '../types.js';
import '../styles.css';

export interface InstrumentDetailProps {
  readonly data: InstrumentDetailResponse;
  readonly onAcknowledge: () => void;
}

/**
 * The full unseen change set for one instrument, with an evidence drill-down (architecture
 * §F.6). Fires acknowledge exactly once — on explicit "mark as read", or on unmount after the
 * view has been seen — never on a GET (CLAUDE.md: no GET mutates user state).
 */
export function InstrumentDetail({ data, onAcknowledge }: InstrumentDetailProps) {
  const acknowledged = useRef(false);

  function acknowledgeOnce() {
    if (acknowledged.current) return;
    acknowledged.current = true;
    onAcknowledge();
  }

  const unseenCount = data.unseenChanges.length;
  useEffect(() => {
    return () => {
      if (unseenCount > 0) {
        acknowledgeOnce();
      }
    };
    // Intentionally mount/unmount only: acknowledging fires once when the view is left,
    // not on every prop change while it's open.
  }, []);

  return (
    <div className="instrument-detail">
      <EnvelopeBadge envelope={data.current} />
      {data.percentageChange !== undefined ? (
        <span className="instrument-detail__percentage-change">{data.percentageChange}</span>
      ) : null}
      <EvidencePanel changes={data.unseenChanges} />
      <button type="button" onClick={acknowledgeOnce}>
        Mark as read
      </button>
    </div>
  );
}
