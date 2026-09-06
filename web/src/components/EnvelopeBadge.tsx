import { FreshnessChip } from './FreshnessChip.js';
import { formatPrice } from '../format.js';
import type { EnvelopeWire } from '../types.js';

export interface EnvelopeBadgeProps {
  readonly envelope: EnvelopeWire | null;
}

/**
 * The value + currency alone, for placement in a price column/header. Rounded to the column's
 * display precision (surface brief §5) — rounding is presentation; the canonical full-precision
 * string the API sent stays available in the title.
 */
export function EnvelopePrice({ envelope }: EnvelopeBadgeProps) {
  if (envelope === null) {
    return <span className="envelope-price envelope-price--warming">Warming up…</span>;
  }
  if (envelope.dataFreshness === 'UNAVAILABLE') {
    // No value to show. A dash would read as zero, so the cell says what is true instead.
    return <span className="envelope-price envelope-price--none">No price</span>;
  }
  return (
    <span className="envelope-price" title={`${envelope.value} ${envelope.currency}`}>
      <span className="envelope-price__value numeral">{formatPrice(envelope.value)}</span>{' '}
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
 * value and the status facts in separate ledger columns use those two pieces directly.
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
