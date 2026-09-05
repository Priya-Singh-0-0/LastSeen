import { describe, it, expect } from 'vitest';
import {
  Decimal,
  SignalType,
  toSessionDate,
  toUtcTimestamp,
  MarketStatus,
  ValueKind,
  DataFreshness,
  type Observation,
  type DailyBar,
  type MarketEvent,
  type CorporateAction,
} from '@stockwatch/contracts';
import { INSUFFICIENT_HISTORY, type Features } from '../src/features/index.js';
import {
  evaluateDetectors,
  detectVolatilityAdjustedMove,
  detectLargeAbsoluteMove,
  detectSignificantGap,
  detectRangeBreakout,
  detectAbnormalVolume,
  detectVolumeAcceleration,
  detectEarningsReleased,
  detectCorporateActionApplied,
  type DetectorInput,
} from '../src/signals/detectors.js';

describe('the eight detectors (T21)', () => {
  const baseObservation: Observation = {
    instrumentId: 'inst-1',
    symbol: 'AAPL',
    currency: 'USD',
    marketTimestamp: toUtcTimestamp(Date.parse('2024-07-02T16:00:00Z')),
    ingestedAt: toUtcTimestamp(Date.parse('2024-07-02T16:00:01Z')),
    source: 'test',
    marketStatus: MarketStatus.OPEN,
    valueKind: ValueKind.LIVE,
    dataFreshness: DataFreshness.FRESH,
    price: new Decimal(100),
    prevClose: new Decimal(100),
    open: new Decimal(100),
    high: new Decimal(100),
    low: new Decimal(100),
    volume: new Decimal(1000),
  };

  const baseFeatures: Features = {
    returns_1d: new Decimal(0),
    sigma20: new Decimal('0.01'),
    true_range: new Decimal(0),
    volume_median20: new Decimal(1000),
    volume_ratio: new Decimal(1),
    high20: new Decimal(110),
    low20: new Decimal(90),
    gap_pct: new Decimal(0),
    bars_available: 20,
  };

  const dummyBar = (volume: Decimal): DailyBar => ({
    instrumentId: 'inst-1',
    sessionDate: toSessionDate('2024-07-01'),
    open: new Decimal(100),
    high: new Decimal(100),
    low: new Decimal(100),
    close: new Decimal(100),
    volume,
  });

  const makeInput = (overrides: Partial<DetectorInput> = {}): DetectorInput => ({
    instrumentId: 'inst-1',
    observation: baseObservation,
    history: [dummyBar(new Decimal(1000)), dummyBar(new Decimal(1000))],
    features: baseFeatures,
    sessionDate: toSessionDate('2024-07-02'),
    newMarketEvents: [],
    newCorporateActions: [],
    ...overrides,
  });

  // ── 1. VOLATILITY_ADJUSTED_MOVE — abs(returns_1d) >= 2.0 * sigma20 ──
  describe('VOLATILITY_ADJUSTED_MOVE', () => {
    it('just below 2.0x sigma20 fires nothing', () => {
      const input = makeInput({
        features: { ...baseFeatures, sigma20: new Decimal('0.01'), returns_1d: new Decimal('0.0199') },
      });
      expect(detectVolatilityAdjustedMove(input)).toBeUndefined();
    });

    it('at/above 2.0x sigma20 fires', () => {
      const input = makeInput({
        features: { ...baseFeatures, sigma20: new Decimal('0.01'), returns_1d: new Decimal('0.02') },
      });
      const result = detectVolatilityAdjustedMove(input);
      expect(result).toBeDefined();
      expect(result?.signalType).toBe(SignalType.VOLATILITY_ADJUSTED_MOVE);
      expect(result?.evidence.multiple).toBe('2');
    });

    it('suppresses rather than divides by a zero sigma20', () => {
      const input = makeInput({
        features: { ...baseFeatures, sigma20: new Decimal(0), returns_1d: new Decimal('0.5') },
      });
      expect(detectVolatilityAdjustedMove(input)).toBeUndefined();
    });
  });

  // ── 2. LARGE_ABSOLUTE_MOVE — abs(returns_1d) >= 5% ──
  describe('LARGE_ABSOLUTE_MOVE', () => {
    it('just below 5% fires nothing', () => {
      const input = makeInput({ features: { ...baseFeatures, returns_1d: new Decimal('0.0499') } });
      expect(detectLargeAbsoluteMove(input)).toBeUndefined();
    });

    it('at/above 5% fires', () => {
      const input = makeInput({ features: { ...baseFeatures, returns_1d: new Decimal('0.05') } });
      const result = detectLargeAbsoluteMove(input);
      expect(result).toBeDefined();
      expect(result?.signalType).toBe(SignalType.LARGE_ABSOLUTE_MOVE);
    });
  });

  // ── 3. SIGNIFICANT_GAP — abs(gap_pct) >= 3% AND >= 1.5 * sigma20 ──
  describe('SIGNIFICANT_GAP', () => {
    it('just below 3% fires nothing', () => {
      const input = makeInput({
        features: { ...baseFeatures, gap_pct: new Decimal('0.0299'), sigma20: new Decimal('0.001') },
      });
      expect(detectSignificantGap(input)).toBeUndefined();
    });

    it('at/above both thresholds fires', () => {
      const input = makeInput({
        features: { ...baseFeatures, gap_pct: new Decimal('0.03'), sigma20: new Decimal('0.001') },
      });
      const result = detectSignificantGap(input);
      expect(result).toBeDefined();
      expect(result?.signalType).toBe(SignalType.SIGNIFICANT_GAP);
    });

    it('above the pct threshold but below the sigma threshold fires nothing', () => {
      const input = makeInput({
        // gap_pct 4% clears 3%, but sigma20 is wide enough that 1.5x sigma exceeds the gap
        features: { ...baseFeatures, gap_pct: new Decimal('0.04'), sigma20: new Decimal('0.05') },
      });
      expect(detectSignificantGap(input)).toBeUndefined();
    });
  });

  // ── 4. RANGE_BREAKOUT — close > high20 or close < low20 ──
  describe('RANGE_BREAKOUT', () => {
    it('close at high20 fires nothing', () => {
      const input = makeInput({
        observation: { ...baseObservation, price: new Decimal(110) },
        features: { ...baseFeatures, high20: new Decimal(110), low20: new Decimal(90) },
      });
      expect(detectRangeBreakout(input)).toBeUndefined();
    });

    it('close just above high20 fires', () => {
      const input = makeInput({
        observation: { ...baseObservation, price: new Decimal('110.01') },
        features: { ...baseFeatures, high20: new Decimal(110), low20: new Decimal(90) },
      });
      const result = detectRangeBreakout(input);
      expect(result).toBeDefined();
      expect(result?.evidence.direction).toBe('above');
    });

    it('close just below low20 fires', () => {
      const input = makeInput({
        observation: { ...baseObservation, price: new Decimal('89.99') },
        features: { ...baseFeatures, high20: new Decimal(110), low20: new Decimal(90) },
      });
      const result = detectRangeBreakout(input);
      expect(result).toBeDefined();
      expect(result?.evidence.direction).toBe('below');
    });
  });

  // ── 5. ABNORMAL_VOLUME — volume_ratio >= 2.5 ──
  describe('ABNORMAL_VOLUME', () => {
    it('just below 2.5x fires nothing', () => {
      const input = makeInput({ features: { ...baseFeatures, volume_ratio: new Decimal('2.49') } });
      expect(detectAbnormalVolume(input)).toBeUndefined();
    });

    it('at/above 2.5x fires', () => {
      const input = makeInput({ features: { ...baseFeatures, volume_ratio: new Decimal('2.5') } });
      const result = detectAbnormalVolume(input);
      expect(result).toBeDefined();
      expect(result?.signalType).toBe(SignalType.ABNORMAL_VOLUME);
    });
  });

  // ── 6. VOLUME_ACCELERATION — 3-session mean >= 1.8x median20, rising ──
  describe('VOLUME_ACCELERATION', () => {
    it('rising but just below 1.8x mean fires nothing', () => {
      const input = makeInput({
        observation: { ...baseObservation, volume: new Decimal(1700) },
        history: [dummyBar(new Decimal(1600)), dummyBar(new Decimal(1500))],
        features: { ...baseFeatures, volume_median20: new Decimal(1000) },
      });
      // mean3 = (1700+1600+1500)/3 = 1600 -> ratio 1.6 < 1.8
      expect(detectVolumeAcceleration(input)).toBeUndefined();
    });

    it('rising and at/above 1.8x mean fires', () => {
      const input = makeInput({
        observation: { ...baseObservation, volume: new Decimal(2000) },
        history: [dummyBar(new Decimal(1800)), dummyBar(new Decimal(1600))],
        features: { ...baseFeatures, volume_median20: new Decimal(1000) },
      });
      // mean3 = (2000+1800+1600)/3 = 1800 -> ratio 1.8
      const result = detectVolumeAcceleration(input);
      expect(result).toBeDefined();
      expect(result?.signalType).toBe(SignalType.VOLUME_ACCELERATION);
    });

    it('above threshold but not rising fires nothing', () => {
      const input = makeInput({
        observation: { ...baseObservation, volume: new Decimal(1600) },
        history: [dummyBar(new Decimal(2000)), dummyBar(new Decimal(1800))],
        features: { ...baseFeatures, volume_median20: new Decimal(1000) },
      });
      // mean3 = 1800, ratio 1.8, but today (1600) < yesterday (2000): not rising
      expect(detectVolumeAcceleration(input)).toBeUndefined();
    });
  });

  // ── 7 & 8. Event predicates fire regardless of INSUFFICIENT_HISTORY ──
  describe('event predicates under INSUFFICIENT_HISTORY', () => {
    it('insufficient_history_emits_no_price_signals — price/volume predicates emit nothing under INSUFFICIENT_HISTORY', () => {
      const input = makeInput({ features: INSUFFICIENT_HISTORY });
      expect(detectVolatilityAdjustedMove(input)).toBeUndefined();
      expect(detectLargeAbsoluteMove(input)).toBeUndefined();
      expect(detectSignificantGap(input)).toBeUndefined();
      expect(detectRangeBreakout(input)).toBeUndefined();
      expect(detectAbnormalVolume(input)).toBeUndefined();
      expect(detectVolumeAcceleration(input)).toBeUndefined();
    });

    it('EARNINGS_RELEASED still fires under INSUFFICIENT_HISTORY', () => {
      const event: MarketEvent = {
        instrumentId: 'inst-1',
        eventType: 'EARNINGS',
        eventTimestamp: toUtcTimestamp(1000),
        fiscalPeriod: 'Q3-2024',
        providerEventId: 'evt-1',
        source: 'test',
      };
      const input = makeInput({ features: INSUFFICIENT_HISTORY, newMarketEvents: [event] });
      const results = detectEarningsReleased(input);
      expect(results).toHaveLength(1);
      expect(results[0]?.signalType).toBe(SignalType.EARNINGS_RELEASED);
      expect(results[0]?.dedupeKey).toBe('EARNINGS_RELEASED:evt-1');
    });

    it('non-earnings events do not fire EARNINGS_RELEASED', () => {
      const event: MarketEvent = {
        instrumentId: 'inst-1',
        eventType: 'GUIDANCE',
        eventTimestamp: toUtcTimestamp(1000),
        source: 'test',
      };
      const input = makeInput({ newMarketEvents: [event] });
      expect(detectEarningsReleased(input)).toHaveLength(0);
    });

    it('CORPORATE_ACTION_APPLIED still fires under INSUFFICIENT_HISTORY', () => {
      const action: CorporateAction = {
        instrumentId: 'inst-1',
        actionType: 'SPLIT',
        effectiveDate: toSessionDate('2024-07-02'),
        adjustmentFactor: new Decimal('0.25'),
        isSupported: true,
        versionSeq: 1,
        source: 'test',
      };
      const input = makeInput({ features: INSUFFICIENT_HISTORY, newCorporateActions: [action] });
      const results = detectCorporateActionApplied(input);
      expect(results).toHaveLength(1);
      expect(results[0]?.signalType).toBe(SignalType.CORPORATE_ACTION_APPLIED);
      expect(results[0]?.dedupeKey).toBe('CORPORATE_ACTION_APPLIED:SPLIT:2024-07-02:0.25');
    });
  });

  // ── Re-running the detector over identical data produces no duplicate rows ──
  // (each of the four dedupe-key classes: price signals, volume signals, earnings, corporate action)
  describe('idempotency across all four dedupe-key classes', () => {
    it('produces identical dedupe keys on repeated evaluation', () => {
      const event: MarketEvent = {
        instrumentId: 'inst-1',
        eventType: 'EARNINGS',
        eventTimestamp: toUtcTimestamp(1000),
        fiscalPeriod: 'Q3-2024',
        source: 'test',
      };
      const action: CorporateAction = {
        instrumentId: 'inst-1',
        actionType: 'SPLIT',
        effectiveDate: toSessionDate('2024-07-02'),
        adjustmentFactor: new Decimal('0.5'),
        isSupported: true,
        versionSeq: 1,
        source: 'test',
      };

      const input = makeInput({
        observation: { ...baseObservation, price: new Decimal('110.01'), volume: new Decimal(3000) },
        features: {
          ...baseFeatures,
          returns_1d: new Decimal('0.1'),
          sigma20: new Decimal('0.01'),
          gap_pct: new Decimal('0.1'),
          high20: new Decimal(110),
          volume_ratio: new Decimal('3'),
        },
        history: [dummyBar(new Decimal(2900)), dummyBar(new Decimal(2800))],
        newMarketEvents: [event],
        newCorporateActions: [action],
      });

      const first = evaluateDetectors(input);
      const second = evaluateDetectors(input);

      expect(first.length).toBeGreaterThan(0);
      expect(first.map((s) => s.dedupeKey).sort()).toEqual(second.map((s) => s.dedupeKey).sort());

      // sanity: one representative from each of the four dedupe-key classes fired
      const types = new Set(first.map((s) => s.signalType));
      expect(types.has(SignalType.LARGE_ABSOLUTE_MOVE)).toBe(true); // price signal class
      expect(types.has(SignalType.ABNORMAL_VOLUME)).toBe(true); // volume signal class
      expect(types.has(SignalType.EARNINGS_RELEASED)).toBe(true); // earnings class
      expect(types.has(SignalType.CORPORATE_ACTION_APPLIED)).toBe(true); // corporate action class
    });
  });
});
