import { SignalType } from '@stockwatch/contracts';
import type { PoolClient } from '../db.js';
import { query } from '../db.js';
import { renderSharedExplanation, RENDERER_VERSION } from '../explanation/template.js';
import type { ScorableSignal } from './scoringV1.js';

/**
 * Publisher (T24 — INV-6, T25 — INV-14). Assigns `published_seq` to a `change_records`
 * row exactly once, in commit order, under a per-instrument row lock, and renders the
 * shared explanation from the record's signals in the same step. Ordering is monotonic
 * per instrument; gaps (from a publish that never committed) are tolerated, never repaired.
 */

export interface PublishResult {
  publishedSeq: number;
  publishedAt: Date;
  /** True if the record already carried a published_seq — the instrument counter was not touched. */
  alreadyPublished: boolean;
}

/**
 * Seals `changeRecordId` with the next `published_seq` for `instrumentId`, inside the
 * caller's transaction. A record that already carries a `published_seq` is a no-op:
 * it is returned as-is and `instruments.last_published_seq` is never touched.
 */
export async function publishChangeRecord(
  client: PoolClient,
  instrumentId: bigint,
  changeRecordId: bigint,
): Promise<PublishResult> {
  const { rows: recordRows } = await query<{ published_seq: string | null; published_at: Date | null }>(
    client,
    `SELECT published_seq, published_at FROM change_records
     WHERE id = $1 AND instrument_id = $2
     FOR UPDATE`,
    [changeRecordId, instrumentId],
  );
  if (recordRows.length === 0) {
    throw new Error(`change record not found: ${changeRecordId}`);
  }
  const existing = recordRows[0]!;
  if (existing.published_seq !== null) {
    return {
      publishedSeq: Number(existing.published_seq),
      publishedAt: existing.published_at!,
      alreadyPublished: true,
    };
  }

  const { rows: instrumentRows } = await query<{ last_published_seq: string }>(
    client,
    `SELECT last_published_seq FROM instruments WHERE id = $1 FOR UPDATE`,
    [instrumentId],
  );
  if (instrumentRows.length === 0) {
    throw new Error(`instrument not found: ${instrumentId}`);
  }
  const nextSeq = Number(instrumentRows[0]!.last_published_seq) + 1;

  await query(
    client,
    `UPDATE instruments SET last_published_seq = $1, updated_at = NOW() WHERE id = $2`,
    [nextSeq, instrumentId],
  );

  const { rows: signalRows } = await query<{ signal_type: SignalType; evidence: Record<string, string | boolean> }>(
    client,
    `SELECT signal_type, evidence FROM instrument_signals WHERE change_record_id = $1`,
    [changeRecordId],
  );
  const signals: ScorableSignal[] = signalRows.map((r) => ({ signalType: r.signal_type, evidence: r.evidence }));
  const sharedExplanation = signals.length > 0 ? renderSharedExplanation(signals) : null;
  const rendererVersion = signals.length > 0 ? RENDERER_VERSION : null;

  const { rows: updated } = await query<{ published_seq: string; published_at: Date }>(
    client,
    `UPDATE change_records
     SET published_seq = $1, published_at = NOW(), updated_at = NOW(),
         shared_explanation = $2, renderer_version = $3
     WHERE id = $4
     RETURNING published_seq, published_at`,
    [nextSeq, sharedExplanation, rendererVersion, changeRecordId],
  );

  return {
    publishedSeq: Number(updated[0]!.published_seq),
    publishedAt: updated[0]!.published_at,
    alreadyPublished: false,
  };
}
