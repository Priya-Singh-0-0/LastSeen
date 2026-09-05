/**
 * T38 — Demo seed fixture consistency (worker half).
 *
 * db/seeds/demo.sql hand-writes corporate-action classification results and dedupe keys
 * directly as SQL literals (it seeds worker-owned tables without running the worker's
 * actual pipeline). These tests pin those literals against the real, tested functions
 * they must agree with, so a future change to classification rules or dedupe-key format
 * fails loudly here instead of silently drifting from the demo story.
 */
import { describe, it, expect } from 'vitest';
import { toSessionDate, toUtcTimestamp, SignalType } from '@stockwatch/contracts';
import { classifyCorporateAction, type CorporateActionCandidate } from '../src/adjustment/index.js';
import { corporateActionDedupeKey, earningsDedupeKey } from '../src/signals/dedupe.js';
import corporateActionFixture from './fixtures/demo/corporate-action.json' with { type: 'json' };
import marketEventFixture from './fixtures/demo/market-event.json' with { type: 'json' };

describe('T38 — demo seed fixture consistency', () => {
  it('the seeded AAPL split classifies as supported with the exact factor demo.sql hardcodes', () => {
    const candidate: CorporateActionCandidate = {
      instrumentId: '0',
      actionType: corporateActionFixture.actionType,
      effectiveDate: toSessionDate('2024-01-01'),
      adjustmentFactor: corporateActionFixture.adjustmentFactor,
      source: corporateActionFixture.source,
    };

    const result = classifyCorporateAction(candidate);

    expect(result.isSupported).toBe(true);
    expect(result.adjustmentFactor).toBe('0.25');
  });

  it("demo.sql's literal CORPORATE_ACTION_APPLIED dedupe key matches corporateActionDedupeKey's format", () => {
    const effectiveDate = toSessionDate('2024-06-15');

    const key = corporateActionDedupeKey({
      signalType: SignalType.CORPORATE_ACTION_APPLIED,
      actionType: corporateActionFixture.actionType,
      effectiveDate,
      factor: corporateActionFixture.adjustmentFactor,
    });

    // Same template db/seeds/demo.sql builds: 'CORPORATE_ACTION_APPLIED:SPLIT:' || date || ':0.25'
    expect(key).toBe(`CORPORATE_ACTION_APPLIED:SPLIT:${effectiveDate}:0.25`);
  });

  it('the seeded TSLA earnings event dedupes on the timestamp+fiscal-period fallback (no provider event id)', () => {
    const eventTimestamp = toUtcTimestamp(Date.parse('2024-06-15T13:00:00.000Z'));

    const key = earningsDedupeKey({
      signalType: SignalType.EARNINGS_RELEASED,
      eventTimestamp,
      fiscalPeriod: marketEventFixture.fiscalPeriod,
    });

    expect(key).toBe(`EARNINGS_RELEASED:${eventTimestamp}:${marketEventFixture.fiscalPeriod}`);
  });
});
