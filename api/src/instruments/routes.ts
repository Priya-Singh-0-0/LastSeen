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
import { toWireString, toSessionDate, DataFreshness } from '@stockwatch/contracts';
import type { Decimal, SessionDate, UtcTimestamp } from '@stockwatch/contracts';

/**
 * Instrument detail route (T30, architecture §F.6 — INV-7, INV-15).
 *
 * A provably side-effect-free GET: it computes the diff and mints an ack token, but the only
 * write on this path is `ensureCheckpoint`'s create-if-absent (never mutates an existing row —
 * see T29). Advancing a checkpoint only ever happens via `POST /instruments/:id/acknowledge`
 * (checkpoints/routes.ts).
 */

function parseBigInt(val: unknown): bigint | null {
  try { return BigInt(val as string); } catch { return null; }
}

interface InstrumentRow {
  corporateActionVersion: number;
  symbol: string;
  exchange: string | null;
}

async function getInstrument(pool: Pool, instrumentId: bigint): Promise<InstrumentRow | null> {
  const { rows } = await query<{ corporate_action_version: number; symbol: string | null; exchange: string | null }>(
    pool,
    `SELECT i.corporate_action_version, isym.symbol, isym.exchange
     FROM instruments i
     LEFT JOIN instrument_symbols isym ON isym.instrument_id = i.id AND isym.valid_to IS NULL
     WHERE i.id = $1`,
    [instrumentId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    corporateActionVersion: row.corporate_action_version,
    symbol: row.symbol ?? String(instrumentId),
    exchange: row.exchange,
  };
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

    // Only write on this path: create-if-absent, never mutates an existing row (T29).
    const checkpoint = await ensureCheckpoint(pool, request.user!.id, instrumentId);
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

    const ackToken = mint(
      {
        userId: request.user!.id,
        instrumentId,
        servedWatermark,
        baselinePrice: tokenBaselinePrice,
        baselineMarketTimestamp: tokenBaselineMarketTimestamp,
        corporateActionVersion: instrument.corporateActionVersion,
      },
      ackTokenSecret,
    );

    return reply.send({
      instrumentId: String(instrumentId),
      symbol: instrument.symbol,
      exchange: instrument.exchange,
      comparisonStatus,
      dataFreshness,
      current: currentWire,
      ...diffFields,
      unseenChanges,
      ackToken,
    });
  });
}
