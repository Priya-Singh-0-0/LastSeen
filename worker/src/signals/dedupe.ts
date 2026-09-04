import { SignalType } from '@stockwatch/contracts';
import type { SessionDate, UtcTimestamp } from '@stockwatch/contracts';

/**
 * Deterministic dedupe keys per signal class (architecture §G).
 * Uniqueness is enforced on (instrument_id, detector_version, dedupe_key);
 * detector_version is not part of the key itself.
 */

export interface PriceSignalDedupeInput {
  readonly signalType:
    | SignalType.VOLATILITY_ADJUSTED_MOVE
    | SignalType.LARGE_ABSOLUTE_MOVE
    | SignalType.SIGNIFICANT_GAP
    | SignalType.RANGE_BREAKOUT;
  readonly sessionDate: SessionDate;
}

export function priceSignalDedupeKey(input: PriceSignalDedupeInput): string {
  return `${input.signalType}:${input.sessionDate}`;
}

export interface AbnormalVolumeDedupeInput {
  readonly signalType: SignalType.ABNORMAL_VOLUME;
  readonly sessionDate: SessionDate;
}

export function abnormalVolumeDedupeKey(input: AbnormalVolumeDedupeInput): string {
  return `${input.signalType}:${input.sessionDate}`;
}

export interface VolumeAccelerationDedupeInput {
  readonly signalType: SignalType.VOLUME_ACCELERATION;
  readonly sessionDate: SessionDate;
  readonly windowSessions: number;
}

export function volumeAccelerationDedupeKey(input: VolumeAccelerationDedupeInput): string {
  return `${input.signalType}:${input.sessionDate}:${input.windowSessions}`;
}

export interface EarningsDedupeInput {
  readonly signalType: SignalType.EARNINGS_RELEASED;
  readonly providerEventId?: string;
  readonly eventTimestamp?: UtcTimestamp;
  readonly fiscalPeriod?: string;
}

export function earningsDedupeKey(input: EarningsDedupeInput): string {
  if (input.providerEventId) {
    return `${input.signalType}:${input.providerEventId}`;
  }
  if (input.eventTimestamp === undefined || input.fiscalPeriod === undefined) {
    throw new Error(
      'earningsDedupeKey: requires providerEventId, or eventTimestamp + fiscalPeriod as a fallback natural key',
    );
  }
  return `${input.signalType}:${input.eventTimestamp}:${input.fiscalPeriod}`;
}

export interface CorporateActionDedupeInput {
  readonly signalType: SignalType.CORPORATE_ACTION_APPLIED;
  readonly actionType: string;
  readonly effectiveDate: SessionDate;
  readonly factor: string;
}

export function corporateActionDedupeKey(input: CorporateActionDedupeInput): string {
  return `${input.signalType}:${input.actionType}:${input.effectiveDate}:${input.factor}`;
}
