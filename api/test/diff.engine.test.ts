/**
 * T27 — DiffEngine: since-last-check (architecture §F.5) (INV-9, INV-11, INV-12)
 *
 * Pure-function tests — no DB. `computeSinceLastCheck` takes already-fetched inputs
 * (checkpoint, current state, T26's `factorBetween` result, the bounded unseen-changes
 * list, and the holiday set); it performs no I/O itself.
 */
import { describe, it, expect } from 'vitest';
import { computeSinceLastCheck } from '../src/diff/engine.js';
import { D, parseDecimal, toSessionDate, toUtcTimestamp, DataFreshness } from '@stockwatch/contracts';
import type { AdjustmentResult } from '../src/diff/adjustment.js';

const NO_ADJUSTMENT: AdjustmentResult = { factor: D.one(), hasUnsupportedAction: false, actions: [], splitLabels: [] };
const NO_HOLIDAYS = new Set<ReturnType<typeof toSessionDate>>();

// 2024-01-08 is a Monday; 2024-01-15 is the next Monday (a full week later, no holidays in range).
const MONDAY = toUtcTimestamp(new Date('2024-01-08T14:30:00Z').getTime());
const NEXT_MONDAY = toUtcTimestamp(new Date('2024-01-15T14:30:00Z').getTime());

describe('T27 — DiffEngine: since_last_check_arithmetic_is_exact', () => {
  it.each([
    // expectedPct is a percentage, not a fraction: (110-100)/100 = 0.1 → 10%.
    { baseline: '100.000000', current: '110.000000', expectedAbs: '10', expectedPct: '10' },
    { baseline: '100.000000', current: '90.000000', expectedAbs: '-10', expectedPct: '-10' },
    { baseline: '200.000000', current: '150.000000', expectedAbs: '-50', expectedPct: '-25' },
    { baseline: '50.000000', current: '50.000000', expectedAbs: '0', expectedPct: '0' },
  ])('baseline $baseline → current $current is exact', ({ baseline, current, expectedAbs, expectedPct }) => {
    const result = computeSinceLastCheck({
      checkpoint: { baselinePrice: parseDecimal(baseline), baselineMarketTimestamp: MONDAY },
      current: {
        price: parseDecimal(current),
        marketTimestamp: MONDAY,
        dataFreshness: DataFreshness.FRESH,
        sigma20: parseDecimal('0.020000'),
      },
      adjustment: NO_ADJUSTMENT,
      unseenChanges: [],
      holidays: NO_HOLIDAYS,
    });

    expect(result.comparisonStatus).toBe('OK');
    expect(result.absoluteChange!.toFixed()).toBe(expectedAbs);
    expect(result.percentageChange!.toFixed()).toBe(expectedPct);
  });

  it('correct sign: a drop produces a negative percentage and absolute change', () => {
    const result = computeSinceLastCheck({
      checkpoint: { baselinePrice: parseDecimal('200.000000'), baselineMarketTimestamp: MONDAY },
      current: {
        price: parseDecimal('180.000000'),
        marketTimestamp: MONDAY,
        dataFreshness: DataFreshness.FRESH,
        sigma20: parseDecimal('0.020000'),
      },
      adjustment: NO_ADJUSTMENT,
      unseenChanges: [],
      holidays: NO_HOLIDAYS,
    });

    expect(result.absoluteChange!.isNegative()).toBe(true);
    expect(result.percentageChange!.isNegative()).toBe(true);
  });

  it('counts trading sessions across a weekend, excluding Sat/Sun', () => {
    const result = computeSinceLastCheck({
      checkpoint: { baselinePrice: parseDecimal('100.000000'), baselineMarketTimestamp: MONDAY },
      current: {
        price: parseDecimal('101.000000'),
        marketTimestamp: NEXT_MONDAY,
        dataFreshness: DataFreshness.FRESH,
        sigma20: parseDecimal('0.020000'),
      },
      adjustment: NO_ADJUSTMENT,
      unseenChanges: [],
      holidays: NO_HOLIDAYS,
    });

    // Mon 1/8 -> Mon 1/15: Tue,Wed,Thu,Fri,(Sat,Sun skipped),Mon = 5 sessions.
    expect(result.sessionsElapsed).toBe(5);
  });

  it('excludes a holiday from the session count', () => {
    const result = computeSinceLastCheck({
      checkpoint: { baselinePrice: parseDecimal('100.000000'), baselineMarketTimestamp: MONDAY },
      current: {
        price: parseDecimal('101.000000'),
        marketTimestamp: NEXT_MONDAY,
        dataFreshness: DataFreshness.FRESH,
        sigma20: parseDecimal('0.020000'),
      },
      adjustment: NO_ADJUSTMENT,
      unseenChanges: [],
      // 2024-01-15 is itself MLK Day in the US — but that's the end date, not counted per
      // countSessions semantics (see packages/contracts/test/calendar.test.ts); use a holiday
      // strictly inside the span instead: 2024-01-10 (Wednesday).
      holidays: new Set([toSessionDate('2024-01-10')]),
    });

    expect(result.sessionsElapsed).toBe(4);
  });

  it('elapsed time is the exact millisecond difference between market timestamps', () => {
    const result = computeSinceLastCheck({
      checkpoint: { baselinePrice: parseDecimal('100.000000'), baselineMarketTimestamp: MONDAY },
      current: {
        price: parseDecimal('101.000000'),
        marketTimestamp: NEXT_MONDAY,
        dataFreshness: DataFreshness.FRESH,
        sigma20: parseDecimal('0.020000'),
      },
      adjustment: NO_ADJUSTMENT,
      unseenChanges: [],
      holidays: NO_HOLIDAYS,
    });

    expect(result.elapsedMs).toBe(NEXT_MONDAY - MONDAY);
  });
});

