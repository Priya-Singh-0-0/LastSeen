import type { Pool, PoolClient } from '../db.js';
import { query } from '../db.js';
import { enqueueJob } from '../jobs/enqueue.js';

/**
 * Symbol → instrument resolution (T11 — INV-1, INV-2, INV-3).
 *
 * No outbound HTTP in this file; the provider is called only from the worker.
 * If the symbol is unknown, a PENDING_RESOLUTION instrument is registered
 * and a resolve_instrument job is enqueued for the worker.
 *
 * Called from two places: `POST /watchlists/:id/items` (starring) and
 * `GET /instruments/by-symbol/:symbol` (viewing, T-decouple) — registration itself does not
 * distinguish why the instrument is being requested. Callers are responsible for what
 * `instrument_tracking` row follows: watchlist mutation goes through
 * `watchlists/tracking.ts#onItemAdded` (STARRED demand); a bare view goes through
 * `watchlists/tracking.ts#registerViewDemand` (VIEWED demand, low priority).
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
 * 3. If no market state exists, enqueue backfill_bars (history) and ingest_instrument (price).
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

  // ── 3a. Enqueue backfill if no *provider* history ─────────────────────────
  // Keyed off the bars themselves, not off market state. Demo-seeded instruments ship with both
  // seeded bars and seeded market state, so a market-state check concluded "already backfilled"
  // and they kept their synthetic history forever — the chart showed a sine wave while the price
  // beside it was real. `upsertDailyBars` overwrites on (instrument_id, session_date), so a
  // backfill cleanly replaces seeded rows with provider ones.
  const { rows: barRows } = await query<{ one: number }>(
    client,
    `SELECT 1 AS one FROM instrument_bars
      WHERE instrument_id = $1 AND source <> 'seeded' LIMIT 1`,
    [instrumentId],
  );
  if (barRows.length === 0) {
    await enqueueJob(client, {
      jobType: 'backfill_bars',
      payload: { instrumentId: String(instrumentId), symbol: normalizedSymbol },
      idempotencyKey: `backfill:${String(instrumentId)}`,
    });
  }

  if (!hasMarketState) {
    // ── 4. Enqueue an immediate snapshot ────────────────────────────────────
    // This is what actually ends the "warming up" wait. `backfill_bars` only fills
    // `instrument_bars` (history, for the chart); the current price lives in
    // `instrument_market_state`, which only `ingest_instrument` writes. Without this the
    // envelope stayed null until the next scheduler tick — POLL_INTERVAL_MS away — which is
    // exactly the wait the job queue exists to remove. The worker's runner drains within
    // JOB_POLL_INTERVAL_MS (default 2s).
    //
    // The key is bucketed to the minute rather than fixed per instrument: an ingest is a
    // repeatable operation, so a permanently-fixed key would let one failed attempt block
    // every future view of that symbol forever, while an unkeyed enqueue would queue one job
    // per page load. Per-minute bucketing collapses a burst of views into one job and still
    // self-heals on the next minute.
    await enqueueJob(client, {
      jobType: 'ingest_instrument',
      payload: { instrumentId: String(instrumentId), symbol: normalizedSymbol },
      idempotencyKey: `ingest:${String(instrumentId)}:${Math.floor(Date.now() / 60_000)}`,
    });
  }

  return { instrumentId, warming: isNew || !hasMarketState };
}
