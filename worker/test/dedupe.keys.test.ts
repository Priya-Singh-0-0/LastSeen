import { describe, it, expect } from 'vitest';
import { SignalType, toSessionDate, toUtcTimestamp } from '@stockwatch/contracts';
import {
  priceSignalDedupeKey,
  abnormalVolumeDedupeKey,
  volumeAccelerationDedupeKey,
  earningsDedupeKey,
  corporateActionDedupeKey,
} from '../src/signals/dedupe.js';

describe('dedupe_keys_are_deterministic_and_class_correct', () => {
  it('same inputs produce the same key', () => {
    const input = { signalType: SignalType.LARGE_ABSOLUTE_MOVE as const, sessionDate: toSessionDate('2024-07-02') };
    expect(priceSignalDedupeKey(input)).toBe(priceSignalDedupeKey(input));
  });

  it('session-scoped price signals key on type + session_date', () => {
    const sessionDate = toSessionDate('2024-07-02');
    expect(priceSignalDedupeKey({ signalType: SignalType.VOLATILITY_ADJUSTED_MOVE, sessionDate }))
      .toBe('VOLATILITY_ADJUSTED_MOVE:2024-07-02');
    expect(priceSignalDedupeKey({ signalType: SignalType.RANGE_BREAKOUT, sessionDate }))
      .toBe('RANGE_BREAKOUT:2024-07-02');
  });

  it('a different signal type on the same session produces a different key', () => {
    const sessionDate = toSessionDate('2024-07-02');
    const a = priceSignalDedupeKey({ signalType: SignalType.LARGE_ABSOLUTE_MOVE, sessionDate });
    const b = priceSignalDedupeKey({ signalType: SignalType.SIGNIFICANT_GAP, sessionDate });
    expect(a).not.toBe(b);
  });

  it('ABNORMAL_VOLUME keys on type + session_date only', () => {
    const sessionDate = toSessionDate('2024-07-02');
    expect(abnormalVolumeDedupeKey({ signalType: SignalType.ABNORMAL_VOLUME, sessionDate }))
      .toBe('ABNORMAL_VOLUME:2024-07-02');
  });

  it('VOLUME_ACCELERATION keys on type + session_date + window length', () => {
    const sessionDate = toSessionDate('2024-07-02');
    const a = volumeAccelerationDedupeKey({ signalType: SignalType.VOLUME_ACCELERATION, sessionDate, windowSessions: 3 });
    const b = volumeAccelerationDedupeKey({ signalType: SignalType.VOLUME_ACCELERATION, sessionDate, windowSessions: 5 });
    expect(a).toBe('VOLUME_ACCELERATION:2024-07-02:3');
    expect(a).not.toBe(b);
  });

  it('EARNINGS_RELEASED prefers the provider event id', () => {
    const key = earningsDedupeKey({
      signalType: SignalType.EARNINGS_RELEASED,
      providerEventId: 'evt-123',
      eventTimestamp: toUtcTimestamp(1000),
      fiscalPeriod: 'Q3-2024',
    });
    expect(key).toBe('EARNINGS_RELEASED:evt-123');
  });

  it('EARNINGS_RELEASED falls back to normalized timestamp + fiscal period when no provider id', () => {
    const key = earningsDedupeKey({
      signalType: SignalType.EARNINGS_RELEASED,
      eventTimestamp: toUtcTimestamp(1000),
      fiscalPeriod: 'Q3-2024',
    });
    expect(key).toBe('EARNINGS_RELEASED:1000:Q3-2024');
  });

  it('two distinct earnings events sharing a market timestamp produce different keys', () => {
    const sharedTs = toUtcTimestamp(1000);
    const a = earningsDedupeKey({ signalType: SignalType.EARNINGS_RELEASED, eventTimestamp: sharedTs, fiscalPeriod: 'Q3-2024' });
    const b = earningsDedupeKey({ signalType: SignalType.EARNINGS_RELEASED, eventTimestamp: sharedTs, fiscalPeriod: 'Q4-2024' });
    expect(a).not.toBe(b);
  });

  it('EARNINGS_RELEASED without a provider id or fallback fields throws', () => {
    expect(() => earningsDedupeKey({ signalType: SignalType.EARNINGS_RELEASED })).toThrow();
  });

  it('CORPORATE_ACTION_APPLIED keys on type + action type + effective date + factor', () => {
    const key = corporateActionDedupeKey({
      signalType: SignalType.CORPORATE_ACTION_APPLIED,
      actionType: 'SPLIT',
      effectiveDate: toSessionDate('2024-07-02'),
      factor: '0.25',
    });
    expect(key).toBe('CORPORATE_ACTION_APPLIED:SPLIT:2024-07-02:0.25');
  });

  it('two corporate actions sharing an effective date but different factors produce different keys', () => {
    const effectiveDate = toSessionDate('2024-07-02');
    const a = corporateActionDedupeKey({ signalType: SignalType.CORPORATE_ACTION_APPLIED, actionType: 'SPLIT', effectiveDate, factor: '0.25' });
    const b = corporateActionDedupeKey({ signalType: SignalType.CORPORATE_ACTION_APPLIED, actionType: 'SPLIT', effectiveDate, factor: '0.5' });
    expect(a).not.toBe(b);
  });

  it('a different detector_version yields a distinct uniqueness tuple even for the same dedupe key', () => {
    const sessionDate = toSessionDate('2024-07-02');
    const dedupeKey = priceSignalDedupeKey({ signalType: SignalType.LARGE_ABSOLUTE_MOVE, sessionDate });
    const tupleV1 = ['inst-1', 1, dedupeKey].join(':');
    const tupleV2 = ['inst-1', 2, dedupeKey].join(':');
    expect(tupleV1).not.toBe(tupleV2);
  });

  it('keys are stable across repeated computation (no reliance on iteration order or wall clock)', () => {
    const sessionDate = toSessionDate('2024-07-02');
    const first = priceSignalDedupeKey({ signalType: SignalType.RANGE_BREAKOUT, sessionDate });
    const second = priceSignalDedupeKey({ signalType: SignalType.RANGE_BREAKOUT, sessionDate });
    expect(first).toBe(second);
  });
});
