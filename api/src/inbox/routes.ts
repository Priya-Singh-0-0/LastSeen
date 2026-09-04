import type { FastifyInstance } from 'fastify';
import { requireSession } from '../auth/middleware.js';
import { query } from '../db.js';
import type { Pool } from '../db.js';
import { computeSinceLastCheck, type ComparisonStatus } from '../diff/engine.js';
import type { AdjustmentResult } from '../diff/adjustment.js';
import { assembleEnvelope, envelopeToWire, type MarketStateRow } from '../market/envelope.js';
import { rankInboxItems, type RankableItem } from '../ranking/ranker.js';
import { renderPersonalClause } from '../explanation/personalTemplate.js';
import { composeExplanation } from '../explanation/renderer.js';
import { D, toWireString, parseDecimal, fromDate, AttentionBand, DataFreshness } from '@stockwatch/contracts';
import type { Decimal, UtcTimestamp } from '@stockwatch/contracts';

/**
 * Inbox route (T31, architecture §F.4 — INV-1, INV-2, INV-14, INV-9).
 *
 * "Two bounded queries for the whole page regardless of user count. No N+1, no provider
 * call." This route deliberately does NOT call `factorBetween` (T26) or fetch
 * `exchange_holidays` per item — either would turn into a third query (or an N+1) and
 * blow the budget. Two judgment calls follow from that, both suppress-rather-than-guess:
 *
 *  - Corporate-action adjustment: if a checkpoint's `baseline_corporate_action_version`
 *    still matches the instrument's current `corporate_action_version` (both already
 *    columns in the single item-join query), the adjustment is trivially the identity
 *    (T26: `factorBetween(id, v, v)` is always identity). If they differ, we cannot verify
 *    without a corporate_actions query, so the comparison is conservatively suppressed
 *    (`SUPPRESSED_CORPORATE_ACTION`) rather than guessed — the detail view (T30) still
 *    computes the real answer with its own budget.
 *  - Holidays: passed as an empty set, so `sessionsElapsed` may overcount by the (typically
 *    0-2) exchange holidays inside the window. This never changes `comparisonStatus` and
 *    doesn't affect ranking's dominant key (band/score), only the personal clause's
 *    session count and the de-weighted |move| tiebreaker.
 *
 * `sigma20` has no persistence path anywhere in this codebase yet (same gap noted in T30) —
 * passed null, yielding `INSUFFICIENT_HISTORY` rather than a fabricated multiple.
 */

const UNSEEN_LIMIT_PER_INSTRUMENT = 20;

interface ItemJoinRow {
  instrument_id: string | null;
  corporate_action_version: number | null;
  price: string | null;
  currency: string | null;
  market_timestamp: Date | null;
  ingested_at: Date | null;
  source: string | null;
  market_status: string | null;
  value_kind: string | null;
  data_freshness: string | null;
  precision_hint: number | null;
  seen_through_publication_seq: string | null;
  baseline_price: string | null;
  baseline_market_timestamp: Date | null;
  baseline_corporate_action_version: number | null;
}

interface ChangeRecordRow {
  instrument_id: string;
  published_seq: string;
  score: string | null;
  band: string | null;
  shared_explanation: string | null;
}

function parseBigInt(val: unknown): bigint | null {
  try { return BigInt(val as string); } catch { return null; }
}

async function fetchItemJoin(pool: Pool, watchlistId: bigint, userId: bigint): Promise<ItemJoinRow[]> {
  const { rows } = await query<ItemJoinRow>(
    pool,
    `SELECT
       wi.instrument_id,
       i.corporate_action_version,
       ims.price, ims.currency, ims.market_timestamp, ims.ingested_at, ims.source,
       ims.market_status, ims.value_kind, ims.data_freshness, ims.precision_hint,
       c.seen_through_publication_seq, c.baseline_price, c.baseline_market_timestamp,
       c.baseline_corporate_action_version
     FROM watchlists wl
     LEFT JOIN watchlist_items wi ON wi.watchlist_id = wl.id
     LEFT JOIN instruments i ON i.id = wi.instrument_id
     LEFT JOIN instrument_market_state ims ON ims.instrument_id = i.id
     LEFT JOIN user_instrument_checkpoints c ON c.instrument_id = i.id AND c.user_id = $2
     WHERE wl.id = $1 AND wl.user_id = $2`,
    [watchlistId, userId],
  );
  return rows;
}

