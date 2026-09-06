import type { Observation } from '@stockwatch/contracts';
import type { Pool, PoolClient } from './db.js';
import { query } from './db.js';
import type { ProviderAdapter } from './provider/index.js';
import { normalizeObservation } from './normalize/index.js';
import { upsertMarketState } from './persist/marketState.js';
import { runInstrumentPipeline } from './pipeline.js';

/**
 * Snapshot polling scheduler (defect 1 — INV-1, INV-3, INV-4, INV-5).
 *
 * The poll set is read fresh from `instrument_tracking` on every tick — never cached
 * across ticks — so a newly starred instrument (which the API flips to ACTIVE
 * synchronously on add) is picked up on the very next poll, not on some longer cycle.
 *
 * One batched `fetchSnapshots` call per tick covers every ACTIVE instrument, so this
 * scales with the number of distinct tracked instruments, never with users or
 * watchlists (CLAUDE.md). Persistence goes through the existing normalize + monotonic
 * upsert pipeline, so a slow or overlapping tick can never regress market state — an
 * older observation is rejected by `upsertMarketState`'s WHERE clause regardless of
 * how many times or in what order ticks run. That is what makes polling retry-safe and
 * idempotent without needing the job queue: correctness lives in the upsert, not in the
 * scheduler's own bookkeeping.
 */

export interface ActiveInstrument {
  instrumentId: bigint;
  symbol: string;
}

/**
 * Every currently-followed instrument and its active symbol, read fresh each tick.
 *
 * Excludes UNRESOLVABLE instruments: a symbol the provider has permanently rejected must not
 * re-enter the poll set on every tick, or it poisons the batch fetch forever (see
 * `fetchSnapshotsResilient`).
 */
export async function selectActiveInstruments(pool: Pool | PoolClient): Promise<ActiveInstrument[]> {
  const { rows } = await query<{ instrument_id: string; symbol: string }>(
    pool,
    `SELECT it.instrument_id, isym.symbol
     FROM instrument_tracking it
     JOIN instrument_symbols isym
       ON isym.instrument_id = it.instrument_id AND isym.valid_to IS NULL
     JOIN instruments i
       ON i.id = it.instrument_id
     WHERE it.tracking_state = 'ACTIVE'
       AND i.resolution_status <> 'UNRESOLVABLE'`,
    [],
  );
  return rows.map((r) => ({ instrumentId: BigInt(r.instrument_id), symbol: r.symbol }));
}

/**
 * A provider error that names one bad symbol rather than a transient outage. Alpaca answers a
 * batch containing an unknown symbol with `code=400, message=invalid symbol: XYZ` — and rejects
 * the *whole* batch, so a single junk row (a leftover test fixture, say) silently stops every
 * instrument from ingesting. Distinguishing this from a 5xx matters: a permanent rejection
 * should retire the symbol, a transient one must not.
 */
function isPermanentSymbolRejection(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /code=4\d\d/.test(message) && /invalid symbol/i.test(message);
}

/**
 * Batch fetch that degrades to per-symbol fetches instead of losing the tick.
 *
 * The batch call stays the hot path (one request per tick, scaling with unique instruments per
 * CLAUDE.md). Only when it fails do we pay for individual requests, and only to find out which
 * symbols are actually bad — those get marked UNRESOLVABLE so the next tick is a clean batch
 * again. Good symbols still ingest on the degraded path, which is the whole point: one bad row
 * must cost its own data, not everyone's.
 */
