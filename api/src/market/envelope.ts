import { parseDecimal, toWireString, fromDate, nowUtc, MarketStatus, ValueKind, DataFreshness } from '@stockwatch/contracts';
import type { ValueEnvelope, UtcTimestamp } from '@stockwatch/contracts';

/**
 * Staleness threshold (T36 — INV-11), a judgment call not an architecture-quoted constant:
 * how long an `OPEN` market's `ingestedAt` may trail the current read time before the API
 * itself relabels the envelope `STALE`/`LAST_KNOWN` — the worker only writes on ingestion and
 * has no way to notice time passing while a provider stays silent (architecture §M: "market
 * state untouched"), so this decay has to be computed at read time instead.
 */
const STALE_AFTER_MS = 20 * 60 * 1000;

/**
 * Decays a stored envelope's freshness/value-kind at read time (architecture §I: "Provider
 * silent past threshold, market open" → `LAST_KNOWN` / `STALE`). Only an `OPEN` market can be
 * downgraded this way — a `CLOSED` session holding its close, or a `HALTED` last trade, is
 * legitimately `FRESH` no matter how much real time has elapsed.
 */
function decayFreshness(
  marketStatus: ValueEnvelope['marketStatus'],
  valueKind: ValueEnvelope['valueKind'],
  dataFreshness: ValueEnvelope['dataFreshness'],
  ingestedAt: UtcTimestamp,
  now: UtcTimestamp,
): { valueKind: ValueEnvelope['valueKind']; dataFreshness: ValueEnvelope['dataFreshness'] } {
  if (marketStatus !== MarketStatus.OPEN) return { valueKind, dataFreshness };
  if (now - ingestedAt >= STALE_AFTER_MS) {
    return { valueKind: ValueKind.LAST_KNOWN, dataFreshness: DataFreshness.STALE };
  }
  return { valueKind, dataFreshness };
}


/**
 * MarketStateRow — the shape returned by the market-state query.
 * All NUMERIC columns come back as strings (pg type parser, INV-9).
 */
export interface MarketStateRow {
  price: string;
  currency: string;
  market_timestamp: Date;
  ingested_at: Date;
  source: string;
  market_status: string;
  value_kind: string;
  data_freshness: string;
  precision_hint: number;
}

/**
 * Assemble a ValueEnvelope from a market-state row (T16 — INV-9, INV-11).
 *
 * All financial values are Decimal internally; crossed to the wire as strings.
 * This is the ONLY place that constructs a ValueEnvelope from DB data.
 */
export function assembleEnvelope(row: MarketStateRow, now: UtcTimestamp = nowUtc()): ValueEnvelope {
  const ingestedAt = fromDate(row.ingested_at);
  const marketStatus = row.market_status as ValueEnvelope['marketStatus'];
  const decayed = decayFreshness(
    marketStatus,
    row.value_kind as ValueEnvelope['valueKind'],
    row.data_freshness as ValueEnvelope['dataFreshness'],
    ingestedAt,
    now,
  );
  return {
    value: parseDecimal(row.price),
    currency: row.currency,
    marketTimestamp: fromDate(row.market_timestamp),
    ingestedAt,
    source: row.source,
    marketStatus,
    valueKind: decayed.valueKind,
    dataFreshness: decayed.dataFreshness,
    precisionHint: row.precision_hint,
  };
}

/**
 * Serialize a ValueEnvelope to a wire-safe plain object.
 * All Decimal fields become strings; timestamps become ISO 8601 strings.
 * INV-9: no bare JS number for any financial field.
 */
export function envelopeToWire(env: ValueEnvelope): Record<string, unknown> {
  return {
    value: toWireString(env.value),
    currency: env.currency,
    marketTimestamp: new Date(env.marketTimestamp).toISOString(),
    ingestedAt: new Date(env.ingestedAt).toISOString(),
    source: env.source,
    marketStatus: env.marketStatus,
    valueKind: env.valueKind,
    dataFreshness: env.dataFreshness,
    precisionHint: env.precisionHint,
  };
}
