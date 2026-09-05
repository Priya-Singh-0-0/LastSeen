/**
 * T36 — freshness classification at ingestion (architecture §I, §M — INV-11).
 *
 * Pure function, no DB. The worker classifies `data_freshness` itself from the feed's own
 * lag (`ingestedAt - marketTimestamp`) rather than trusting a provider-supplied value —
 * "market status, value kind, and data freshness are distinct concepts" the worker owns.
 */
import { describe, it, expect } from 'vitest';
import { classifyFreshness } from '../src/persist/marketState.js';
import { MarketStatus, DataFreshness, toUtcTimestamp } from '@stockwatch/contracts';

describe('T36 — classifyFreshness', () => {
  it('classifies FRESH when the market is open and the feed lag is negligible', () => {
    const marketTimestamp = toUtcTimestamp(1_000_000);
    const ingestedAt = toUtcTimestamp(1_000_500);
    expect(classifyFreshness(MarketStatus.OPEN, marketTimestamp, ingestedAt)).toBe(DataFreshness.FRESH);
  });

  it('classifies DELAYED once the feed lag exceeds the delayed threshold', () => {
    const marketTimestamp = toUtcTimestamp(1_000_000);
    const ingestedAt = toUtcTimestamp(1_000_000 + 6 * 60 * 1000); // 6 minutes
    expect(classifyFreshness(MarketStatus.OPEN, marketTimestamp, ingestedAt)).toBe(DataFreshness.DELAYED);
  });

  it('classifies STALE once the feed lag exceeds the stale threshold', () => {
    const marketTimestamp = toUtcTimestamp(1_000_000);
    const ingestedAt = toUtcTimestamp(1_000_000 + 25 * 60 * 1000); // 25 minutes
    expect(classifyFreshness(MarketStatus.OPEN, marketTimestamp, ingestedAt)).toBe(DataFreshness.STALE);
  });

  it('a CLOSED market never decays below FRESH regardless of feed lag', () => {
    const marketTimestamp = toUtcTimestamp(1_000_000);
    const ingestedAt = toUtcTimestamp(1_000_000 + 60 * 60 * 1000); // 1 hour
    expect(classifyFreshness(MarketStatus.CLOSED, marketTimestamp, ingestedAt)).toBe(DataFreshness.FRESH);
  });
});
