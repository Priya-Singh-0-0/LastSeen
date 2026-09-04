import {
  Decimal,
  toWireString,
  SignalType,
  type Observation,
  type DailyBar,
  type MarketEvent,
  type CorporateAction,
  type SignalEvidence,
  type SessionDate,
} from '@stockwatch/contracts';
import { INSUFFICIENT_HISTORY, type Features } from '../features/index.js';
import {
  priceSignalDedupeKey,
  abnormalVolumeDedupeKey,
  volumeAccelerationDedupeKey,
  earningsDedupeKey,
  corporateActionDedupeKey,
} from './dedupe.js';

/**
 * The eight detectors (architecture §G). One detector_version for all eight —
 * a change to any predicate bumps this and produces new rows rather than
 * silently overwriting history (dedupe keys include detector_version via the
 * uniqueness tuple, not the key itself).
 */
export const DETECTOR_VERSION = 1;

const EARNINGS_EVENT_TYPE = 'EARNINGS';

// v1 constants (architecture §G) — not calibration, these gate emission.
const VOLATILITY_ADJUSTED_MOVE_MULTIPLE = new Decimal('2.0');
const LARGE_ABSOLUTE_MOVE_PCT = new Decimal('0.05');
const SIGNIFICANT_GAP_PCT = new Decimal('0.03');
const SIGNIFICANT_GAP_SIGMA_MULTIPLE = new Decimal('1.5');
const ABNORMAL_VOLUME_RATIO = new Decimal('2.5');
const VOLUME_ACCELERATION_RATIO = new Decimal('1.8');
const VOLUME_ACCELERATION_WINDOW = 3;

export interface DetectorInput {
  readonly instrumentId: string;
  readonly observation: Observation;
  /** Same shape passed to extractFeatures: descending, history[0] is yesterday. */
  readonly history: readonly DailyBar[];
  readonly features: Features | typeof INSUFFICIENT_HISTORY;
  readonly sessionDate: SessionDate;
  /** Market events newly observed this cycle — already scoped by the caller. */
  readonly newMarketEvents: readonly MarketEvent[];
  /** Corporate actions newly observed this cycle — already scoped by the caller. */
  readonly newCorporateActions: readonly CorporateAction[];
}

function evidence(
  signalType: SignalType,
  dedupeKey: string,
  input: DetectorInput,
  fields: Record<string, string | boolean>,
): SignalEvidence {
  return {
    signalType,
    detectorVersion: DETECTOR_VERSION,
    dedupeKey,
    marketTimestamp: input.observation.marketTimestamp,
    sessionDate: input.sessionDate,
    evidence: fields,
  };
}

export function detectVolatilityAdjustedMove(input: DetectorInput): SignalEvidence | undefined {
  if (input.features === INSUFFICIENT_HISTORY) return undefined;
  const { returns_1d, sigma20 } = input.features;
  // A zero-variance denominator makes "multiple of volatility" undefined; suppress rather than guess.
  if (sigma20.isZero()) return undefined;

  const threshold = VOLATILITY_ADJUSTED_MOVE_MULTIPLE.times(sigma20);
  if (returns_1d.abs().lessThan(threshold)) return undefined;

  const multiple = returns_1d.abs().dividedBy(sigma20);
  return evidence(
    SignalType.VOLATILITY_ADJUSTED_MOVE,
    priceSignalDedupeKey({ signalType: SignalType.VOLATILITY_ADJUSTED_MOVE, sessionDate: input.sessionDate }),
    input,
    {
      pct_change: toWireString(returns_1d),
      sigma20: toWireString(sigma20),
      multiple: toWireString(multiple),
      window: '20',
    },
  );
}

export function detectLargeAbsoluteMove(input: DetectorInput): SignalEvidence | undefined {
  if (input.features === INSUFFICIENT_HISTORY) return undefined;
  const { returns_1d } = input.features;
  if (returns_1d.abs().lessThan(LARGE_ABSOLUTE_MOVE_PCT)) return undefined;

  const prevClose = input.observation.prevClose ?? input.history[0]?.close;
  const absChange = prevClose ? input.observation.price.minus(prevClose).abs() : undefined;

  return evidence(
    SignalType.LARGE_ABSOLUTE_MOVE,
    priceSignalDedupeKey({ signalType: SignalType.LARGE_ABSOLUTE_MOVE, sessionDate: input.sessionDate }),
    input,
    {
      pct_change: toWireString(returns_1d),
      ...(absChange ? { abs_change: toWireString(absChange) } : {}),
      ...(prevClose ? { prev_close: toWireString(prevClose) } : {}),
    },
  );
}

export function detectSignificantGap(input: DetectorInput): SignalEvidence | undefined {
  if (input.features === INSUFFICIENT_HISTORY) return undefined;
  const { gap_pct, sigma20 } = input.features;
  const absGap = gap_pct.abs();
  if (absGap.lessThan(SIGNIFICANT_GAP_PCT)) return undefined;
  if (absGap.lessThan(SIGNIFICANT_GAP_SIGMA_MULTIPLE.times(sigma20))) return undefined;

  const prevClose = input.observation.prevClose ?? input.history[0]?.close;
  const open = input.observation.open ?? input.observation.price;

  return evidence(
    SignalType.SIGNIFICANT_GAP,
    priceSignalDedupeKey({ signalType: SignalType.SIGNIFICANT_GAP, sessionDate: input.sessionDate }),
    input,
    {
      gap_pct: toWireString(gap_pct),
      ...(prevClose ? { prev_close: toWireString(prevClose) } : {}),
      open: toWireString(open),
      sigma20: toWireString(sigma20),
    },
  );
}