async function fetchUnseenChanges(
  pool: Pool,
  instrumentIds: bigint[],
  seenThroughByInstrument: bigint[],
): Promise<ChangeRecordRow[]> {
  const { rows } = await query<ChangeRecordRow>(
    pool,
    `WITH watermarks AS (
       SELECT * FROM UNNEST($1::bigint[], $2::bigint[]) AS w(instrument_id, seen_through)
     ),
     ranked AS (
       SELECT cr.instrument_id, cr.published_seq, cr.score, cr.band, cr.shared_explanation,
              ROW_NUMBER() OVER (PARTITION BY cr.instrument_id ORDER BY cr.published_seq DESC) AS rn
       FROM change_records cr
       JOIN watermarks w ON w.instrument_id = cr.instrument_id
       WHERE cr.published_seq IS NOT NULL AND cr.published_seq > w.seen_through
     )
     SELECT instrument_id, published_seq, score, band, shared_explanation
     FROM ranked
     WHERE rn <= $3`,
    [instrumentIds, seenThroughByInstrument, UNSEEN_LIMIT_PER_INSTRUMENT],
  );
  return rows;
}

interface ComposedItem {
  instrumentId: string;
  comparisonStatus: ComparisonStatus;
  dataFreshness: string;
  current: Record<string, unknown> | null;
  diffFields: Record<string, unknown>;
  unseenCount: number;
  maxUnseenBand: string | null;
  maxUnseenScore: string | null;
  explanation: string;
}

