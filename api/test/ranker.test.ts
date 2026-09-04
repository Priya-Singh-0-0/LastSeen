/**
 * T31 — PersonalRanker (architecture §F.4 — INV-1, INV-2).
 * Pure function, no DB. Orders inbox items by (max unseen band, max unseen score,
 * |since-check move|), de-weighted for stale/unavailable freshness.
 */
import { describe, it, expect } from 'vitest';
import { D, AttentionBand, DataFreshness } from '@stockwatch/contracts';
import { rankInboxItems, type RankableItem } from '../src/ranking/ranker.js';

function item(overrides: Partial<RankableItem<string>> & { id: string }): RankableItem<string> {
  return {
    item: overrides.id,
    maxUnseenBand: null,
    maxUnseenScore: null,
    sinceCheckMove: null,
    dataFreshness: DataFreshness.FRESH,
    ...overrides,
  };
}

describe('T31 — rankInboxItems', () => {
  it('ranks a higher band above a lower band regardless of score', () => {
    const urgent = item({ id: 'urgent', maxUnseenBand: AttentionBand.URGENT, maxUnseenScore: D.from('0.1') });
    const quiet = item({ id: 'quiet', maxUnseenBand: AttentionBand.MINOR, maxUnseenScore: D.from('0.9') });

    const ranked = rankInboxItems([quiet, urgent]);

    expect(ranked.map((r) => r.item)).toEqual(['urgent', 'quiet']);
  });

  it('within the same band, ranks by higher score', () => {
    const a = item({ id: 'a', maxUnseenBand: AttentionBand.NOTABLE, maxUnseenScore: D.from('0.6') });
    const b = item({ id: 'b', maxUnseenBand: AttentionBand.NOTABLE, maxUnseenScore: D.from('0.55') });

    const ranked = rankInboxItems([b, a]);

    expect(ranked.map((r) => r.item)).toEqual(['a', 'b']);
  });

  it('within the same band and score, ranks by larger |since-check move|', () => {
    const a = item({
      id: 'a', maxUnseenBand: AttentionBand.MINOR, maxUnseenScore: D.from('0.3'),
      sinceCheckMove: D.from('-0.08'),
    });
    const b = item({
      id: 'b', maxUnseenBand: AttentionBand.MINOR, maxUnseenScore: D.from('0.3'),
      sinceCheckMove: D.from('0.02'),
    });

    const ranked = rankInboxItems([b, a]);

    expect(ranked.map((r) => r.item)).toEqual(['a', 'b']);
  });

  it('an item with no unseen changes ranks below any item that has one', () => {
    const noUnseen = item({ id: 'none', sinceCheckMove: D.from('0.5') });
    const hasUnseen = item({ id: 'has', maxUnseenBand: AttentionBand.QUIET, maxUnseenScore: D.from('0.01') });

    const ranked = rankInboxItems([noUnseen, hasUnseen]);

    expect(ranked.map((r) => r.item)).toEqual(['has', 'none']);
  });

  it('de-weights a STALE item so a fresher, lower-band item can outrank it', () => {
    const staleUrgent = item({
      id: 'stale', maxUnseenBand: AttentionBand.URGENT, maxUnseenScore: D.from('0.8'),
      dataFreshness: DataFreshness.STALE,
    });
    const freshNotable = item({
      id: 'fresh', maxUnseenBand: AttentionBand.NOTABLE, maxUnseenScore: D.from('0.6'),
      dataFreshness: DataFreshness.FRESH,
    });

    const ranked = rankInboxItems([staleUrgent, freshNotable]);

    expect(ranked.map((r) => r.item)).toEqual(['fresh', 'stale']);
  });

  it('does not de-weight a DELAYED item (only STALE/UNAVAILABLE)', () => {
    const delayed = item({
      id: 'delayed', maxUnseenBand: AttentionBand.URGENT, maxUnseenScore: D.from('0.8'),
      dataFreshness: DataFreshness.DELAYED,
    });
    const fresh = item({
      id: 'fresh', maxUnseenBand: AttentionBand.NOTABLE, maxUnseenScore: D.from('0.6'),
      dataFreshness: DataFreshness.FRESH,
    });

    const ranked = rankInboxItems([fresh, delayed]);

    expect(ranked.map((r) => r.item)).toEqual(['delayed', 'fresh']);
  });

  it('is a stable sort for exactly-tied items', () => {
    const a = item({ id: 'a', maxUnseenBand: AttentionBand.MINOR, maxUnseenScore: D.from('0.3') });
    const b = item({ id: 'b', maxUnseenBand: AttentionBand.MINOR, maxUnseenScore: D.from('0.3') });

    const ranked = rankInboxItems([a, b]);

    expect(ranked.map((r) => r.item)).toEqual(['a', 'b']);
  });
});
