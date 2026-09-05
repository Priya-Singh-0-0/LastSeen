import type { AttentionBandValue } from '../types.js';

export interface MonogramProps {
  readonly symbol: string;
  readonly band: AttentionBandValue | null;
}

const BAND_CLASS: Record<AttentionBandValue, string> = {
  URGENT: 'monogram--urgent',
  NOTABLE: 'monogram--notable',
  MINOR: 'monogram--minor',
  QUIET: 'monogram--quiet',
};

/** First two characters of the ticker, tinted by the instrument's max unseen band. */
export function Monogram({ symbol, band }: MonogramProps) {
  const initials = symbol.slice(0, 2).toUpperCase();
  const className = ['monogram', band !== null ? BAND_CLASS[band] : 'monogram--none'].join(' ');
  return (
    <span className={className} aria-hidden="true">
      {initials}
    </span>
  );
}
