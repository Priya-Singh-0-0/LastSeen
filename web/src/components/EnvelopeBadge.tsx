import type { EnvelopeWire } from '../types.js';

export interface EnvelopeBadgeProps {
  readonly envelope: EnvelopeWire | null;
}

/**
 * Renders a ValueEnvelope's wire fields verbatim. Market status, value kind, and data
 * freshness are three distinct, separately-labelled facts (CLAUDE.md) — never collapsed
 * into one indicator or recomputed client-side.
 */
export function EnvelopeBadge({ envelope }: EnvelopeBadgeProps) {
  if (envelope === null) {
    return <div className="envelope-badge envelope-badge--warming">Warming up…</div>;
  }
  return (
    <div className="envelope-badge">
      <span className="envelope-badge__value">{envelope.value}</span>
      <span className="envelope-badge__currency">{envelope.currency}</span>
      <span className="envelope-badge__market-status">{envelope.marketStatus}</span>
      <span className="envelope-badge__value-kind">{envelope.valueKind}</span>
      <span className="envelope-badge__freshness">{envelope.dataFreshness}</span>
    </div>
  );
}
