export interface FreshnessChipProps {
  readonly kind: 'marketStatus' | 'valueKind' | 'dataFreshness';
  readonly value: string;
}

const FRESHNESS_CLASS: Record<string, string> = {
  STALE: 'chip chip--stale',
  UNAVAILABLE: 'chip chip--unavailable',
};

/**
 * One fact, one chip. Market status, value kind, and data freshness are three distinct facts
 * (CLAUDE.md) and are never collapsed into a single indicator — render one of these per fact.
 */
export function FreshnessChip({ kind, value }: FreshnessChipProps) {
  const className = kind === 'dataFreshness' ? (FRESHNESS_CLASS[value] ?? 'chip') : 'chip';
  return <span className={className}>{value}</span>;
}
