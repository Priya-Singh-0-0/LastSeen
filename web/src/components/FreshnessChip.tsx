import { humanizeEnum } from '../format.js';

export interface FreshnessChipProps {
  readonly kind: 'marketStatus' | 'valueKind' | 'dataFreshness';
  readonly value: string;
}

const FACT_LABEL: Record<FreshnessChipProps['kind'], string> = {
  marketStatus: 'Market status',
  valueKind: 'Value kind',
  dataFreshness: 'Data freshness',
};

/** Only degraded freshness earns a treatment. A healthy feed should not shout on every row. */
const TONE: Record<string, string> = {
  DELAYED: 'status-fact--delayed',
  STALE: 'status-fact--stale',
  UNAVAILABLE: 'status-fact--unavailable',
};

/**
 * One fact, one element. Market status, value kind, and data freshness are three distinct facts
 * (CLAUDE.md) and are never collapsed into a single indicator — render one of these per fact.
 * Each carries the name of the fact it states, which the bare value never did.
 *
 * Trust marks deliberately use no hue: a third colour meaning would collide with the two axes
 * that already exist (price direction and attention band).
 */
export function FreshnessChip({ kind, value }: FreshnessChipProps) {
  const tone = kind === 'dataFreshness' ? (TONE[value] ?? '') : '';
  const label = humanizeEnum(value);
  return (
    <span className={`status-fact ${tone}`.trim()} title={`${FACT_LABEL[kind]}: ${label}`}>
      {label}
    </span>
  );
}
