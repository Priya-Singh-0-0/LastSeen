import type { FastifyInstance } from 'fastify';
import { requireSession } from '../auth/middleware.js';
import { query } from '../db.js';
import type { Pool } from '../db.js';
import { ensureCheckpoint } from '../checkpoints/repo.js';
import { mint } from '../checkpoints/ackToken.js';
import { factorBetween } from '../diff/adjustment.js';
import { computeSinceLastCheck } from '../diff/engine.js';
import { getMarketState } from '../market/repo.js';
import { assembleEnvelope, envelopeToWire } from '../market/envelope.js';
import { resolveOrRegisterSymbol } from '../watchlists/resolve.js';
import { registerViewDemand } from '../watchlists/tracking.js';
import { briefWindowFor, loadBrief, requestBrief } from '../explanation/brief.js';
import { Decimal, toWireString, toSessionDate, DataFreshness, ComparisonStatus } from '@stockwatch/contracts';
import type { SessionDate, UtcTimestamp } from '@stockwatch/contracts';

/**
 * Instrument detail route (T30, architecture §F.6 — INV-7, INV-15).
 *
 * A provably side-effect-free GET: it computes the diff and mints an ack token, but the only
 * write on this path is `ensureCheckpoint`'s create-if-absent (never mutates an existing row —
 * see T29). Advancing a checkpoint only ever happens via `POST /instruments/:id/acknowledge`
 * (checkpoints/routes.ts).
 *
 * It also enqueues a `render_brief` job when no cached brief exists for the
 * bucket being served. That is an operational write to `jobs`, not user state —
 * the same warm-on-demand enqueue the view-demand path already performs — and it
 * carries no user identity. The CLAUDE.md rule it must not break is "no GET
 * mutates user state", and it does not.
 */

function parseBigInt(val: unknown): bigint | null {
  try { return BigInt(val as string); } catch { return null; }
}

interface InstrumentRow {
  instrumentId: bigint;
  corporateActionVersion: number;
  symbol: string;
  /** The catalog's company name, falling back to the symbol. Never null, never invented. */
  name: string;
  exchange: string | null;
}

