import type { Pool, PoolClient } from '../db.js';
import { query } from '../db.js';
import { parseDecimal, fromDate, type Decimal, type UtcTimestamp } from '@stockwatch/contracts';

/**
 * Checkpoint repository — monotonic upsert (T29, architecture §H — INV-7, INV-8).
 * Keyed `(user_id, instrument_id)`: one row shared across every watchlist that carries the
 * instrument, and never deleted on watchlist-item removal (§H "Removal and re-add") — re-adding
 * is just another `ensureCheckpoint` call against the surviving row.
 */

export interface CheckpointRow {
  id: string;
  userId: string;
  instrumentId: string;
  seenThroughPublicationSeq: string;
  baselinePrice: Decimal | null;
  baselineMarketTimestamp: UtcTimestamp | null;
  baselineCorporateActionVersion: number;
}

interface CheckpointDbRow {
  id: string;
  userId: string;
  instrumentId: string;
  seenThroughPublicationSeq: string;
  baselinePrice: string | null;
  baselineMarketTimestamp: Date | null;
  baselineCorporateActionVersion: number;
}

const SELECT_COLUMNS = `
  id,
  user_id AS "userId",
  instrument_id AS "instrumentId",
  seen_through_publication_seq AS "seenThroughPublicationSeq",
  baseline_price AS "baselinePrice",
  baseline_market_timestamp AS "baselineMarketTimestamp",
  baseline_corporate_action_version AS "baselineCorporateActionVersion"
`;

function toCheckpointRow(row: CheckpointDbRow): CheckpointRow {
  return {
    id: row.id,
    userId: row.userId,
    instrumentId: row.instrumentId,
    seenThroughPublicationSeq: row.seenThroughPublicationSeq,
    baselinePrice: row.baselinePrice === null ? null : parseDecimal(row.baselinePrice),
    baselineMarketTimestamp: row.baselineMarketTimestamp === null ? null : fromDate(row.baselineMarketTimestamp),
    baselineCorporateActionVersion: row.baselineCorporateActionVersion,
  };
}

/** Read a checkpoint. Returns null if none exists for this (user, instrument) yet. */
export async function getCheckpoint(
  client: Pool | PoolClient,
  userId: bigint,
  instrumentId: bigint,
): Promise<CheckpointRow | null> {
  const { rows } = await query<CheckpointDbRow>(
    client,
    `SELECT ${SELECT_COLUMNS} FROM user_instrument_checkpoints WHERE user_id = $1 AND instrument_id = $2`,
    [userId, instrumentId],
  );
  return rows[0] ? toCheckpointRow(rows[0]) : null;
}

/**
 * Create-if-absent, initial-following policy (§H): a fresh checkpoint starts at
 * `instruments.last_published_seq` with the current price as baseline — no backlog surfaces
 * for a newly-watched instrument. If market state isn't available yet (warming), the checkpoint
 * is created with a null baseline and `seen_through = 0` instead, regardless of
 * `last_published_seq`, so `AWAITING_BASELINE` is reported until the first acknowledgement.
 * Already-existing checkpoints (including ones shared with another watchlist, or surviving a
 * prior removal) are returned unchanged.
 */
export async function ensureCheckpoint(
  client: Pool | PoolClient,
  userId: bigint,
  instrumentId: bigint,
): Promise<CheckpointRow> {
  const { rows: inserted } = await query<CheckpointDbRow>(
    client,
    `WITH desired AS (
       SELECT
         i.last_published_seq AS seen_through,
         ims.price AS baseline_price,
         ims.market_timestamp AS baseline_market_timestamp,
         i.corporate_action_version AS baseline_corporate_action_version
       FROM instruments i
       LEFT JOIN instrument_market_state ims ON ims.instrument_id = i.id
       WHERE i.id = $2
     )
     INSERT INTO user_instrument_checkpoints
       (user_id, instrument_id, seen_through_publication_seq, baseline_price,
        baseline_market_timestamp, baseline_corporate_action_version)
     SELECT
       $1, $2,
       CASE WHEN desired.baseline_price IS NULL THEN 0 ELSE desired.seen_through END,
       desired.baseline_price,
       desired.baseline_market_timestamp,
       COALESCE(desired.baseline_corporate_action_version, 0)
     FROM desired
     ON CONFLICT (user_id, instrument_id) DO NOTHING
     RETURNING ${SELECT_COLUMNS}`,
    [userId, instrumentId],
  );
  if (inserted[0]) return toCheckpointRow(inserted[0]);

  const existing = await getCheckpoint(client, userId, instrumentId);
  if (!existing) {
    throw new Error(`ensureCheckpoint: insert skipped but no existing row for (${userId}, ${instrumentId})`);
  }
  return existing;
}

export interface AdvanceCheckpointInput {
  readonly servedWatermark: bigint;
  readonly baselinePrice: Decimal | null;
  readonly baselineMarketTimestamp: UtcTimestamp | null;
  readonly corporateActionVersion: number;
}

/**
 * Advance a checkpoint on acknowledgement (§H "Multiple devices" — INV-7). The watermark only
 * ever moves via `GREATEST(existing, servedWatermark)`, so a replayed or stale (behind another
 * device's) token is a safe no-op on that column. The baseline is only overwritten when the
 * watermark actually advances past what's stored, or (independently) when the incoming
 * `baselineMarketTimestamp` is strictly newer than the stored one — matching §H's "baseline
 * comes from the acknowledgement with the newest market_timestamp". A null incoming
 * `baselinePrice` never clobbers an already-established baseline (only first-ack-while-warming
 * legitimately carries a null baseline, and there's nothing useful to overwrite with).
 * Returns null if no checkpoint exists for this (user, instrument) yet.
 */
export async function advanceCheckpoint(
  client: Pool | PoolClient,
  userId: bigint,
  instrumentId: bigint,
  input: AdvanceCheckpointInput,
): Promise<CheckpointRow | null> {
  const baselineMarketTimestampDate =
    input.baselineMarketTimestamp === null ? null : new Date(input.baselineMarketTimestamp);

  const { rows } = await query<CheckpointDbRow>(
    client,
    `UPDATE user_instrument_checkpoints
     SET
       baseline_price = CASE WHEN $4::numeric IS NOT NULL AND (
                                $3::bigint > seen_through_publication_seq
                                OR baseline_market_timestamp IS NULL
                                OR $5::timestamptz > baseline_market_timestamp
                              )
                             THEN $4 ELSE baseline_price END,
       baseline_market_timestamp = CASE WHEN $4::numeric IS NOT NULL AND (
                                $3::bigint > seen_through_publication_seq
                                OR baseline_market_timestamp IS NULL
                                OR $5::timestamptz > baseline_market_timestamp
                              )
                             THEN $5 ELSE baseline_market_timestamp END,
       baseline_corporate_action_version = CASE WHEN $4::numeric IS NOT NULL AND (
                                $3::bigint > seen_through_publication_seq
                                OR baseline_market_timestamp IS NULL
                                OR $5::timestamptz > baseline_market_timestamp
                              )
                             THEN $6 ELSE baseline_corporate_action_version END,
       seen_through_publication_seq = GREATEST(seen_through_publication_seq, $3::bigint),
       updated_at = NOW()
     WHERE user_id = $1 AND instrument_id = $2
     RETURNING ${SELECT_COLUMNS}`,
    [
      userId,
      instrumentId,
      input.servedWatermark,
      input.baselinePrice === null ? null : input.baselinePrice.toFixed(),
      baselineMarketTimestampDate,
      input.corporateActionVersion,
    ],
  );
  return rows[0] ? toCheckpointRow(rows[0]) : null;
}
