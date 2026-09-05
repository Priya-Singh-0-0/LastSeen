import { useEffect, useRef } from 'react';
import { EnvelopePrice, EnvelopeStatus } from '../components/EnvelopeBadge.js';
import { EvidencePanel } from '../components/EvidencePanel.js';
import { Monogram } from '../components/Monogram.js';
import { StatPair } from '../components/StatPair.js';
import type { InstrumentDetailResponse } from '../types.js';
import '../styles.css';

export interface InstrumentDetailProps {
  readonly data: InstrumentDetailResponse;
  readonly onAcknowledge: () => void;
  readonly onBack?: () => void;
}

/**
 * The full unseen change set for one instrument, with an evidence drill-down (architecture
 * §F.6). Fires acknowledge exactly once — on explicit "mark as read", or on unmount after the
 * view has been seen — never on a GET (CLAUDE.md: no GET mutates user state).
 */
export function InstrumentDetail({ data, onAcknowledge, onBack }: InstrumentDetailProps) {
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

  const suppressed = data.comparisonStatus === 'SUPPRESSED_CORPORATE_ACTION';
  // Newest first for the timeline read: unseenChanges arrives oldest-first (published_seq ASC).
  const timelineChanges = [...data.unseenChanges].reverse();

  return (
    <div className="instrument-detail">
      {onBack ? (
        <button type="button" className="instrument-detail__back" onClick={onBack}>
          ← Back to inbox
        </button>
      ) : null}

      <header className="instrument-detail__header">
        <div className="instrument-detail__identity">
          <Monogram symbol={data.symbol} band={null} />
          <div>
            <h1 className="instrument-detail__symbol">{data.symbol}</h1>
            {data.exchange !== null ? <span className="instrument-detail__exchange">{data.exchange}</span> : null}
          </div>
        </div>
        <div className="instrument-detail__price-block">
          <div className="instrument-detail__price">
            <EnvelopePrice envelope={data.current} />
          </div>
          <div className="instrument-detail__status-chips">
            <EnvelopeStatus envelope={data.current} />
          </div>
        </div>
      </header>

      <section className="detail-card" aria-label="Since you last checked">
        <h2 className="detail-card__title">Since you last checked</h2>
        <div className="detail-card__stats">
          {data.adjustedBaseline !== undefined ? (
            <StatPair label="Adjusted baseline" value={data.adjustedBaseline} />
          ) : null}
          {data.absoluteChange !== undefined ? (
            <StatPair
              label="Absolute change"
              value={data.absoluteChange}
              tone={data.absoluteChange.startsWith('-') ? 'down' : 'up'}
            />
          ) : null}
          {data.percentageChange !== undefined ? (
            <StatPair
              label="Percentage change"
              value={`${data.percentageChange.startsWith('-') ? '' : '+'}${data.percentageChange}%`}
              tone={data.percentageChange.startsWith('-') ? 'down' : 'up'}
            />
          ) : null}
          {data.sessionsElapsed !== undefined ? (
            <StatPair label="Sessions elapsed" value={String(data.sessionsElapsed)} />
          ) : null}
          {data.volatilityMultiple !== undefined ? (
            <StatPair label="Volatility multiple" value={data.volatilityMultiple} />
          ) : null}
        </div>
        {data.adjustmentLabels !== undefined && data.adjustmentLabels.length > 0 ? (
          <p className="detail-card__adjustment-labels">{data.adjustmentLabels.join(', ')}</p>
        ) : null}
      </section>

      {suppressed ? (
        <div className="instrument-detail__suppressed">
          <span className="instrument-detail__suppressed-label">
            Comparison unavailable — an unsupported corporate action affects this instrument.
          </span>
          <button type="button" className="button" onClick={acknowledgeOnce}>
            Reset baseline
          </button>
        </div>
      ) : null}

      <section aria-label="Unseen changes">
        <h2 className="instrument-detail__section-title">Unseen changes</h2>
        <EvidencePanel changes={timelineChanges} />
      </section>

      <div className="instrument-detail__action-bar">
        <button type="button" className="button button--primary" onClick={acknowledgeOnce} disabled={unseenCount === 0}>
          {unseenCount > 0 ? `Mark ${unseenCount} change${unseenCount === 1 ? '' : 's'} as read` : 'Mark as read'}
        </button>
      </div>
    </div>
  );
}
