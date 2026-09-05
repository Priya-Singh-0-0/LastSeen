/**
 * T35 — Unsupported-action suppression (architecture §F.5, §O.2) (INV-12)
 *
 * `unsupported_corporate_action_suppresses_comparison`: any unsupported action in the version
 * range must short-circuit to `SUPPRESSED_CORPORATE_ACTION` with no percentage, absolute change,
 * or volatility multiple field present at all — never a null, never a zero. Pure-function test
 * over `computeSinceLastCheck`, same style as `split.regression.test.ts` (T34).
 *
 * Gate §O.2. This test must never be skipped or weakened.
 */
import { describe, it, expect } from 'vitest';
import { computeSinceLastCheck } from '../src/diff/engine.js';
import { parseDecimal, toSessionDate, toUtcTimestamp, DataFreshness, type CorporateAction } from '@stockwatch/contracts';
import type { AdjustmentResult } from '../src/diff/adjustment.js';

const NO_HOLIDAYS = new Set<ReturnType<typeof toSessionDate>>();
const MONDAY = toUtcTimestamp(new Date('2024-01-08T14:30:00Z').getTime());
const NEXT_MONDAY = toUtcTimestamp(new Date('2024-01-15T14:30:00Z').getTime());

function unsupportedAction(versionSeq: number): CorporateAction {
  return {
    instrumentId: 'instrument-1',
    actionType: 'MERGER',
    effectiveDate: toSessionDate('2024-01-10'),
    isSupported: false,
    versionSeq,
    source: 'test',
  };
}

function supportedSplit(versionSeq: number, factor: string): CorporateAction {
  return {
    instrumentId: 'instrument-1',
    actionType: 'SPLIT',
    effectiveDate: toSessionDate('2024-01-10'),
    adjustmentFactor: parseDecimal(factor),
    isSupported: true,
    versionSeq,
    source: 'test',
  };
}

function baseInput(adjustment: AdjustmentResult) {
  return {
    checkpoint: { baselinePrice: parseDecimal('180.000000'), baselineMarketTimestamp: MONDAY },
    current: {
      price: parseDecimal('46.000000'),
      marketTimestamp: NEXT_MONDAY,
      dataFreshness: DataFreshness.FRESH,
      sigma20: parseDecimal('0.020000'),
    },
    adjustment,
    unseenChanges: [],
    holidays: NO_HOLIDAYS,
  };
}

describe('T35 — unsupported_corporate_action_suppresses_comparison', () => {
  it('suppresses the comparison with no percentage, absolute change, or volatility multiple field at all', () => {
    const adjustment: AdjustmentResult = {
      factor: parseDecimal('1'),
      hasUnsupportedAction: true,
      actions: [unsupportedAction(1)],
      splitLabels: [],
    };

    const result = computeSinceLastCheck(baseInput(adjustment));

    expect(result.comparisonStatus).toBe('SUPPRESSED_CORPORATE_ACTION');
    expect('percentageChange' in result).toBe(false);
    expect('absoluteChange' in result).toBe(false);
    expect('adjustedBaseline' in result).toBe(false);
    expect('volatilityMultiple' in result).toBe(false);
  });

  it('a supported split alongside an unsupported action still suppresses', () => {
    const adjustment: AdjustmentResult = {
      factor: parseDecimal('0.25'),
      hasUnsupportedAction: true,
      actions: [supportedSplit(1, '0.25'), unsupportedAction(2)],
      splitLabels: ['adjusted for 4-for-1 split'],
    };

    const result = computeSinceLastCheck(baseInput(adjustment));

    expect(result.comparisonStatus).toBe('SUPPRESSED_CORPORATE_ACTION');
    expect('percentageChange' in result).toBe(false);
    expect('absoluteChange' in result).toBe(false);
    expect('adjustedBaseline' in result).toBe(false);
  });

  it('suppression takes effect even with no baseline change and a warming-adjacent current state', () => {
    const adjustment: AdjustmentResult = {
      factor: parseDecimal('1'),
      hasUnsupportedAction: true,
      actions: [unsupportedAction(1)],
      splitLabels: [],
    };
    const input = baseInput(adjustment);

    const result = computeSinceLastCheck({
      ...input,
      current: { ...input.current, price: input.checkpoint.baselinePrice! },
    });

    expect(result.comparisonStatus).toBe('SUPPRESSED_CORPORATE_ACTION');
    expect('percentageChange' in result).toBe(false);
  });
});
