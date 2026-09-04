import { AttentionBand } from './AttentionBand.js';
import type { UnseenChangeWire } from '../types.js';

export interface EvidencePanelProps {
  readonly changes: readonly UnseenChangeWire[];
}

/**
 * Exposes every unseen change record and the signals that produced it, verbatim from the
 * API (CLAUDE.md: the frontend never derives evidence — it only renders what the worker/API
 * already computed). No model output is ever rendered here, only deterministic signal facts.
 */
export function EvidencePanel({ changes }: EvidencePanelProps) {
  if (changes.length === 0) {
    return <p className="evidence-panel__empty">No unseen changes.</p>;
  }
  return (
    <div className="evidence-panel">
      {changes.map((change) => (
        <article key={change.id} className="evidence-panel__record">
          <header className="evidence-panel__record-header">
            <AttentionBand band={change.band} />
            {change.score !== null ? (
              <span className="evidence-panel__score">{change.score}</span>
            ) : null}
          </header>
          {change.sharedExplanation !== null ? (
            <p className="evidence-panel__explanation">{change.sharedExplanation}</p>
          ) : null}
          <ul className="evidence-panel__signals">
            {change.signals.map((signal) => (
              <li key={signal.dedupeKey} className="evidence-panel__signal">
                <div className="evidence-panel__signal-header">
                  <span className="evidence-panel__signal-type">{signal.signalType}</span>
                  <span className="evidence-panel__signal-version">detector v{signal.detectorVersion}</span>
                </div>
                <dl className="evidence-panel__evidence-list">
                  {Object.entries(signal.evidence).map(([key, value]) => (
                    <div key={key} className="evidence-panel__evidence-entry">
                      <dt>{key}</dt>
                      <dd>{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}
