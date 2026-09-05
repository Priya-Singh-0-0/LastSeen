import type { Pool, PoolClient } from '../db.js';
import { query } from '../db.js';
import { enqueueJob } from '../jobs/enqueue.js';

/**
 * Symbol → instrument resolution (T11 — INV-1, INV-2, INV-3).
 *
 * No outbound HTTP in this file; the provider is called only from the worker.
 * If the symbol is unknown, a PENDING_RESOLUTION instrument is registered
 * and a resolve_instrument job is enqueued for the worker.
 */

export interface ResolvedInstrument {
  instrumentId: bigint;
  /** true if market data is not yet available (warming up). */
  warming: boolean;
}

/**
 * Resolve a symbol to an instrument_id.
 *
 * 1. Try instrument_symbols (case-insensitive).
 * 2. On miss: create instrument (PENDING_RESOLUTION) + symbol row, enqueue resolve_instrument.
 * 3. If no market state exists, enqueue backfill_bars.
 * 4. Returns { instrumentId, warming }.
 */
export async function resolveOrRegisterSymbol(
  client: Pool | PoolClient,
  symbol: string,
): Promise<ResolvedInstrument> {
  const normalizedSymbol = symbol.toUpperCase().trim();

  // ── 1. Look up existing symbol ────────────────────────────────────────────
  const { rows: symRows } = await query<{ instrument_id: string }>(
    client,
    `SELECT instrument_id
     FROM instrument_symbols
     WHERE symbol = $1 AND valid_to IS NULL
     LIMIT 1`,
    [normalizedSymbol],
  );

  let instrumentId: bigint;
  let isNew = false;

  if (symRows.length > 0) {
    instrumentId = BigInt(symRows[0]!.instrument_id);
  } else {
    // ── 2. Register a new instrument ───────────────────────────────────────
    const { rows: instrRows } = await query<{ id: string }>(
      client,
      `INSERT INTO instruments (resolution_status)
       VALUES ('PENDING_RESOLUTION')
       RETURNING id`,
      [],
    );
    // INSERT ... RETURNING always yields exactly one row.
    instrumentId = BigInt(instrRows[0]!.id);

    await query(
      client,
      `INSERT INTO instrument_symbols (instrument_id, symbol)
       VALUES ($1, $2)`,
      [instrumentId, normalizedSymbol],
    );

    // Enqueue resolution job.
    await enqueueJob(client, {
      jobType: 'resolve_instrument',
      payload: { instrumentId: String(instrumentId), symbol: normalizedSymbol },
      idempotencyKey: `resolve:${normalizedSymbol}`,
    });

    isNew = true;
  }

  // ── 3. Enqueue backfill if no market state ────────────────────────────────
  const { rows: msRows } = await query<{ instrument_id: string }>(
    client,
    `SELECT instrument_id FROM instrument_market_state WHERE instrument_id = $1`,
    [instrumentId],
  );

  const hasMarketState = msRows.length > 0;
  if (!hasMarketState) {
    await enqueueJob(client, {
      jobType: 'backfill_bars',
      payload: { instrumentId: String(instrumentId), symbol: normalizedSymbol },
      idempotencyKey: `backfill:${String(instrumentId)}`,
    });
  }

  return { instrumentId, warming: isNew || !hasMarketState };
}