async function fetchSnapshotsResilient(
  pool: Pool,
  adapter: ProviderAdapter,
  active: ActiveInstrument[],
): Promise<Observation[]> {
  try {
    return await adapter.fetchSnapshots(active.map((a) => a.symbol));
  } catch (err) {
    console.error(JSON.stringify({
      event: 'scheduler_batch_fetch_failed',
      symbols: active.length,
      error: (err as Error).message,
    }));
  }

  const observations: Observation[] = [];
  const unresolvable: bigint[] = [];

  for (const { instrumentId, symbol } of active) {
    try {
      observations.push(...(await adapter.fetchSnapshots([symbol])));
    } catch (err) {
      if (isPermanentSymbolRejection(err)) {
        unresolvable.push(instrumentId);
        console.error(JSON.stringify({ event: 'scheduler_symbol_unresolvable', symbol }));
      } else {
        console.error(JSON.stringify({
          event: 'scheduler_symbol_fetch_failed',
          symbol,
          error: (err as Error).message,
        }));
      }
    }
  }

  if (unresolvable.length > 0) {
    // `instruments` is a market-side table the worker owns UPDATE on (0002_roles.sql) — this
    // writes no user, watchlist, or checkpoint row.
    await query(
      pool,
      `UPDATE instruments SET resolution_status = 'UNRESOLVABLE'
        WHERE id = ANY($1::bigint[])`,
      [unresolvable.map(String)],
    );
  }

  return observations;
}

export interface PollResult {
  readonly polled: number;
  readonly written: number;
  readonly rejected: number;
}

/** One poll tick: fetch snapshots for every ACTIVE instrument and persist them. */
export async function pollOnce(pool: Pool, adapter: ProviderAdapter): Promise<PollResult> {
  const active = await selectActiveInstruments(pool);
  if (active.length === 0) {
    return { polled: 0, written: 0, rejected: 0 };
  }

  const instrumentBySymbol = new Map(active.map((a) => [a.symbol, a.instrumentId]));
  const observations = await fetchSnapshotsResilient(pool, adapter, active);

  let written = 0;
  let rejected = 0;
  const ingestedIds: bigint[] = [];

  for (const raw of observations) {
    const instrumentId = instrumentBySymbol.get(raw.symbol);
    if (instrumentId === undefined) continue; // not in this tick's active set — ignore

    const obs: Observation = { ...raw, instrumentId: String(instrumentId) };

    const client = await pool.connect();
    try {
      const result = await normalizeObservation(client, instrumentId, obs);
      if (!result.accepted) {
        rejected += 1;
        continue;
      }

      const { written: didWrite } = await upsertMarketState(client, instrumentId, obs);
      if (didWrite) {
        written += 1;
        ingestedIds.push(instrumentId);

        // Run the signal pipeline only when market state actually moved forward. An
        // observation rejected by the monotonic guard is stale, and re-running detection on
        // stale input would republish nothing but would waste the work.
        try {
          await client.query('BEGIN');
          await runInstrumentPipeline(client, String(instrumentId), obs);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          // A detection failure must not lose the price we just persisted, nor stop the tick
          // for every other instrument. Log and continue.
          console.error(JSON.stringify({
            event: 'pipeline_failed',
            instrumentId: String(instrumentId),
            error: (err as Error).message,
          }));
        }
      }
    } finally {
      client.release();
    }
  }

  if (ingestedIds.length > 0) {
    await query(
      pool,
      `UPDATE instrument_tracking
          SET last_ingested_at = NOW(), updated_at = NOW()
        WHERE instrument_id = ANY($1::bigint[])`,
      [ingestedIds.map(String)],
    );
  }

  return { polled: active.length, written, rejected };
}

export interface SchedulerHandle {
  stop(): void;
}

/**
 * Starts the recurring poll loop. Runs one tick immediately, then every `intervalMs`.
 * A tick that throws is logged and never crashes the process or blocks the next tick —
 * the next scheduled poll is the retry.
 */
export function startScheduler(
  pool: Pool,
  adapter: ProviderAdapter,
  intervalMs: number,
): SchedulerHandle {
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return; // previous tick still in flight — skip rather than overlap
    running = true;
    try {
      const result = await pollOnce(pool, adapter);
      console.log(JSON.stringify({ event: 'scheduler_tick', ...result }));
    } catch (err) {
      console.error(JSON.stringify({ event: 'scheduler_tick_failed', error: (err as Error).message }));
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);

  return {
    stop(): void {
      clearInterval(timer);
    },
  };
}
