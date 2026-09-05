/**
 * Wire-shape types for T32's UI — mirror the JSON actually returned by the API routes
 * (api/src/inbox/routes.ts, api/src/instruments/routes.ts), not packages/contracts' internal
 * Decimal/UtcTimestamp types. Every field here is already a string/number/boolean on the wire;
 * the UI must render these verbatim and never derive a financial value from them (CLAUDE.md).
 */

export type AttentionBandValue = 'URGENT' | 'NOTABLE' | 'MINOR' | 'QUIET';

export type ComparisonStatusValue =
  | 'OK'
  | 'SUPPRESSED_CORPORATE_ACTION'
  | 'AWAITING_BASELINE'
  | 'INSUFFICIENT_HISTORY';

export interface EnvelopeWire {
  readonly value: string;
  readonly currency: string;
  readonly marketTimestamp: string;
  readonly ingestedAt: string;
  readonly source: string;
  readonly marketStatus: string;
  readonly valueKind: string;
  readonly dataFreshness: string;
  readonly precisionHint: number;
}

export interface DiffFields {
  readonly adjustedBaseline?: string;
  readonly absoluteChange?: string;
  readonly percentageChange?: string;
  readonly elapsedMs?: number;
  readonly sessionsElapsed?: number;
  readonly volatilityMultiple?: string;
  readonly adjustmentLabels?: readonly string[];
}

export interface InboxItemWire extends DiffFields {
  readonly instrumentId: string;
  readonly symbol: string;
  readonly exchange: string | null;
  readonly comparisonStatus: ComparisonStatusValue;
  readonly dataFreshness: string;
  readonly current: EnvelopeWire | null;
  readonly unseenCount: number;
  readonly maxUnseenBand: AttentionBandValue | null;
  readonly maxUnseenScore: string | null;
  readonly explanation: string;
}

export interface InboxResponse {
  readonly watchlistId: string;
  readonly items: readonly InboxItemWire[];
}

export interface WatchlistWire {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SignalWire {
  readonly signalType: string;
  readonly detectorVersion: number;
  readonly dedupeKey: string;
  readonly evidence: Record<string, string | boolean>;
  readonly marketTimestamp: string;
}

export interface UnseenChangeWire {
  readonly id: string;
  readonly publishedSeq: string;
  readonly publishedAt: string;
  readonly band: AttentionBandValue | null;
  readonly score: string | null;
  readonly latestAt: string;
  readonly sharedExplanation: string | null;
  readonly signals: readonly SignalWire[];
}

export interface InstrumentDetailResponse extends DiffFields {
  readonly instrumentId: string;
  readonly symbol: string;
  readonly exchange: string | null;
  readonly comparisonStatus: ComparisonStatusValue;
  readonly dataFreshness: string;
  readonly current: EnvelopeWire | null;
  readonly unseenChanges: readonly UnseenChangeWire[];
  readonly ackToken: string;
}

export interface WatchlistItemWire {
  readonly id: string;
  readonly instrumentId: string;
  readonly addedAt: string;
}

export interface AddItemResultWire {
  readonly instrumentId: string;
  readonly state: 'WARMING' | 'READY';
}
