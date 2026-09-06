import { D, Decimal, type UtcTimestamp, type SessionDate, type DataFreshness, countSessions } from '@stockwatch/contracts';
import type { AdjustmentResult } from './adjustment.js';

/**
 * DiffEngine — since-last-check (T27, architecture §F.5 — INV-9, INV-11, INV-12).
 *
 * A pure function: every input is already fetched by the caller (T26's `factorBetween`
 * result, the current market state, the bounded unseen-changes list, the holiday set).
 * This lets a single caller reuse it per watchlist item (T30/T31) without the function
 * itself issuing per-instrument queries.
 */
export type ComparisonStatus = 'OK' | 'SUPPRESSED_CORPORATE_ACTION' | 'AWAITING_BASELINE' | 'INSUFFICIENT_HISTORY';

export interface DiffCheckpoint {
  /** null when no baseline has been established yet (AWAITING_BASELINE). */
  readonly baselinePrice: Decimal | null;
  readonly baselineMarketTimestamp: UtcTimestamp | null;
}

export interface DiffCurrentState {
  readonly price: Decimal;
  readonly marketTimestamp: UtcTimestamp;
  readonly dataFreshness: DataFreshness;
  /** null when bars_available < 20 (FeatureExtractor's INSUFFICIENT_HISTORY gate, T19). */
  readonly sigma20: Decimal | null;
}

export interface DiffInput<TChange> {
  readonly checkpoint: DiffCheckpoint;
  readonly current: DiffCurrentState;
  readonly adjustment: AdjustmentResult;
  /** Already bounded/filtered by the caller's query (published_seq > seen_through). */
  readonly unseenChanges: readonly TChange[];
  readonly holidays: Set<SessionDate> | SessionDate[];
}

export interface DiffResult<TChange> {
  readonly comparisonStatus: ComparisonStatus;
  readonly dataFreshness: DataFreshness;
  readonly unseenChanges: readonly TChange[];
  readonly adjustedBaseline?: Decimal;
  readonly absoluteChange?: Decimal;
  readonly percentageChange?: Decimal;
  readonly elapsedMs?: number;
  readonly sessionsElapsed?: number;
  readonly volatilityMultiple?: Decimal;
  /** One label per supported SPLIT action in the adjustment range, e.g. "adjusted for 4-for-1 split". */
  readonly adjustmentLabels?: readonly string[];
}

export function computeSinceLastCheck<TChange>(input: DiffInput<TChange>): DiffResult<TChange> {
  const { checkpoint, current, adjustment, unseenChanges, holidays } = input;

  if (checkpoint.baselinePrice === null || checkpoint.baselineMarketTimestamp === null) {
    return { comparisonStatus: 'AWAITING_BASELINE', dataFreshness: current.dataFreshness, unseenChanges };
  }

  if (adjustment.hasUnsupportedAction) {
    return { comparisonStatus: 'SUPPRESSED_CORPORATE_ACTION', dataFreshness: current.dataFreshness, unseenChanges };
  }

  const adjustedBaseline = D.mul(checkpoint.baselinePrice, adjustment.factor);
  const absoluteChange = D.sub(current.price, adjustedBaseline);
  // `changeRatio` is the raw fraction; `percentageChange` is that fraction expressed as a
  // percentage, which is what the field is named and what every consumer treats it as (the
  // personal-explanation template phrases it as a move, the web UI suffixes it with "%").
  // Volatility below stays on the ratio scale, because sigma20 is a ratio-scale volatility.
  const changeRatio = D.div(absoluteChange, adjustedBaseline);
  // Quantised to 4dp (0.0001% resolution — far finer than any market feed). The extra ~26
  // digits Decimal division emits are an artefact of the division, not precision any source
  // supplied, and they leak straight into the rendered explanation string.
  const percentageChange = D.mul(changeRatio, new Decimal(100)).toDecimalPlaces(4);
  const elapsedMs = current.marketTimestamp - checkpoint.baselineMarketTimestamp;
  const sessionsElapsed = countSessions(checkpoint.baselineMarketTimestamp, current.marketTimestamp, holidays);

  // Zero-variance / zero-elapsed-sessions guard (mirrors the worker's detector guard,
  // worker/src/signals/detectors.ts): suppress rather than treat as an infinite multiple.
  let volatilityMultiple: Decimal | undefined;
  if (current.sigma20 !== null && !current.sigma20.isZero() && sessionsElapsed > 0) {
    volatilityMultiple = D.div(D.abs(changeRatio), D.mul(current.sigma20, D.sqrt(new Decimal(sessionsElapsed))));
  }

  const comparisonStatus: ComparisonStatus = current.sigma20 === null ? 'INSUFFICIENT_HISTORY' : 'OK';
  const adjustmentLabels = adjustment.splitLabels;

  return {
    comparisonStatus,
    dataFreshness: current.dataFreshness,
    unseenChanges,
    adjustedBaseline,
    absoluteChange,
    percentageChange,
    elapsedMs,
    sessionsElapsed,
    ...(volatilityMultiple !== undefined ? { volatilityMultiple } : {}),
    ...(adjustmentLabels.length > 0 ? { adjustmentLabels } : {}),
  };
}
