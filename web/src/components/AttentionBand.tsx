import type { AttentionBandValue } from '../types.js';

export interface AttentionBandProps {
  readonly band: AttentionBandValue | null;
}

const LABEL: Record<AttentionBandValue, string> = {
  URGENT: 'URGENT',
  NOTABLE: 'NOTABLE',
  MINOR: 'MINOR',
  QUIET: 'QUIET',
};

const CLASS: Record<AttentionBandValue, string> = {
  URGENT: 'band-pill band-pill--urgent',
  NOTABLE: 'band-pill band-pill--notable',
  MINOR: 'band-pill band-pill--minor',
  QUIET: 'band-pill band-pill--quiet',
};

/** Renders the backend-computed attention band verbatim (CLAUDE.md: no client-side scoring). */
export function AttentionBand({ band }: AttentionBandProps) {
  if (band === null) {
    return <span className="band-pill band-pill--none">—</span>;
  }
  return <span className={CLASS[band]}>{LABEL[band]}</span>;
}
