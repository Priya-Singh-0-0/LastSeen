import { Decimal, Observation, DailyBar } from '@stockwatch/contracts';

export const INSUFFICIENT_HISTORY = 'INSUFFICIENT_HISTORY';

export interface Features {
  returns_1d: Decimal;
  sigma20: Decimal;
  true_range: Decimal;
  volume_median20: Decimal;
  volume_ratio: Decimal;
  high20: Decimal;
  low20: Decimal;
  gap_pct: Decimal;
  bars_available: number;
}

/**
 * Extracts deterministic features from the current observation and historical bars.
 * 
 * @param current The current market observation
 * @param history Historical daily bars, sorted descending by date (history[0] is yesterday)
 * @returns Features or INSUFFICIENT_HISTORY if bars_available < 20
 */
export function extractFeatures(current: Observation, history: DailyBar[]): Features | typeof INSUFFICIENT_HISTORY {
  const bars_available = history.length;
  
  if (bars_available < 20) {
    return INSUFFICIENT_HISTORY;
  }

  // 1. Resolve current day fields and prevClose
  const prevClose = current.prevClose ?? history[0]!.close;
  const currentPrice = current.price;
  const currentHigh = current.high ?? currentPrice;
  const currentLow = current.low ?? currentPrice;
  const currentOpen = current.open ?? currentPrice;
  const currentVolume = current.volume ?? new Decimal(0);

  // 2. returns_1d: simple return (currentPrice - prevClose) / prevClose
  const returns_1d = currentPrice.minus(prevClose).dividedBy(prevClose);

  // 3. gap_pct: (open - prevClose) / prevClose
  const gap_pct = currentOpen.minus(prevClose).dividedBy(prevClose);

  // 4. true_range: max(high, prevClose) - min(low, prevClose)
  const maxHighPrev = Decimal.max(currentHigh, prevClose);
  const minLowPrev = Decimal.min(currentLow, prevClose);
  const true_range = maxHighPrev.minus(minLowPrev);

  // 5. high20 / low20 over the past 20 sessions (not including today)
  let high20 = history[0]!.high;
  let low20 = history[0]!.low;
  for (let i = 1; i < 20; i++) {
    const bar = history[i]!;
    if (bar.high.greaterThan(high20)) {
      high20 = bar.high;
    }
    if (bar.low.lessThan(low20)) {
      low20 = bar.low;
    }
  }

  // 6. volume_median20 over the past 20 sessions (not including today)
  const volumes20 = history.slice(0, 20).map(b => b.volume).sort((a, b) => a.cmp(b));
  // 20 items, so median is average of index 9 and 10
  const volume_median20 = volumes20[9]!.plus(volumes20[10]!).dividedBy(2);

  // 7. volume_ratio
  let volume_ratio: Decimal;
  if (volume_median20.isZero()) {
    volume_ratio = new Decimal(1); // prevent divide-by-zero
  } else {
    volume_ratio = currentVolume.dividedBy(volume_median20);
  }

  // 8. sigma20: stdev of 20 daily log returns (including today)
  // r_0 = ln(currentPrice / history[0].close)
  // r_1 = ln(history[0].close / history[1].close)
  // ...
  // r_19 = ln(history[18].close / history[19].close)
  const logReturns: Decimal[] = [];
  logReturns.push(Decimal.ln(currentPrice.dividedBy(history[0]!.close)));
  for (let i = 0; i < 19; i++) {
    logReturns.push(Decimal.ln(history[i]!.close.dividedBy(history[i + 1]!.close)));
  }

  // Mean of log returns
  let sumReturns = new Decimal(0);
  for (const r of logReturns) {
    sumReturns = sumReturns.plus(r);
  }
  const meanReturn = sumReturns.dividedBy(20);

  // Variance (sample variance, divided by N-1 = 19)
  let sumSquaredDiffs = new Decimal(0);
  for (const r of logReturns) {
    const diff = r.minus(meanReturn);
    sumSquaredDiffs = sumSquaredDiffs.plus(diff.times(diff));
  }
  const variance = sumSquaredDiffs.dividedBy(19);
  const sigma20 = variance.sqrt();

  return {
    returns_1d,
    sigma20,
    true_range,
    volume_median20,
    volume_ratio,
    high20,
    low20,
    gap_pct,
    bars_available
  };
}
