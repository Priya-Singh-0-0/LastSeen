import { StatPair } from './StatPair.js';
import type { InboxItemWire } from '../types.js';

export interface SummaryStripProps {
  readonly items: readonly InboxItemWire[];
}

/**
 * Four counts over an array the API already returned — enumeration, not financial
 * derivation (CLAUDE.md permits counting rows; it forbids summing/averaging prices,
 * percentages, or scores, so there is deliberately no "total portfolio change" tile here).
 */
export function SummaryStrip({ items }: SummaryStripProps) {
  const unseenChanges = items.reduce((sum, item) => sum + item.unseenCount, 0);
  const needingAttention = items.filter((item) => item.maxUnseenBand === 'URGENT' || item.maxUnseenBand === 'NOTABLE').length;
  const staleOrUnavailable = items.filter((item) => item.dataFreshness === 'STALE' || item.dataFreshness === 'UNAVAILABLE').length;

  return (
    <div className="summary-strip">
      <StatPair label="Instruments watched" value={String(items.length)} />
      <StatPair label="Unseen changes" value={String(unseenChanges)} />
      <StatPair label="Needing attention" value={String(needingAttention)} />
      <StatPair label="Stale or unavailable" value={String(staleOrUnavailable)} />
    </div>
  );
}
