/**
 * T34 — Split-adjusted comparison across a checkpoint (architecture §F.5, §O.1) (INV-12, INV-9)
 *
 * `split_across_checkpoint_does_not_report_crash`: the single most dangerous number in the
 * product. Pure-function test — no DB — over `computeSinceLastCheck` fed a `factorBetween`-
 * shaped `AdjustmentResult` built by hand, same style as `diff.engine.test.ts` (T27).
 *
 * Gate §O.1. This test must never be skipped or weakened.
 */
import { describe, it, expect } from 'vitest';
import { computeSinceLastCheck } from '../src/diff/engine.js';
import { D, parseDecimal, toSessionDate, toUtcTimestamp, DataFreshness, type CorporateAction } from '@stockwatch/contracts';
import { describeSplit, type AdjustmentResult } from '../src/diff/adjustment.js';

const NO_HOLIDAYS = new Set<ReturnType<typeof toSessionDate>>();
const MONDAY = toUtcTimestamp(new Date('2024-01-08T14:30:00Z').getTime());
const NEXT_MONDAY = toUtcTimestamp(new Date('2024-01-15T14:30:00Z').getTime());

function splitAction(versionSeq: number, factor: string): CorporateAction {
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

function adjustmentFor(actions: CorporateAction[]): AdjustmentResult {
  const factor = actions.reduce((acc, a) => D.mul(acc, a.adjustmentFactor!), D.one());
  const splitLabels = actions.map(describeSplit).filter((label): label is string => label !== null);
  return { factor, hasUnsupportedAction: false, actions, splitLabels };
}

describe('T34 — split_across_checkpoint_does_not_report_crash', () => {
  it('a 4-for-1 split across the checkpoint reports +2.2222%, never -74.44%', () => {
    const adjustment = adjustmentFor([splitAction(4, '0.25')]);

    const result = computeSinceLastCheck({
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
    });

    expect(result.comparisonStatus).toBe('OK');
    // adjustedBaseline = 180 * 0.25 = 45; (46 - 45) / 45 = 0.02222... → +2.2222%.
    expect(result.adjustedBaseline!.toFixed()).toBe('45');
    expect(result.percentageChange!.toNumber()).toBeCloseTo(2.2222, 4);
    // The unadjusted, wrong comparison would be (46 - 180) / 180 ≈ -74.44% — must never be reported.
    expect(result.percentageChange!.toDecimalPlaces(2).toNumber()).not.toBeCloseTo(-74.44, 2);
    expect(result.percentageChange!.isNegative()).toBe(false);
  });

  it('carries an "adjusted for 4-for-1 split" label', () => {
    const adjustment = adjustmentFor([splitAction(4, '0.25')]);

    const result = computeSinceLastCheck({
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
    });

    expect(result.adjustmentLabels).toContain('adjusted for 4-for-1 split');
  });

  it('two sequential 2-for-1 splits compose to the same result as one 4-for-1 split', () => {
    const adjustment = adjustmentFor([splitAction(4, '0.5'), splitAction(5, '0.5')]);

    const result = computeSinceLastCheck({
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
    });

    expect(result.adjustedBaseline!.toFixed()).toBe('45');
    expect(result.percentageChange!.toNumber()).toBeCloseTo(2.2222, 4);
    expect(result.adjustmentLabels).toEqual(['adjusted for 2-for-1 split', 'adjusted for 2-for-1 split']);
  });

  it('a split with no intervening price change reports exactly 0.00%', () => {
    const adjustment = adjustmentFor([splitAction(4, '0.25')]);

    const result = computeSinceLastCheck({
      checkpoint: { baselinePrice: parseDecimal('100.000000'), baselineMarketTimestamp: MONDAY },
      current: {
        // Exactly the adjusted baseline: 100 * 0.25 = 25.
        price: parseDecimal('25.000000'),
        marketTimestamp: NEXT_MONDAY,
        dataFreshness: DataFreshness.FRESH,
        sigma20: parseDecimal('0.020000'),
      },
      adjustment,
      unseenChanges: [],
      holidays: NO_HOLIDAYS,
    });

    expect(result.comparisonStatus).toBe('OK');
    expect(result.absoluteChange!.toFixed()).toBe('0');
    expect(result.percentageChange!.toFixed()).toBe('0');
  });
});
