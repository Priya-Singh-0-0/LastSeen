import type { Observation } from '@stockwatch/contracts';
import type { PoolClient } from '../db.js';
import type { ProviderAdapter } from '../provider/index.js';
import { upsertDailyBars } from '../persist/bars.js';
import { upsertMarketState } from '../persist/marketState.js';
import { normalizeObservation } from '../normalize/index.js';
import { runInstrumentPipeline } from '../pipeline.js';
import { loadRecentBars } from '../persist/bars.js';
import { briefExists, insertBrief } from '../persist/briefs.js';
import { buildBriefFacts, type BriefWindow } from '../explanation/factBundle.js';
import { renderBrief, BRIEF_RENDERER_VERSION } from '../explanation/modelRenderer.js';
import type { GeminiClient } from '../explanation/gemini.js';

/**
 * Job handler type (T13).
 * Each handler receives the job payload and a live PoolClient inside a transaction.
 * Throw to signal failure; the queue will retry per the backoff policy.
 */
export type JobHandler = (
  payload: Record<string, unknown>,
  client: PoolClient,
) => Promise<void>;

/**
 * Build the handler registry.
 * Handlers are added here as subsequent tasks implement them (T15+).
 * Unknown job types are failed immediately by queue.ts.
 */
export function buildHandlers(
  provider?: ProviderAdapter,
  gemini: GeminiClient | null = null,
): Map<string, JobHandler> {
  const handlers = new Map<string, JobHandler>();

  // resolve_instrument — placeholder until T15/T37 (AlpacaAdapter).
  handlers.set('resolve_instrument', async (payload) => {
    // In v1 the actual provider call happens in the ingestion loop, not here.
    // This handler is a no-op until the AlpacaAdapter is wired in (T37).
    const { instrumentId, symbol } = payload as { instrumentId: string; symbol: string };
    console.log(JSON.stringify({ event: 'resolve_instrument_noop', instrumentId, symbol }));
  });

  // backfill_bars — implemented in T17
  handlers.set('backfill_bars', async (payload, client) => {
    const { instrumentId, symbol } = payload as { instrumentId: string; symbol: string };
    if (!provider) {
      console.log(JSON.stringify({ event: 'backfill_bars_skipped', instrumentId, symbol }));
      return;
    }

    // Fetch roughly 2 years of data
    const toDate = new Date().toISOString().slice(0, 10);
    const fromDate = new Date(Date.now() - 600 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const bars = await provider.fetchDailyBars(symbol, fromDate, toDate);
    const fixedBars = bars.map(b => ({ ...b, instrumentId }));

    await upsertDailyBars(client, fixedBars, 'adapter');
    console.log(JSON.stringify({ event: 'backfill_bars_done', instrumentId, count: fixedBars.length }));
  });

  // ingest_instrument — on-demand ingestion for a symbol a user just viewed or starred.
  //
  // This is what removes the "warming up" wait: rather than the instrument sitting untracked
  // until the next snapshot tick (up to POLL_INTERVAL_MS away), the API enqueues this job and
  // the runner picks it up within JOB_POLL_INTERVAL_MS. It fetches one snapshot, persists it
  // through the same normalize + monotonic-upsert path the scheduler uses, then runs the
  // signal pipeline so the instrument has real content and not just a price.
  handlers.set('ingest_instrument', async (payload, client) => {
    const { instrumentId, symbol } = payload as { instrumentId: string; symbol: string };
    if (!provider) {
      console.log(JSON.stringify({ event: 'ingest_instrument_skipped', instrumentId, symbol }));
      return;
    }

    const observations = await provider.fetchSnapshots([symbol]);
    const raw = observations.find((o) => o.symbol === symbol);
    if (!raw) {
      console.log(JSON.stringify({ event: 'ingest_instrument_no_data', instrumentId, symbol }));
      return;
    }

    const obs: Observation = { ...raw, instrumentId };
    const id = BigInt(instrumentId);

    const result = await normalizeObservation(client, id, obs);
    if (!result.accepted) {
      // A rejected observation is not a job failure — the validator did its job and prior
      // state is retained. Throwing here would retry a payload that will fail identically.
      console.log(JSON.stringify({ event: 'ingest_instrument_rejected', instrumentId, symbol }));
      return;
    }

    const { written } = await upsertMarketState(client, id, obs);
    if (!written) {
      // Older than what we already hold — the monotonic guard refused it (INV-4). Nothing
      // downstream to do.
      return;
    }

    await client.query(
      `UPDATE instrument_tracking SET last_ingested_at = NOW(), updated_at = NOW()
       WHERE instrument_id = $1`,
      [instrumentId],
    );

    const pipeline = await runInstrumentPipeline(client, instrumentId, obs);
    console.log(JSON.stringify({
      event: 'ingest_instrument_done',
      instrumentId,
      symbol,
      signalsDetected: pipeline.signalsDetected,
      recordsPublished: pipeline.recordsPublished,
    }));
  });

  // render_brief — generate the shared explanation for one (instrument, window)
  // bucket and cache it. Enqueued by the API when a view needs a brief that is
  // not in `instrument_briefs` yet; the API serves the deterministic template on
  // that first request and picks up the stored text afterwards, so this job is
  // never on a user's critical path.
  //
  // Nothing in the payload identifies a user: `window` is an anonymised bucket
  // the API rounds a checkpoint age down to, which is what keeps generation at
  // instruments × buckets rather than users × instruments (CLAUDE.md).
  handlers.set('render_brief', async (payload, client) => {
    const { instrumentId, symbol, window } = payload as {
      instrumentId: string;
      symbol: string;
      window: BriefWindow;
    };

    // Enough history for the longest window (21 sessions + the current bar) with
    // headroom for the 20-session range.
    const bars = await loadRecentBars(client, instrumentId, 40);

    const { rows: catalog } = await client.query<{ name: string; exchange: string | null }>(
      `SELECT name, exchange FROM instrument_catalog WHERE symbol = $1`,
      [symbol],
    );

    const facts = buildBriefFacts({
      window,
      symbol,
      companyName: catalog[0]?.name ?? null,
      exchange: catalog[0]?.exchange ?? null,
      bars,
    });

    if (!facts) {
      // Not enough history to compare anything. Rendering a brief anyway would
      // mean inventing the baseline it is comparing against.
      console.log(JSON.stringify({ event: 'render_brief_insufficient_history', instrumentId, symbol, window }));
      return;
    }

    if (await briefExists(client, instrumentId, window, facts.sessionDate, BRIEF_RENDERER_VERSION)) {
      return;
    }

    const rendered = await renderBrief(facts, gemini);

    await insertBrief(client, {
      instrumentId,
      rendererVersion: BRIEF_RENDERER_VERSION,
      sessionDate: facts.sessionDate,
      window,
      text: rendered.text,
      origin: rendered.origin,
      factBundleHash: rendered.factBundleHash,
    });

    console.log(JSON.stringify({
      event: 'render_brief_done',
      instrumentId,
      symbol,
      window,
      origin: rendered.origin,
      // Present only on the template path; the reason a model answer was refused
      // is the single most useful thing to have in the log when tuning a prompt.
      fallbackReason: rendered.fallbackReason,
    }));
  });

  return handlers;
}
