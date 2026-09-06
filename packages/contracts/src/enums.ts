/**
 * Canonical domain enums — mirror the Postgres enum types in db/migrations/0001_init.sql.
 *
 * IMPORTANT: Do not add or rename values here without a corresponding migration.
 * The consistency test (packages/contracts/test/enums.consistency.test.ts) enforces this in CI.
 */

export enum MarketStatus {
  PRE_OPEN  = 'PRE_OPEN',
  OPEN      = 'OPEN',
  POST      = 'POST',
  CLOSED    = 'CLOSED',
  HALTED    = 'HALTED',
  SUSPENDED = 'SUSPENDED',
  DELISTED  = 'DELISTED',
}

export enum ValueKind {
  LIVE         = 'LIVE',
  DELAYED_FEED = 'DELAYED_FEED',
  SESSION_CLOSE = 'SESSION_CLOSE',
  LAST_TRADE   = 'LAST_TRADE',
  LAST_KNOWN   = 'LAST_KNOWN',
  INDICATIVE   = 'INDICATIVE',
}

export enum DataFreshness {
  FRESH       = 'FRESH',
  DELAYED     = 'DELAYED',
  STALE       = 'STALE',
  UNAVAILABLE = 'UNAVAILABLE',
  CONFLICTED  = 'CONFLICTED', // seam — no producer in v1; exists so the enum need not widen
}

export enum SignalType {
  VOLATILITY_ADJUSTED_MOVE  = 'VOLATILITY_ADJUSTED_MOVE',
  LARGE_ABSOLUTE_MOVE       = 'LARGE_ABSOLUTE_MOVE',
  SIGNIFICANT_GAP           = 'SIGNIFICANT_GAP',
  RANGE_BREAKOUT            = 'RANGE_BREAKOUT',
  ABNORMAL_VOLUME           = 'ABNORMAL_VOLUME',
  VOLUME_ACCELERATION       = 'VOLUME_ACCELERATION',
  EARNINGS_RELEASED         = 'EARNINGS_RELEASED',
  CORPORATE_ACTION_APPLIED  = 'CORPORATE_ACTION_APPLIED',
}

export enum AttentionBand {
  URGENT  = 'URGENT',
  NOTABLE = 'NOTABLE',
  MINOR   = 'MINOR',
  QUIET   = 'QUIET',
}

export enum JobStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  DONE    = 'DONE',
  FAILED  = 'FAILED',
}

export enum TrackingState {
  ACTIVE = 'ACTIVE',
  IDLE   = 'IDLE',
}

export enum ResolutionStatus {
  PENDING_RESOLUTION = 'PENDING_RESOLUTION',
  RESOLVED           = 'RESOLVED',
  UNRESOLVABLE       = 'UNRESOLVABLE',
}

export enum PhenomenonGroup {
  PRICE_MOVE    = 'PRICE_MOVE',
  PARTICIPATION = 'PARTICIPATION',
  EVENT         = 'EVENT',
}

/**
 * Anonymised elapsed-time buckets for shared explanation briefs (migration 0008,
 * architecture §F.7). Shared vocabulary rather than worker-private: the API
 * rounds a checkpoint age down to one of these and reads the matching cached
 * brief, while the worker renders it. Neither process imports the other, so the
 * bucket set lives here.
 *
 * `FIRST_VIEW` is the never-opened surface; the rest are calendar-day lookbacks
 * (D1=1, D2=2, W1=7, M1=30). Days, not trading sessions: the span a brief
 * describes is how long since the user last opened the stock, which is
 * wall-clock time.
 */
export enum BriefWindow {
  FIRST_VIEW = 'FIRST_VIEW',
  D1         = 'D1',
  D2         = 'D2',
  W1         = 'W1',
  M1         = 'M1',
}

export enum ComparisonStatus {
  OK                           = 'OK',
  SUPPRESSED_CORPORATE_ACTION  = 'SUPPRESSED_CORPORATE_ACTION',
  AWAITING_BASELINE            = 'AWAITING_BASELINE',
  INSUFFICIENT_HISTORY         = 'INSUFFICIENT_HISTORY',
}