describe('T27 — DiffEngine: AWAITING_BASELINE', () => {
  it('reports AWAITING_BASELINE with no financial fields when the checkpoint has no baseline', () => {
    const result = computeSinceLastCheck({
      checkpoint: { baselinePrice: null, baselineMarketTimestamp: null },
      current: {
        price: parseDecimal('100.000000'),
        marketTimestamp: MONDAY,
        dataFreshness: DataFreshness.FRESH,
        sigma20: parseDecimal('0.020000'),
      },
      adjustment: NO_ADJUSTMENT,
      unseenChanges: ['change-1'],
      holidays: NO_HOLIDAYS,
    });

    expect(result.comparisonStatus).toBe('AWAITING_BASELINE');
    expect(result.absoluteChange).toBeUndefined();
    expect(result.percentageChange).toBeUndefined();
    expect(result.volatilityMultiple).toBeUndefined();
    // Unseen changes and freshness are independent of having a baseline.
    expect(result.unseenChanges).toEqual(['change-1']);
    expect(result.dataFreshness).toBe(DataFreshness.FRESH);
  });
});

describe('T27 — DiffEngine: suppression short-circuit (INV-12)', () => {
  it('an unsupported action in the adjustment range suppresses the comparison with no percentage', () => {
    const suppressingAdjustment: AdjustmentResult = {
      factor: D.one(),
      hasUnsupportedAction: true,
      actions: [],
      splitLabels: [],
    };

    const result = computeSinceLastCheck({
      checkpoint: { baselinePrice: parseDecimal('100.000000'), baselineMarketTimestamp: MONDAY },
      current: {
        price: parseDecimal('50.000000'),
        marketTimestamp: NEXT_MONDAY,
        dataFreshness: DataFreshness.FRESH,
        sigma20: parseDecimal('0.020000'),
      },
      adjustment: suppressingAdjustment,
      unseenChanges: [],
      holidays: NO_HOLIDAYS,
    });

    expect(result.comparisonStatus).toBe('SUPPRESSED_CORPORATE_ACTION');
    expect(result.percentageChange).toBeUndefined();
    expect(result.absoluteChange).toBeUndefined();
  });
});

describe('T27 — DiffEngine: INSUFFICIENT_HISTORY', () => {
  it('reports INSUFFICIENT_HISTORY and omits volatilityMultiple when sigma20 is unavailable', () => {
    const result = computeSinceLastCheck({
      checkpoint: { baselinePrice: parseDecimal('100.000000'), baselineMarketTimestamp: MONDAY },
      current: {
        price: parseDecimal('110.000000'),
        marketTimestamp: NEXT_MONDAY,
        dataFreshness: DataFreshness.FRESH,
        sigma20: null,
      },
      adjustment: NO_ADJUSTMENT,
      unseenChanges: [],
      holidays: NO_HOLIDAYS,
    });

    expect(result.comparisonStatus).toBe('INSUFFICIENT_HISTORY');
    // The raw price comparison is still meaningful even without a volatility baseline.
    expect(result.absoluteChange!.toFixed()).toBe('10');
    expect(result.volatilityMultiple).toBeUndefined();
  });

  it('a zero-variance sigma20 also omits volatilityMultiple rather than dividing by zero', () => {
    const result = computeSinceLastCheck({
      checkpoint: { baselinePrice: parseDecimal('100.000000'), baselineMarketTimestamp: MONDAY },
      current: {
        price: parseDecimal('110.000000'),
        marketTimestamp: NEXT_MONDAY,
        dataFreshness: DataFreshness.FRESH,
        sigma20: D.zero(),
      },
      adjustment: NO_ADJUSTMENT,
      unseenChanges: [],
      holidays: NO_HOLIDAYS,
    });

    expect(result.comparisonStatus).toBe('OK');
    expect(result.volatilityMultiple).toBeUndefined();
  });
});

describe('T27 — DiffEngine: freshness propagation', () => {
  it('freshness is propagated from current market state verbatim, never recomputed', () => {
    const result = computeSinceLastCheck({
      checkpoint: { baselinePrice: parseDecimal('100.000000'), baselineMarketTimestamp: MONDAY },
      current: {
        price: parseDecimal('100.000000'),
        marketTimestamp: MONDAY,
        dataFreshness: DataFreshness.STALE,
        sigma20: parseDecimal('0.020000'),
      },
      adjustment: NO_ADJUSTMENT,
      unseenChanges: [],
      holidays: NO_HOLIDAYS,
    });

    expect(result.dataFreshness).toBe(DataFreshness.STALE);
  });
});

describe('T27 — DiffEngine: unseen changes pass through unmodified', () => {
  it('the unseen-change list supplied by the caller is returned as-is', () => {
    const unseen = [{ publishedSeq: 5n }, { publishedSeq: 6n }];
    const result = computeSinceLastCheck({
      checkpoint: { baselinePrice: parseDecimal('100.000000'), baselineMarketTimestamp: MONDAY },
      current: {
        price: parseDecimal('100.000000'),
        marketTimestamp: MONDAY,
        dataFreshness: DataFreshness.FRESH,
        sigma20: parseDecimal('0.020000'),
      },
      adjustment: NO_ADJUSTMENT,
      unseenChanges: unseen,
      holidays: NO_HOLIDAYS,
    });

    expect(result.unseenChanges).toBe(unseen);
  });
});