export function detectRangeBreakout(input: DetectorInput): SignalEvidence | undefined {
  if (input.features === INSUFFICIENT_HISTORY) return undefined;
  const { high20, low20 } = input.features;
  const close = input.observation.price;

  const brokeAbove = close.greaterThan(high20);
  const brokeBelow = close.lessThan(low20);
  if (!brokeAbove && !brokeBelow) return undefined;

  return evidence(
    SignalType.RANGE_BREAKOUT,
    priceSignalDedupeKey({ signalType: SignalType.RANGE_BREAKOUT, sessionDate: input.sessionDate }),
    input,
    {
      close: toWireString(close),
      high20: toWireString(high20),
      low20: toWireString(low20),
      direction: brokeAbove ? 'above' : 'below',
      window: '20',
    },
  );
}

export function detectAbnormalVolume(input: DetectorInput): SignalEvidence | undefined {
  if (input.features === INSUFFICIENT_HISTORY) return undefined;
  const { volume_ratio, volume_median20 } = input.features;
  if (volume_ratio.lessThan(ABNORMAL_VOLUME_RATIO)) return undefined;

  const volume = input.observation.volume ?? new Decimal(0);
  return evidence(
    SignalType.ABNORMAL_VOLUME,
    abnormalVolumeDedupeKey({ signalType: SignalType.ABNORMAL_VOLUME, sessionDate: input.sessionDate }),
    input,
    {
      volume: toWireString(volume),
      volume_median20: toWireString(volume_median20),
      ratio: toWireString(volume_ratio),
    },
  );
}

export function detectVolumeAcceleration(input: DetectorInput): SignalEvidence | undefined {
  if (input.features === INSUFFICIENT_HISTORY) return undefined;
  const { volume_median20 } = input.features;
  const day0 = input.history[0];
  const day1 = input.history[1];
  if (!day0 || !day1) return undefined;

  const currentVolume = input.observation.volume ?? new Decimal(0);
  const mean3 = currentVolume.plus(day0.volume).plus(day1.volume).dividedBy(3);

  const rising = currentVolume.greaterThanOrEqualTo(day0.volume) && day0.volume.greaterThanOrEqualTo(day1.volume);
  if (!rising) return undefined;

  if (volume_median20.isZero()) return undefined;
  const ratio = mean3.dividedBy(volume_median20);
  if (ratio.lessThan(VOLUME_ACCELERATION_RATIO)) return undefined;

  return evidence(
    SignalType.VOLUME_ACCELERATION,
    volumeAccelerationDedupeKey({
      signalType: SignalType.VOLUME_ACCELERATION,
      sessionDate: input.sessionDate,
      windowSessions: VOLUME_ACCELERATION_WINDOW,
    }),
    input,
    {
      mean_3d_volume: toWireString(mean3),
      volume_median20: toWireString(volume_median20),
      ratio: toWireString(ratio),
      rising: true,
    },
  );
}

export function detectEarningsReleased(input: DetectorInput): SignalEvidence[] {
  return input.newMarketEvents
    .filter((e) => e.eventType === EARNINGS_EVENT_TYPE)
    .map((e) =>
      evidence(
        SignalType.EARNINGS_RELEASED,
        earningsDedupeKey({
          signalType: SignalType.EARNINGS_RELEASED,
          ...(e.providerEventId ? { providerEventId: e.providerEventId } : {}),
          eventTimestamp: e.eventTimestamp,
          ...(e.fiscalPeriod ? { fiscalPeriod: e.fiscalPeriod } : {}),
        }),
        input,
        {
          event_timestamp: String(e.eventTimestamp),
          source: e.source,
          ...(e.fiscalPeriod ? { fiscal_period: e.fiscalPeriod } : {}),
        },
      ),
    );
}

export function detectCorporateActionApplied(input: DetectorInput): SignalEvidence[] {
  return input.newCorporateActions.map((a) => {
    const factor = a.adjustmentFactor ? toWireString(a.adjustmentFactor) : 'UNSUPPORTED';
    return evidence(
      SignalType.CORPORATE_ACTION_APPLIED,
      corporateActionDedupeKey({
        signalType: SignalType.CORPORATE_ACTION_APPLIED,
        actionType: a.actionType,
        effectiveDate: a.effectiveDate,
        factor,
      }),
      input,
      {
        action_type: a.actionType,
        effective_date: a.effectiveDate,
        factor,
        is_supported: a.isSupported,
      },
    );
  });
}

/**
 * Evaluates all eight predicates (architecture §G) against one instrument's
 * current cycle. Price/volume predicates emit nothing under INSUFFICIENT_HISTORY;
 * event predicates fire regardless.
 */
export function evaluateDetectors(input: DetectorInput): SignalEvidence[] {
  const results: SignalEvidence[] = [];

  const single = [
    detectVolatilityAdjustedMove(input),
    detectLargeAbsoluteMove(input),
    detectSignificantGap(input),
    detectRangeBreakout(input),
    detectAbnormalVolume(input),
    detectVolumeAcceleration(input),
  ];
  for (const s of single) {
    if (s) results.push(s);
  }

  results.push(...detectEarningsReleased(input));
  results.push(...detectCorporateActionApplied(input));

  return results;
}
