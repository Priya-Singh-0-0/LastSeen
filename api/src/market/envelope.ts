import { parseDecimal, toWireString, fromDate } from '@stockwatch/contracts';
import type { ValueEnvelope } from '@stockwatch/contracts';


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
export function assembleEnvelope(row: MarketStateRow): ValueEnvelope {
  return {
    value: parseDecimal(row.price),
    currency: row.currency,
    marketTimestamp: fromDate(row.market_timestamp),
    ingestedAt: fromDate(row.ingested_at),
    source: row.source,
    marketStatus: row.market_status as ValueEnvelope['marketStatus'],
    valueKind: row.value_kind as ValueEnvelope['valueKind'],
    dataFreshness: row.data_freshness as ValueEnvelope['dataFreshness'],
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
