import { describe, it, expect } from 'vitest';
import { extractFeatures, INSUFFICIENT_HISTORY } from '../src/features/index.js';
import { Decimal, Observation, DailyBar, MarketStatus, ValueKind, DataFreshness } from '@stockwatch/contracts';

describe('FeatureExtractor', () => {
  const baseObservation = {
    instrumentId: 'inst-1',
    symbol: 'AAPL',
    currency: 'USD',
    marketTimestamp: '2024-07-02T16:00:00Z',
    ingestedAt: '2024-07-02T16:00:01Z',
    source: 'test',
    marketStatus: MarketStatus.OPEN,
    valueKind: ValueKind.LIVE,
    dataFreshness: DataFreshness.FRESH,
  };

  const createHistory = (count: number, volume: number = 1000): DailyBar[] => {
    const bars: DailyBar[] = [];
    for (let i = 0; i < count; i++) {
      // Create some price variation for valid log returns
      const price = new Decimal(100 + i); 
      bars.push({
        instrumentId: 'inst-1',
        sessionDate: `2024-06-${Math.max(1, 30 - i).toString().padStart(2, '0')}`,
        open: price.minus(1),
        high: price.plus(2),
        low: price.minus(2),
        close: price,
        volume: new Decimal(volume),
      });
    }
    return bars;
  };

  it('five bars yields INSUFFICIENT_HISTORY with no NaN, no Infinity, and no divide-by-zero', () => {
    const history = createHistory(5);
    const observation: Observation = {
      ...baseObservation,
      price: new Decimal(105),
      volume: new Decimal(0),
    };

    const result = extractFeatures(observation, history);
    expect(result).toBe(INSUFFICIENT_HISTORY);
  });

  it('a zero-volume session does not throw', () => {
    const history = createHistory(20, 0); // 20 sessions with 0 volume
    const observation: Observation = {
      ...baseObservation,
      price: new Decimal(150),
      volume: new Decimal(0), // zero volume today
    };

    const result = extractFeatures(observation, history);
    expect(result).not.toBe(INSUFFICIENT_HISTORY);
    
    if (result !== INSUFFICIENT_HISTORY) {
      expect(result.volume_median20.toString()).toBe('0');
      expect(result.volume_ratio.toString()).toBe('1'); // fallback for div-by-zero
    }
  });

  it('Known-input fixtures produce known outputs to exact decimal precision', () => {
    // We will craft a specific 20-bar history to test exact math.
    const history: DailyBar[] = [];
    // 20 bars of close = 100
    for (let i = 0; i < 20; i++) {
      history.push({
        instrumentId: 'inst-1',
        sessionDate: '2024-01-01',
        open: new Decimal('95'),
        high: new Decimal('105'),
        low: new Decimal('90'),
        close: new Decimal('100'),
        volume: new Decimal('1000').plus(new Decimal(i * 100)), // volumes: 1000, 1100, ..., 2900
      });
    }

    const observation: Observation = {
      ...baseObservation,
      price: new Decimal('105'), // 5% up
      open: new Decimal('102'), // gap up 2%
      high: new Decimal('106'),
      low: new Decimal('101'),
      volume: new Decimal('4000'), // above median
    };

    const result = extractFeatures(observation, history);
    expect(result).not.toBe(INSUFFICIENT_HISTORY);

    if (result !== INSUFFICIENT_HISTORY) {
      // prevClose = history[0].close = 100
      
      // 1d return = (105 - 100) / 100 = 0.05
      expect(result.returns_1d.toString()).toBe('0.05');

      // gap pct = (102 - 100) / 100 = 0.02
      expect(result.gap_pct.toString()).toBe('0.02');

      // true range = max(106, 100) - min(101, 100) = 106 - 100 = 6
      expect(result.true_range.toString()).toBe('6');

      // high20 = max of history highs (all 105)
      expect(result.high20.toString()).toBe('105');

      // low20 = min of history lows (all 90)
      expect(result.low20.toString()).toBe('90');

      // volume median of 1000..2900.
      // array: 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000, 2100, 2200, 2300, 2400, 2500, 2600, 2700, 2800, 2900
      // 10th item (idx 9) = 1900, 11th item (idx 10) = 2000
      // median = (1900 + 2000) / 2 = 1950
      expect(result.volume_median20.toString()).toBe('1950');

      // volume_ratio = 4000 / 1950 = 2.051282051282051282...
      expect(result.volume_ratio.toFixed(4)).toBe('2.0513');

      // sigma20:
      // r_0 = ln(105/100) = ln(1.05) ~= 0.048790164
      // r_1 to r_19 = ln(100/100) = 0
      // Mean = ln(1.05) / 20 ~= 0.0024395082
      // Variance: sum((r_i - mean)^2) / 19
      // For r_0: (ln(1.05) - mean)^2 = (19/20 * ln(1.05))^2
      // For r_1..19: 19 * (0 - mean)^2 = 19 * (-1/20 * ln(1.05))^2
      // Sum = (19/20)^2 * ln(1.05)^2 + 19 * (-1/20)^2 * ln(1.05)^2
      //     = (361/400 + 19/400) * ln(1.05)^2 = (380/400) * ln(1.05)^2 = 0.95 * ln(1.05)^2
      // Variance = (0.95 * ln(1.05)^2) / 19 = 0.05 * ln(1.05)^2
      // sigma20 = sqrt(0.05) * ln(1.05)
      const expectedSigma20 = Decimal.sqrt('0.05').times(Decimal.ln('1.05'));
      
      expect(result.sigma20.toFixed(8)).toBe(expectedSigma20.toFixed(8));
      
      expect(result.bars_available).toBe(20);
    }
  });
});
