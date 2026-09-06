import { AttentionBand } from './AttentionBand.js';
import { formatRelativeTime } from '../format.js';
import type { UnseenChangeWire } from '../types.js';

export interface EvidencePanelProps {
  readonly changes: readonly UnseenChangeWire[];
}

const BAND_RAIL: Record<string, string> = {
  URGENT: 'rail--urgent',
  NOTABLE: 'rail--notable',
  MINOR: 'rail--minor',
  QUIET: 'rail--quiet',
};

/**
 * The log entries themselves. Exposes every unseen change record and the signals that produced
 * it, verbatim from the API (CLAUDE.md: the frontend never derives evidence — it only renders
 * what the worker/API already computed). No model output is ever rendered here, only
 * deterministic signal facts.
 *
 * Every evidence key/value is rendered as-is, never renamed, reformatted, or filtered — this
 * drill-down is the product's inspectability promise, so the numbers must be the source's own.
 * There is no per-signal strength and no phenomenon group on the wire; neither is implied.
 */
export function EvidencePanel({ changes }: EvidencePanelProps) {
  if (changes.length === 0) {
    return <p className="entries__empty">No unseen changes.</p>;
  }
  return (
    <div className="entries">
      {changes.map((change) => (
        <article key={change.id} className="entry-record">
          <div className="entry-record__margin">
            <span className={`rail ${change.band !== null ? BAND_RAIL[change.band] : 'rail--none'}`} aria-hidden="true" />
            <span className="entry-record__seq numeral" title={`Published sequence ${change.publishedSeq}`}>
              {change.publishedSeq}
            </span>
            <AttentionBand band={change.band} />
          </div>

          <div className="entry-record__body">
            <p className="entry-record__meta">
              <span title={change.publishedAt}>{formatRelativeTime(change.publishedAt)}</span>
              <span className="entry-record__meta-sep" aria-hidden="true" />
              <span title={change.latestAt}>latest {formatRelativeTime(change.latestAt)}</span>
              {change.score !== null ? (
                <>
                  <span className="entry-record__meta-sep" aria-hidden="true" />
                  <span className="numeral">{change.score}</span>
                </>
              ) : null}
            </p>

            {change.sharedExplanation !== null ? (
              <p className="entry-record__explanation">{change.sharedExplanation}</p>
            ) : null}

            <ul className="signals">
              {change.signals.map((signal) => (
                <li key={signal.dedupeKey} className="signal">
                  <p className="signal__head">
                    <span className="signal__type">{signal.signalType}</span>
                    <span className="signal__version">detector v{signal.detectorVersion}</span>
                    <span className="signal__timestamp" title={signal.marketTimestamp}>
                      {formatRelativeTime(signal.marketTimestamp)}
                    </span>
                  </p>
                  <dl className="readings">
                    {Object.entries(signal.evidence).map(([key, value]) => (
                      <div key={key} className="reading">
                        <dt className="reading__key">{key}</dt>
                        <dd className="reading__value numeral">{String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="signal__dedupe" title={signal.dedupeKey}>
                    {signal.dedupeKey}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </article>
      ))}
    </div>
  );
}