async function getInstrument(pool: Pool, instrumentId: bigint): Promise<InstrumentRow | null> {
  const { rows } = await query<{
    corporate_action_version: number;
    symbol: string | null;
    exchange: string | null;
    company_name: string | null;
  }>(
    pool,
    `SELECT i.corporate_action_version, isym.symbol, isym.exchange, ic.name AS company_name
     FROM instruments i
     LEFT JOIN instrument_symbols isym ON isym.instrument_id = i.id AND isym.valid_to IS NULL
     -- Reference data only, joined rather than queried separately (see inbox/routes.ts).
     LEFT JOIN instrument_catalog ic ON ic.symbol = isym.symbol
     WHERE i.id = $1`,
    [instrumentId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    instrumentId,
    corporateActionVersion: row.corporate_action_version,
    symbol: row.symbol ?? String(instrumentId),
    name: row.company_name ?? row.symbol ?? String(instrumentId),
    exchange: row.exchange,
  };
}

/**
 * Resolve a symbol to its live instrument row, if one exists.
 *
 * Unlike {@link getInstrument} this looks the row up by symbol, not by id — the entry point
 * for the by-symbol detail route (T-UI defect 2), which must be servable for every catalog
 * symbol whether or not anyone has starred it yet. A miss here does not mean "not found": it
 * means "identity only, no ingestion yet" and the caller falls back to the catalog.
 */
async function getInstrumentBySymbol(pool: Pool, symbol: string): Promise<InstrumentRow | null> {
  const { rows } = await query<{
    instrument_id: string;
    corporate_action_version: number;
    symbol: string;
    exchange: string | null;
    company_name: string | null;
  }>(
    pool,
    `SELECT i.id AS instrument_id, i.corporate_action_version, isym.symbol, isym.exchange,
            ic.name AS company_name
     FROM instrument_symbols isym
     JOIN instruments i ON i.id = isym.instrument_id
     LEFT JOIN instrument_catalog ic ON ic.symbol = isym.symbol
     WHERE isym.symbol = $1 AND isym.valid_to IS NULL`,
    [symbol],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    instrumentId: BigInt(row.instrument_id),
    corporateActionVersion: row.corporate_action_version,
    symbol: row.symbol,
    name: row.company_name ?? row.symbol,
    exchange: row.exchange,
  };
}

interface CatalogIdentity {
  readonly symbol: string;
  readonly name: string;
  readonly exchange: string | null;
}

/** Identity only, from the ~14k-symbol asset master — no instrument id, no price (T-UI defect 2). */
async function getCatalogIdentity(pool: Pool, symbol: string): Promise<CatalogIdentity | null> {
  const { rows } = await query<{ symbol: string; name: string; exchange: string | null }>(
    pool,
    `SELECT symbol, name, exchange FROM instrument_catalog WHERE symbol = $1`,
    [symbol],
  );
  return rows[0] ?? null;
}

/** True if the user has this instrument on at least one of their watchlists (INV-15). */
async function userTracksInstrument(pool: Pool, userId: bigint, instrumentId: bigint): Promise<boolean> {
  const { rows } = await query(
    pool,
    `SELECT 1 FROM watchlist_items wi
     JOIN watchlists w ON w.id = wi.watchlist_id
     WHERE w.user_id = $1 AND wi.instrument_id = $2
     LIMIT 1`,
    [userId, instrumentId],
  );
  return rows.length > 0;
}

interface UnseenChangeRow {
  id: string;
  published_seq: string;
  published_at: Date;
  band: string | null;
  score: string | null;
  latest_at: Date;
  shared_explanation: string | null;
}

interface SignalRow {
  change_record_id: string;
  signal_type: string;
  detector_version: number;
  dedupe_key: string;
  evidence: Record<string, string | boolean>;
  market_timestamp: Date;
}

export interface UnseenChangeWire {
  readonly id: string;
  readonly publishedSeq: string;
  readonly publishedAt: string;
  readonly band: string | null;
  readonly score: string | null;
  readonly latestAt: string;
  readonly sharedExplanation: string | null;
  readonly signals: ReadonlyArray<{
    readonly signalType: string;
    readonly detectorVersion: number;
    readonly dedupeKey: string;
    readonly evidence: Record<string, string | boolean>;
    readonly marketTimestamp: string;
  }>;
}

/**
 * The full unseen change set with evidence: every sealed change_record beyond the checkpoint's
 * watermark, each with its instrument_signals rows (the "evidence" the detail view exposes).
 */
async function getUnseenChanges(
  pool: Pool,
  instrumentId: bigint,
  seenThrough: bigint,
): Promise<UnseenChangeWire[]> {
  const { rows: changeRows } = await query<UnseenChangeRow>(
    pool,
    `SELECT id, published_seq, published_at, band, score, latest_at, shared_explanation
     FROM change_records
     WHERE instrument_id = $1 AND published_seq IS NOT NULL AND published_seq > $2
     ORDER BY published_seq ASC`,
    [instrumentId, seenThrough],
  );
  if (changeRows.length === 0) return [];

  const { rows: signalRows } = await query<SignalRow>(
    pool,
    `SELECT change_record_id, signal_type, detector_version, dedupe_key, evidence, market_timestamp
     FROM instrument_signals
     WHERE change_record_id = ANY($1)
     ORDER BY id ASC`,
    [changeRows.map((r) => r.id)],
  );

  const signalsByRecord = new Map<string, SignalRow[]>();
  for (const s of signalRows) {
    const list = signalsByRecord.get(s.change_record_id) ?? [];
    list.push(s);
    signalsByRecord.set(s.change_record_id, list);
  }

  return changeRows.map((cr) => ({
    id: cr.id,
    publishedSeq: cr.published_seq,
    publishedAt: cr.published_at.toISOString(),
    band: cr.band,
    score: cr.score,
    latestAt: cr.latest_at.toISOString(),
    sharedExplanation: cr.shared_explanation,
    signals: (signalsByRecord.get(cr.id) ?? []).map((s) => ({
      signalType: s.signal_type,
      detectorVersion: s.detector_version,
      dedupeKey: s.dedupe_key,
      evidence: s.evidence,
      marketTimestamp: s.market_timestamp.toISOString(),
    })),
  }));
}

async function getHolidays(pool: Pool): Promise<Set<SessionDate>> {
  const { rows } = await query<{ holiday_date: string }>(
    pool,
    `SELECT holiday_date::text AS holiday_date FROM exchange_holidays`,
    [],
  );
  return new Set(rows.map((r) => toSessionDate(r.holiday_date)));
}

/** The maximum published_seq actually rendered — servedWatermark per §F.6. */
function computeServedWatermark(unseenChanges: UnseenChangeWire[], seenThrough: bigint): bigint {
  return unseenChanges.reduce((max, c) => {
    const seq = BigInt(c.publishedSeq);
    return seq > max ? seq : max;
  }, seenThrough);
}

/**
 * Assembles the full handover sheet for an instrument that already has a row — the "tier 1"
 * response shared by the id-keyed and symbol-keyed detail routes: envelope, since-you-last-
 * checked, unseen changes, and a fresh `ackToken`. Every write on this path is
 * `ensureCheckpoint`'s create-if-absent (T29); nothing here mutates an existing checkpoint.
 */
async function assembleFullSheet(
  pool: Pool,
  userId: bigint,
  instrument: InstrumentRow,
  ackTokenSecret: string,
): Promise<Record<string, unknown>> {
  const instrumentId = instrument.instrumentId;

  // Only write on this path: create-if-absent, never mutates an existing row (T29).
  const checkpoint = await ensureCheckpoint(pool, userId, instrumentId);
  const seenThrough = BigInt(checkpoint.seenThroughPublicationSeq);

  const marketStateRow = await getMarketState(pool, instrumentId);

  const adjustment = await factorBetween(
    pool,
    String(instrumentId),
    checkpoint.baselineCorporateActionVersion,
    instrument.corporateActionVersion,
  );

  const unseenChanges = await getUnseenChanges(pool, instrumentId, seenThrough);
  const holidays = await getHolidays(pool);
  const servedWatermark = computeServedWatermark(unseenChanges, seenThrough);

  let comparisonStatus: string;
  let dataFreshness: string;
  let currentWire: Record<string, unknown> | null = null;
  let tokenBaselinePrice: Decimal | null = null;
  let tokenBaselineMarketTimestamp: UtcTimestamp | null = null;
  let diffFields: Record<string, unknown> = {};
  // Kept out of `diffFields` because the brief bucket needs it after the branch.
  let elapsedMs: number | undefined;

  if (marketStateRow) {
    const envelope = assembleEnvelope(marketStateRow);
    currentWire = envelopeToWire(envelope);
    tokenBaselinePrice = envelope.value;
    tokenBaselineMarketTimestamp = envelope.marketTimestamp;

    const diff = computeSinceLastCheck({
      checkpoint: {
        baselinePrice: checkpoint.baselinePrice,
        baselineMarketTimestamp: checkpoint.baselineMarketTimestamp,
      },
      current: {
        price: envelope.value,
        marketTimestamp: envelope.marketTimestamp,
        dataFreshness: envelope.dataFreshness,
        // No read-time volatility source exists yet anywhere in this codebase — FeatureExtractor
        // (worker/src/features) is not wired into any persistence path, so sigma20 has nothing to
        // read. Passing null yields INSUFFICIENT_HISTORY rather than guessing (suppress, don't
        // guess — same pattern as the corporate-action suppression above it).
        sigma20: null,
      },
      adjustment,
      unseenChanges,
      holidays,
    });

    comparisonStatus = diff.comparisonStatus;
    dataFreshness = diff.dataFreshness;
    elapsedMs = diff.elapsedMs;
    diffFields = {
      ...(diff.adjustedBaseline !== undefined ? { adjustedBaseline: toWireString(diff.adjustedBaseline) } : {}),
      ...(diff.absoluteChange !== undefined ? { absoluteChange: toWireString(diff.absoluteChange) } : {}),
      ...(diff.percentageChange !== undefined ? { percentageChange: toWireString(diff.percentageChange) } : {}),
      ...(diff.elapsedMs !== undefined ? { elapsedMs: diff.elapsedMs } : {}),
      ...(diff.sessionsElapsed !== undefined ? { sessionsElapsed: diff.sessionsElapsed } : {}),
      ...(diff.volatilityMultiple !== undefined ? { volatilityMultiple: toWireString(diff.volatilityMultiple) } : {}),
      ...(diff.adjustmentLabels !== undefined ? { adjustmentLabels: diff.adjustmentLabels } : {}),
    };
  } else {
    // No market state yet (WARMING) — there is nothing to diff against.
    comparisonStatus = 'AWAITING_BASELINE';
    dataFreshness = DataFreshness.UNAVAILABLE;
  }

  // Shared explanation brief (§F.7). Reads the worker-rendered row for the
  // anonymised elapsed-time bucket; on a miss, asks for one and serves null this
  // time round, exactly as the ingestion path warms a price. The API never calls
  // a model on a read.
  const briefWindow = briefWindowFor(comparisonStatus as ComparisonStatus, elapsedMs);
  const brief = await loadBrief(pool, instrumentId, briefWindow);
  if (brief === null) {
    await requestBrief(pool, instrumentId, instrument.symbol, briefWindow);
  }

  const ackToken = mint(
    {
      userId,
      instrumentId,
      servedWatermark,
      baselinePrice: tokenBaselinePrice,
      baselineMarketTimestamp: tokenBaselineMarketTimestamp,
      corporateActionVersion: instrument.corporateActionVersion,
    },
    ackTokenSecret,
  );

  return {
    instrumentId: String(instrumentId),
    symbol: instrument.symbol,
    name: instrument.name,
    exchange: instrument.exchange,
    comparisonStatus,
    dataFreshness,
    current: currentWire,
    ...diffFields,
    brief,
    briefWindow,
    unseenChanges,
    ackToken,
  };
}

export async function registerInstrumentRoutes(
  app: FastifyInstance,
  pool: Pool,
  ackTokenSecret: string,
): Promise<void> {
  const auth = requireSession(pool);

  // ── GET /instruments/:id ────────────────────────────────────────────────────
  app.get('/instruments/:id', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const instrumentId = parseBigInt(id);
    if (!instrumentId) return reply.code(404).send({ error: 'Not found' });

    const owns = await userTracksInstrument(pool, request.user!.id, instrumentId);
    if (!owns) return reply.code(404).send({ error: 'Not found' });

    const instrument = await getInstrument(pool, instrumentId);
    if (!instrument) return reply.code(404).send({ error: 'Not found' });

    const sheet = await assembleFullSheet(pool, request.user!.id, instrument, ackTokenSecret);
    return reply.send(sheet);
  });

  // ── GET /instruments/by-symbol/:symbol ──────────────────────────────────────
  // The "normal stock watcher" entry point (T-UI defect 2): resolves by symbol, not the
  // internal instrument id, and is servable for *any* catalog symbol whether or not the
  // requesting user — or anyone — has starred it. Viewing a catalog symbol nobody has
  // registered yet IS ingestion demand (architecture §D: "Tracking is API-owned because it
  // expresses demand, not market fact") — so unlike the old tier-2 identity-only response,
  // this now registers the instrument + a low-priority ACTIVE `instrument_tracking` row
  // (`tracking_source = 'VIEWED'`) and enqueues the same jobs `POST /watchlists/:id/items`
  // would, rather than returning a sheet that can never warm up. Starring
  // (api/src/watchlists/tracking.ts) still owns watchlist membership and raises priority to
  // `STARRED`; it is no longer what creates the tracking row in the first place.
  //
  // This does NOT touch watchlists or move a checkpoint — `assembleFullSheet`'s only write is
  // `ensureCheckpoint`'s create-if-absent, the same non-user-state-mutating pattern already
  // used by `GET /instruments/:id` (T29/T30, INV-7). Registered ahead of `/instruments/:id`'s
  // path shape is irrelevant here since Fastify matches the static `by-symbol` segment first.
  app.get('/instruments/by-symbol/:symbol', { preHandler: auth }, async (request, reply) => {
    const { symbol } = request.params as { symbol: string };
    const normalizedSymbol = symbol.toUpperCase().trim();
    if (normalizedSymbol === '') return reply.code(404).send({ error: 'Not found' });

    const instrument = await getInstrumentBySymbol(pool, normalizedSymbol);
    if (instrument) {
      const sheet = await assembleFullSheet(pool, request.user!.id, instrument, ackTokenSecret);
      return reply.send(sheet);
    }

    // No instrument row exists yet. Only register one if this is a real catalog symbol —
    // never invent an instrument for an arbitrary path parameter.
    const catalogEntry = await getCatalogIdentity(pool, normalizedSymbol);
    if (!catalogEntry) return reply.code(404).send({ error: 'Not found' });

    const { instrumentId } = await resolveOrRegisterSymbol(pool, normalizedSymbol);
    await registerViewDemand(pool, instrumentId);

    const registered = await getInstrument(pool, instrumentId);
    if (!registered) return reply.code(404).send({ error: 'Not found' }); // defensive, unreachable

    const sheet = await assembleFullSheet(pool, request.user!.id, registered, ackTokenSecret);
    return reply.send(sheet);
  });

  // ── GET /instruments/:id/bars ───────────────────────────────────────────────
  // Read-only OHLCV history for the price chart.
  //
  // Deliberately NOT gated on watchlist membership. `docs/plans/current-state.md` proposed
  // reusing `userTracksInstrument` here, but that note predates demand being decoupled from
  // starring: gating the chart on a star would reintroduce exactly the dead-end this work
  // removed — you could view a stock but not see its history. Bars are shared market facts,
  // not user-owned rows, so §N boundary 3's ownership rule does not apply; an authenticated
  // session is the correct bar. No `ensureCheckpoint` here — the detail route's checkpoint
  // write is a documented exception, not a pattern to copy (INV-7: no GET mutates user state).
  //
  // Every derived figure (range high/low and the change across the window) is computed here,
  // as decimal strings, because the frontend formats canonical values and never derives
  // financial semantics.
  app.get('/instruments/:id/bars', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const instrumentId = parseBigInt(id);
    if (instrumentId === null) return reply.code(404).send({ error: 'Not found' });

    const { days } = request.query as { days?: string };
    const parsedDays = days === undefined ? 260 : Number(days);
    if (!Number.isInteger(parsedDays) || parsedDays < 2 || parsedDays > 1000) {
      return reply.code(400).send({ error: 'days must be an integer between 2 and 1000' });
    }

    const { rows } = await query<{
      session_date: string;
      open: string;
      high: string;
      low: string;
      close: string;
      volume: string;
    }>(
      pool,
      `SELECT session_date::text, open, high, low, close, volume
       FROM instrument_bars
       WHERE instrument_id = $1
       ORDER BY session_date DESC
       LIMIT $2`,
      [instrumentId, parsedDays],
    );

    if (rows.length === 0) {
      return reply.send({ instrumentId: String(instrumentId), bars: [], range: null });
    }

    // Ascending for plotting — oldest first, so the chart reads left to right.
    const bars = rows
      .slice()
      .reverse()
      .map((r) => ({
        sessionDate: r.session_date,
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume,
      }));

    // Decimal comparisons on strings would be wrong; these go through the same Decimal type
    // the rest of the money path uses. No JS float ever touches a price.
    let high = new Decimal(bars[0]!.high);
    let low = new Decimal(bars[0]!.low);
    for (const b of bars) {
      const h = new Decimal(b.high);
      const l = new Decimal(b.low);
      if (h.greaterThan(high)) high = h;
      if (l.lessThan(low)) low = l;
    }

    const first = new Decimal(bars[0]!.close);
    const last = new Decimal(bars[bars.length - 1]!.close);
    const absoluteChange = last.minus(first);
    // Percentage scale (x100), matching `diff/engine.ts`'s existing convention so the wire
    // carries one meaning of "percentage" rather than two.
    const percentageChange = first.isZero()
      ? null
      : absoluteChange.dividedBy(first).times(100).toDecimalPlaces(4);

    return reply.send({
      instrumentId: String(instrumentId),
      bars,
      range: {
        sessions: bars.length,
        from: bars[0]!.sessionDate,
        to: bars[bars.length - 1]!.sessionDate,
        high: toWireString(high),
        low: toWireString(low),
        absoluteChange: toWireString(absoluteChange),
        percentageChange: percentageChange === null ? null : toWireString(percentageChange),
      },
    });
  });
}
