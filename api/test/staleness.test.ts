/**
 * T36 — freshness lifecycle and staleness labelling (architecture §I, §M — INV-11).
 *
 * Gate §O.11: stale_data_is_labelled_not_hidden. Pure, no DB — `assembleEnvelope` recomputes
 * `dataFreshness` at read time from `ingested_at` vs. an injected `now`, since the worker only
 * writes on ingestion and cannot itself notice time passing while the provider stays silent
 * (architecture §M: "market state untouched" while a provider is unreachable).
 */
import { describe, it, expect } from 'vitest';
import { assembleEnvelope } from '../src/market/envelope.js';
import type { MarketStateRow } from '../src/market/envelope.js';
import { rankInboxItems, type RankableItem } from '../src/ranking/ranker.js';
import { AttentionBand, DataFreshness, ValueKind, toUtcTimestamp } from '@stockwatch/contracts';

function row(overrides: Partial<MarketStateRow> = {}): MarketStateRow {
  return {
    price: '182.340000',
    currency: 'USD',
    market_timestamp: new Date('2024-08-07T14:00:00Z'),
    ingested_at: new Date('2024-08-07T14:00:00Z'),
    source: 'fixture',
    market_status: 'OPEN',
    value_kind: 'LIVE',
    data_freshness: 'FRESH',
    precision_hint: 2,
    ...overrides,
  };
}

describe('T36 — stale_data_is_labelled_not_hidden', () => {
  it('an OPEN market past the stale threshold reads LAST_KNOWN / STALE, not hidden or crashed', () => {
    const ingestedAt = new Date('2024-08-07T14:00:00Z');
    const now = toUtcTimestamp(ingestedAt.getTime() + 25 * 60 * 1000); // 25 minutes later

    const env = assembleEnvelope(row({ ingested_at: ingestedAt }), now);

    expect(env.dataFreshness).toBe(DataFreshness.STALE);
    expect(env.valueKind).toBe(ValueKind.LAST_KNOWN);
  });

  it('a CLOSED market holding a SESSION_CLOSE remains FRESH no matter how much time passes', () => {
    const ingestedAt = new Date('2024-08-07T14:00:00Z');
    const now = toUtcTimestamp(ingestedAt.getTime() + 3 * 24 * 60 * 60 * 1000); // 3 days later

    const env = assembleEnvelope(
      row({ ingested_at: ingestedAt, market_status: 'CLOSED', value_kind: 'SESSION_CLOSE' }),
      now,
    );

    expect(env.dataFreshness).toBe(DataFreshness.FRESH);
    expect(env.valueKind).toBe(ValueKind.SESSION_CLOSE);
  });

  it('the stale item still appears in the ranked inbox and is de-weighted, never dropped', () => {
    const ingestedAt = new Date('2024-08-07T14:00:00Z');
    const now = toUtcTimestamp(ingestedAt.getTime() + 25 * 60 * 1000);
    const env = assembleEnvelope(row({ ingested_at: ingestedAt }), now);

    const staleUrgent: RankableItem<string> = {
      item: 'stale-urgent',
      maxUnseenBand: AttentionBand.URGENT,
      maxUnseenScore: null,
      sinceCheckMove: null,
      dataFreshness: env.dataFreshness,
    };
    const freshQuiet: RankableItem<string> = {
      item: 'fresh-quiet',
      maxUnseenBand: AttentionBand.QUIET,
      maxUnseenScore: null,
      sinceCheckMove: null,
      dataFreshness: DataFreshness.FRESH,
    };

    const ranked = rankInboxItems([staleUrgent, freshQuiet]);

    // Still present — never hidden.
    expect(ranked.map((r) => r.item)).toContain('stale-urgent');
    // De-weighted, but a QUIET band still can't beat a de-weighted URGENT.
    expect(ranked.map((r) => r.item)).toEqual(['stale-urgent', 'fresh-quiet']);
  });
});
