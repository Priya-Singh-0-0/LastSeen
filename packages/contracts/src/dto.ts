import type { Decimal } from './decimal.js';
import type { UtcTimestamp, SessionDate } from './time.js';
import type { MarketStatus, ValueKind, DataFreshness, SignalType } from './enums.js';

/**
 * A market value with its full semantic envelope (architecture §I).
 * Three orthogonal dimensions: market_status, value_kind, data_freshness.
 * All financial values are Decimal; timestamps are UtcTimestamp.
 * Values cross the HTTP wire as strings (toWireString).
 */
export interface ValueEnvelope {
  readonly value: Decimal;
  readonly currency: string;
  readonly marketTimestamp: UtcTimestamp;
  readonly ingestedAt: UtcTimestamp;
  readonly source: string;
  readonly marketStatus: MarketStatus;
  readonly valueKind: ValueKind;
  readonly dataFreshness: DataFreshness;
  readonly precisionHint: number; // decimal places for display
}

/**
 * Provider-neutral market observation — the output of ProviderAdapter.fetch().
 * Alpaca-shaped types must not exist outside worker/src/provider/alpaca/ (INV-13).
 */
export interface Observation {
  readonly instrumentId: string;
  readonly symbol: string;
  readonly price: Decimal;
  readonly currency: string;
  readonly marketTimestamp: UtcTimestamp;
  readonly ingestedAt: UtcTimestamp;
  readonly source: string;
  readonly marketStatus: MarketStatus;
  readonly valueKind: ValueKind;
  readonly dataFreshness: DataFreshness;
  readonly volume?: Decimal;
  readonly open?: Decimal;
  readonly high?: Decimal;
  readonly low?: Decimal;
  readonly prevClose?: Decimal;
}

/**
 * Structured evidence attached to a signal.
 * All numbers in the evidence record are stored as strings (INV-9).
 */
export interface SignalEvidence {
  readonly signalType: SignalType;
  readonly detectorVersion: number;
  readonly dedupeKey: string;
  readonly marketTimestamp: UtcTimestamp;
  readonly sessionDate: SessionDate;
  /** All numeric values are strings; non-numeric values are string | boolean. */
  readonly evidence: Record<string, string | boolean>;
}

/**
 * Daily OHLCV bar for a single instrument.
 */
export interface DailyBar {
  readonly instrumentId: string;
  readonly sessionDate: SessionDate;
  readonly open: Decimal;
  readonly high: Decimal;
  readonly low: Decimal;
  readonly close: Decimal;
  readonly volume: Decimal;
}

/**
 * Provider-neutral market event (e.g. earnings release). Mirrors `market_events`.
 */
export interface MarketEvent {
  readonly instrumentId: string;
  readonly eventType: string;
  readonly eventTimestamp: UtcTimestamp;
  readonly fiscalPeriod?: string;
  readonly providerEventId?: string;
  readonly source: string;
}

/**
 * Provider-neutral corporate action (e.g. split). Mirrors `corporate_actions`.
 */
export interface CorporateAction {
  readonly instrumentId: string;
  readonly actionType: string;
  readonly effectiveDate: SessionDate;
  readonly adjustmentFactor?: Decimal;
  readonly isSupported: boolean;
  readonly versionSeq: number;
  readonly source: string;
}
