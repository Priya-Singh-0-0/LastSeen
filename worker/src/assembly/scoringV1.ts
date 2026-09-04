import { SignalType, AttentionBand, PhenomenonGroup, type SignalEvidence } from '@stockwatch/contracts';

/**
 * Scoring v1 (architecture §G "Attention score"). Signal → strength via a saturating
 * ramp, grouped by phenomenon (max within group) to avoid quadruple-counting correlated
 * price signals, then combined with noisy-OR.
 *
 * The group weights and per-signal ramp constants below are hand-set calibration
 * assumptions chosen to make the ordering feel sensible — they are NOT financial truth,
 * were never validated against outcomes, and must never be presented to a user as a
 * probability or prediction.
 */
export const SCORING_VERSION = 1;

const GROUP_WEIGHTS: Record<PhenomenonGroup, number> = {
  [PhenomenonGroup.PRICE_MOVE]: 0.7,
  [PhenomenonGroup.PARTICIPATION]: 0.45,
  [PhenomenonGroup.EVENT]: 0.6,
};

const SIGNAL_GROUP: Record<SignalType, PhenomenonGroup> = {
  [SignalType.VOLATILITY_ADJUSTED_MOVE]: PhenomenonGroup.PRICE_MOVE,
  [SignalType.LARGE_ABSOLUTE_MOVE]: PhenomenonGroup.PRICE_MOVE,
  [SignalType.SIGNIFICANT_GAP]: PhenomenonGroup.PRICE_MOVE,
  [SignalType.RANGE_BREAKOUT]: PhenomenonGroup.PRICE_MOVE,
  [SignalType.ABNORMAL_VOLUME]: PhenomenonGroup.PARTICIPATION,
  [SignalType.VOLUME_ACCELERATION]: PhenomenonGroup.PARTICIPATION,
  [SignalType.EARNINGS_RELEASED]: PhenomenonGroup.EVENT,
  [SignalType.CORPORATE_ACTION_APPLIED]: PhenomenonGroup.EVENT,
};

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function ramp(value: number, threshold: number, headroom: number): number {
  return clamp01((value - threshold) / headroom);
}

/** Strength in [0,1] via a saturating ramp on the signal's own headroom above its emission threshold. */
function signalStrength(signal: SignalEvidence): number {
  switch (signal.signalType) {
    case SignalType.VOLATILITY_ADJUSTED_MOVE:
      return ramp(Number(signal.evidence.multiple), 2.0, 2.0);
    case SignalType.LARGE_ABSOLUTE_MOVE:
      return ramp(Math.abs(Number(signal.evidence.pct_change)), 0.05, 0.05);
    case SignalType.SIGNIFICANT_GAP:
      return ramp(Math.abs(Number(signal.evidence.gap_pct)), 0.03, 0.03);
    case SignalType.RANGE_BREAKOUT: {
      const high20 = Number(signal.evidence.high20);
      const low20 = Number(signal.evidence.low20);
      const close = Number(signal.evidence.close);
      const range = high20 - low20;
      if (range <= 0) return 1;
      const extension = signal.evidence.direction === 'above' ? close - high20 : low20 - close;
      return ramp(extension, 0, 0.1 * range);
    }
    case SignalType.ABNORMAL_VOLUME:
      return ramp(Number(signal.evidence.ratio), 2.5, 3.5);
    case SignalType.VOLUME_ACCELERATION:
      return ramp(Number(signal.evidence.ratio), 1.8, 1.8);
    case SignalType.EARNINGS_RELEASED:
      return 1;
    case SignalType.CORPORATE_ACTION_APPLIED:
      // Unsupported corporate actions are suppressed rather than guessed at (architecture §G).
      return signal.evidence.is_supported === true ? 1 : 0;
  }
}

function bandFor(score: number): AttentionBand {
  if (score >= 0.75) return AttentionBand.URGENT;
  if (score >= 0.5) return AttentionBand.NOTABLE;
  if (score >= 0.25) return AttentionBand.MINOR;
  return AttentionBand.QUIET;
}

export interface GroupScore {
  readonly group: PhenomenonGroup;
  readonly weight: number;
  readonly strength: number;
  readonly memberSignals: readonly SignalEvidence[];
}

export interface AttentionScoreResult {
  readonly score: number;
  readonly band: AttentionBand;
  readonly groups: readonly GroupScore[];
}

const ALL_GROUPS = [PhenomenonGroup.PRICE_MOVE, PhenomenonGroup.PARTICIPATION, PhenomenonGroup.EVENT] as const;

export function scoreSignals(signals: readonly SignalEvidence[]): AttentionScoreResult {
  const byGroup = new Map<PhenomenonGroup, SignalEvidence[]>();
  for (const group of ALL_GROUPS) byGroup.set(group, []);
  for (const signal of signals) byGroup.get(SIGNAL_GROUP[signal.signalType])!.push(signal);

  const groups: GroupScore[] = ALL_GROUPS.map((group) => {
    const memberSignals = byGroup.get(group)!;
    const strength = memberSignals.reduce((max, s) => Math.max(max, signalStrength(s)), 0);
    return { group, weight: GROUP_WEIGHTS[group], strength, memberSignals };
  });

  const score = 1 - groups.reduce((product, g) => product * (1 - g.weight * g.strength), 1);

  return { score, band: bandFor(score), groups };
}
