import { FreshnessChip } from './FreshnessChip.js';
import type { EnvelopeWire } from '../types.js';

export interface EnvelopeBadgeProps {
  readonly envelope: EnvelopeWire | null;
}

/** The value + currency alone, for placement in a price column/header. */
export function EnvelopePrice({ envelope }: EnvelopeBadgeProps) {
  if (envelope === null) {
    return <span className="envelope-price envelope-price--warming">Warming up…</span>;
  }
  return (
    <span className="envelope-price">
      <span className="envelope-price__value">{envelope.value}</span>{' '}
      <span className="envelope-price__currency">{envelope.currency}</span>
    </span>
  );
}

/** The three distinct trust/status facts alone, for placement in a data column. */
export function EnvelopeStatus({ envelope }: EnvelopeBadgeProps) {
  if (envelope === null) return null;
  return (
    <span className="envelope-status">
      <FreshnessChip kind="marketStatus" value={envelope.marketStatus} />
      <FreshnessChip kind="valueKind" value={envelope.valueKind} />
      <FreshnessChip kind="dataFreshness" value={envelope.dataFreshness} />
    </span>
  );
}

/**
 * Renders a ValueEnvelope's wire fields verbatim. Market status, value kind, and data
 * freshness are three distinct, separately-labelled facts (CLAUDE.md) — never collapsed
 * into one indicator or recomputed client-side. Kept as a single mount point (composing
 * EnvelopePrice + EnvelopeStatus) because it is tested standalone; callers that need the
 * value and the status facts in separate table columns use those two pieces directly.
 */
export function EnvelopeBadge({ envelope }: EnvelopeBadgeProps) {
  if (envelope === null) {
    return <div className="envelope-badge envelope-badge--warming">Warming up…</div>;
  }
  return (
    <div className="envelope-badge">
      <EnvelopePrice envelope={envelope} />
      <EnvelopeStatus envelope={envelope} />
    </div>
  );
}
