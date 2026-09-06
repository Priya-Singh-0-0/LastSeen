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
  /**
   * The company name projected from `instrument_catalog`, falling back to the symbol when the
   * catalog has no row. Optional here only so fixtures predating the projection still typecheck.
   */
  readonly name?: string;
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
  /**
   * Null when the symbol is catalog-only (nobody has starred it, so there is no instrument row
   * yet): identity is still servable from `instrument_catalog`, but there is no envelope, no
   * checkpoint, and no `ackToken` until starring registers the instrument.
   */
  readonly instrumentId: string | null;
  readonly symbol: string;
  readonly name?: string;
  readonly exchange: string | null;
  readonly comparisonStatus: ComparisonStatusValue;
  readonly dataFreshness: string;
  readonly current: EnvelopeWire | null;
  /**
   * Shared per-instrument explanation for this view (architecture §F.7). Null
   * until the worker has rendered one — the API asks for it on the first view
   * that needs it, so it appears on a subsequent load, like the price does while
   * an instrument is warming.
   */
  readonly brief: string | null;
  /** Which anonymised elapsed-time bucket `brief` describes. */
  readonly briefWindow: string;
  readonly unseenChanges: readonly UnseenChangeWire[];
  readonly ackToken: string | null;
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

export interface SearchResultWire {
  readonly symbol: string;
  readonly name: string;
  readonly exchange: string | null;
}

/** One daily bar. Every numeric is a decimal string on the wire — never a JS number. */
export interface BarWire {
  readonly sessionDate: string;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly volume: string;
}

/**
 * Window summary computed by the API (`GET /instruments/:id/bars`). The chart renders these
 * verbatim; it never derives a high, low, or change of its own.
 */
export interface BarRangeWire {
  readonly sessions: number;
  readonly from: string;
  readonly to: string;
  readonly high: string;
  readonly low: string;
  readonly absoluteChange: string;
  readonly percentageChange: string | null;
}

export interface BarsResponse {
  readonly instrumentId: string;
  readonly bars: readonly BarWire[];
  readonly range: BarRangeWire | null;
}
