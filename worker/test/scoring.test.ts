import { describe, it, expect } from 'vitest';
import {
  SignalType,
  AttentionBand,
  PhenomenonGroup,
  toSessionDate,
  toUtcTimestamp,
  type SignalEvidence,
} from '@stockwatch/contracts';
import { scoreSignals } from '../src/assembly/scoringV1.js';

const sessionDate = toSessionDate('2024-07-02');
const marketTimestamp = toUtcTimestamp(Date.parse('2024-07-02T16:00:00Z'));

function makeEvidence(
  signalType: SignalType,
  evidence: Record<string, string | boolean>,
  dedupeKey = 'k',
): SignalEvidence {
  return {
    signalType,
    detectorVersion: 1,
    dedupeKey,
    marketTimestamp,
    sessionDate,
    evidence,
  };
}

const maxVolatilityAdjustedMove = makeEvidence(SignalType.VOLATILITY_ADJUSTED_MOVE, {
  pct_change: '0.10',
  sigma20: '0.02',
  multiple: '5.0', // clamp((5.0-2.0)/2.0,0,1) => saturates at 1
  window: '20',
});

const maxLargeAbsoluteMove = makeEvidence(SignalType.LARGE_ABSOLUTE_MOVE, {
  pct_change: '0.20', // clamp((0.20-0.05)/0.05,0,1) => saturates at 1
});

const maxSignificantGap = makeEvidence(SignalType.SIGNIFICANT_GAP, {
  gap_pct: '0.12', // clamp((0.12-0.03)/0.03,0,1) => saturates at 1
  sigma20: '0.02',
  open: '110',
});

const maxRangeBreakout = makeEvidence(SignalType.RANGE_BREAKOUT, {
  close: '150',
  high20: '100',
  low20: '90',
  direction: 'above',
  window: '20',
});

const midAbnormalVolume = makeEvidence(SignalType.ABNORMAL_VOLUME, {
  volume: '1000',
  volume_median20: '400',
  ratio: '2.5', // at threshold => strength 0
});

const higherAbnormalVolume = makeEvidence(SignalType.ABNORMAL_VOLUME, {
  volume: '2000',
  volume_median20: '400',
  ratio: '4.0',
});

describe('scoreSignals (T22 Scoring v1)', () => {
  it('signal_scoring_is_bounded_and_non_double_counting', () => {
    const allFourPriceSignals = [
      maxVolatilityAdjustedMove,
      maxLargeAbsoluteMove,
      maxSignificantGap,
      maxRangeBreakout,
    ];

    const result = scoreSignals(allFourPriceSignals);

    expect(result.score).toBeLessThan(1.0);
    expect(result.score).toBeLessThanOrEqual(0.7); // PRICE_MOVE weight

    const withOneSignal = scoreSignals([maxVolatilityAdjustedMove]);
    const withCorrelatedAddition = scoreSignals([maxVolatilityAdjustedMove, maxLargeAbsoluteMove]);
    expect(withCorrelatedAddition.score).toBeCloseTo(withOneSignal.score, 10);
    expect(withCorrelatedAddition.score).not.toBeGreaterThan(withOneSignal.score + 1e-9);

    const risingStrength = scoreSignals([midAbnormalVolume]);
    const higherStrength = scoreSignals([higherAbnormalVolume]);
    expect(higherStrength.score).toBeGreaterThan(risingStrength.score);

    const empty = scoreSignals([]);
    expect(empty.score).toBe(0);
    expect(empty.band).toBe(AttentionBand.QUIET);
  });

  it('bands score into URGENT/NOTABLE/MINOR/QUIET thresholds', () => {
    // Max PRICE_MOVE strength alone (score=0.70) falls under NOTABLE; URGENT requires
    // multiple groups to combine via noisy-OR.
    expect(scoreSignals([maxVolatilityAdjustedMove]).band).toBe(AttentionBand.NOTABLE);
    expect(scoreSignals([maxVolatilityAdjustedMove, higherAbnormalVolume]).band).toBe(AttentionBand.URGENT);
    expect(scoreSignals([midAbnormalVolume]).band).toBe(AttentionBand.QUIET);
  });

  it('groups signals into PRICE_MOVE, PARTICIPATION, EVENT by max strength', () => {
    const result = scoreSignals([maxVolatilityAdjustedMove, higherAbnormalVolume]);
    const priceMove = result.groups.find((g) => g.group === PhenomenonGroup.PRICE_MOVE);
    const participation = result.groups.find((g) => g.group === PhenomenonGroup.PARTICIPATION);

    expect(priceMove?.strength).toBe(1);
    expect(participation?.strength).toBeGreaterThan(0);
  });
});