export async function registerInboxRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  const auth = requireSession(pool);

  app.get('/watchlists/:id/inbox', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const watchlistId = parseBigInt(id);
    if (!watchlistId) return reply.code(404).send({ error: 'Not found' });

    const joinRows = await fetchItemJoin(pool, watchlistId, request.user!.id);
    if (joinRows.length === 0) return reply.code(404).send({ error: 'Not found' });

    const itemRows = joinRows.filter((r): r is ItemJoinRow & { instrument_id: string } => r.instrument_id !== null);
    if (itemRows.length === 0) {
      return reply.send({ watchlistId: String(watchlistId), items: [] });
    }

    const instrumentIds = itemRows.map((r) => BigInt(r.instrument_id));
    const seenThroughByInstrument = itemRows.map((r) =>
      r.seen_through_publication_seq === null ? 0n : BigInt(r.seen_through_publication_seq),
    );

    const changeRows = await fetchUnseenChanges(pool, instrumentIds, seenThroughByInstrument);
    const changesByInstrument = new Map<string, ChangeRecordRow[]>();
    for (const row of changeRows) {
      const list = changesByInstrument.get(row.instrument_id) ?? [];
      list.push(row);
      changesByInstrument.set(row.instrument_id, list);
    }

    const rankable: RankableItem<ComposedItem>[] = itemRows.map((row) => {
      const unseen = changesByInstrument.get(row.instrument_id) ?? [];

      let maxUnseenBand: AttentionBand | null = null;
      let maxUnseenScoreDecimal: Decimal | null = null;
      const BAND_RANK: Record<string, number> = { URGENT: 3, NOTABLE: 2, MINOR: 1, QUIET: 0 };
      let bestBandRank = -1;
      let top: ChangeRecordRow | null = null;
      let topScore = D.zero();
      for (const c of unseen) {
        if (c.band !== null) {
          const rank = BAND_RANK[c.band] ?? -1;
          if (rank > bestBandRank) {
            bestBandRank = rank;
            maxUnseenBand = c.band as AttentionBand;
          }
        }
        if (c.score !== null) {
          const scoreDecimal = parseDecimal(c.score);
          if (maxUnseenScoreDecimal === null || D.gt(scoreDecimal, maxUnseenScoreDecimal)) {
            maxUnseenScoreDecimal = scoreDecimal;
          }
          if (top === null || D.gt(scoreDecimal, topScore)) {
            top = c;
            topScore = scoreDecimal;
          }
        } else if (top === null) {
          top = c;
        }
      }

      const checkpointBaselinePrice = row.baseline_price === null ? null : parseDecimal(row.baseline_price);
      const checkpointBaselineTs: UtcTimestamp | null =
        row.baseline_market_timestamp === null ? null : fromDate(row.baseline_market_timestamp);
      const checkpointBaselineActionVersion = row.baseline_corporate_action_version ?? 0;

      let comparisonStatus: ComparisonStatus;
      let dataFreshness: string;
      let current: Record<string, unknown> | null = null;
      let diffFields: Record<string, unknown> = {};
      let sinceCheckMove: Decimal | null = null;
      let sessionsElapsed: number | undefined;
      let percentageChange: Decimal | undefined;

      if (row.price === null) {
        comparisonStatus = 'AWAITING_BASELINE';
        dataFreshness = DataFreshness.UNAVAILABLE;
      } else {
        const marketStateRow: MarketStateRow = {
          price: row.price,
          currency: row.currency!,
          market_timestamp: row.market_timestamp!,
          ingested_at: row.ingested_at!,
          source: row.source!,
          market_status: row.market_status!,
          value_kind: row.value_kind!,
          data_freshness: row.data_freshness!,
          precision_hint: row.precision_hint!,
        };
        const envelope = assembleEnvelope(marketStateRow);
        current = envelopeToWire(envelope);

        const adjustment: AdjustmentResult = {
          factor: D.one(),
          hasUnsupportedAction: (row.corporate_action_version ?? 0) !== checkpointBaselineActionVersion,
          actions: [],
        };

        const diff = computeSinceLastCheck({
          checkpoint: {
            baselinePrice: checkpointBaselinePrice,
            baselineMarketTimestamp: checkpointBaselineTs,
          },
          current: {
            price: envelope.value,
            marketTimestamp: envelope.marketTimestamp,
            dataFreshness: envelope.dataFreshness,
            sigma20: null,
          },
          adjustment,
          unseenChanges: unseen,
          holidays: [],
        });

        comparisonStatus = diff.comparisonStatus;
        dataFreshness = diff.dataFreshness;
        percentageChange = diff.percentageChange;
        sessionsElapsed = diff.sessionsElapsed;
        sinceCheckMove = diff.percentageChange ?? null;
        diffFields = {
          ...(diff.adjustedBaseline !== undefined ? { adjustedBaseline: toWireString(diff.adjustedBaseline) } : {}),
          ...(diff.absoluteChange !== undefined ? { absoluteChange: toWireString(diff.absoluteChange) } : {}),
          ...(diff.percentageChange !== undefined ? { percentageChange: toWireString(diff.percentageChange) } : {}),
          ...(diff.elapsedMs !== undefined ? { elapsedMs: diff.elapsedMs } : {}),
          ...(diff.sessionsElapsed !== undefined ? { sessionsElapsed: diff.sessionsElapsed } : {}),
          ...(diff.volatilityMultiple !== undefined ? { volatilityMultiple: toWireString(diff.volatilityMultiple) } : {}),
        };
      }

      const personalClause = renderPersonalClause({
        comparisonStatus,
        ...(sessionsElapsed !== undefined ? { sessionsElapsed } : {}),
        ...(percentageChange !== undefined ? { percentageChange } : {}),
      });
      const explanation = composeExplanation({
        topUnseenSharedExplanation: top?.shared_explanation ?? null,
        personalClause,
      });

      const composed: ComposedItem = {
        instrumentId: row.instrument_id,
        comparisonStatus,
        dataFreshness,
        current,
        diffFields,
        unseenCount: unseen.length,
        maxUnseenBand,
        maxUnseenScore: maxUnseenScoreDecimal === null ? null : toWireString(maxUnseenScoreDecimal),
        explanation,
      };

      return {
        item: composed,
        maxUnseenBand,
        maxUnseenScore: maxUnseenScoreDecimal,
        sinceCheckMove,
        dataFreshness: dataFreshness as DataFreshness,
      };
    });

    const ranked = rankInboxItems(rankable);

    return reply.send({
      watchlistId: String(watchlistId),
      items: ranked.map((r) => ({
        instrumentId: r.item.instrumentId,
        comparisonStatus: r.item.comparisonStatus,
        dataFreshness: r.item.dataFreshness,
        current: r.item.current,
        ...r.item.diffFields,
        unseenCount: r.item.unseenCount,
        maxUnseenBand: r.item.maxUnseenBand,
        maxUnseenScore: r.item.maxUnseenScore,
        explanation: r.item.explanation,
      })),
    });
  });
}
