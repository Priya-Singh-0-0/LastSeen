import type { PoolClient } from '../db.js';
import type { SignalEvidence, SessionDate, UtcTimestamp } from '@stockwatch/contracts';
import { toSessionDate, toUtcTimestamp } from '@stockwatch/contracts';
import type { ChangeRecordDraft } from '../assembly/assembler.js';

/**
 * Change-record persistence — the step that was missing between `assembleSignals` (T23, pure)
 * and `publishChangeRecord` (T24, seals an already-persisted row).
 *
 * `change_records` has no `session_date` column, but `ChangeRecordDraft` groups on one. It is
 * recovered from the record's own signals rather than stored a second time: every signal in a
 * record carries `session_date`, so the record's session is the session of its earliest signal.
 * Deriving avoids a column that could disagree with its own rows.
 */

/**
 * Load this instrument's UNPUBLISHED change records with their signals attached.
 *
 * Sealed records (`published_seq IS NOT NULL`) are deliberately excluded: §F.3 says the
 * assembler groups new signals only into records that are not yet published, so a sealed
 * record must never be handed back as a candidate group target.
 */
export async function loadOpenDrafts(
  client: PoolClient,
  instrumentId: string,
): Promise<ChangeRecordDraft[]> {
  const { rows } = await client.query<{
    id: string;
    assembly_version: number;
    latest_at: Date;
    signal_type: string | null;
    detector_version: number | null;
    dedupe_key: string | null;
    evidence: Record<string, string | boolean> | null;
    market_timestamp: Date | null;
    session_date: string | null;
  }>(
    `SELECT cr.id, cr.assembly_version, cr.latest_at,
            s.signal_type, s.detector_version, s.dedupe_key, s.evidence, s.market_timestamp,
            -- The signal's own session, used to recover the record's grouping session.
            (s.market_timestamp AT TIME ZONE 'UTC')::date::text AS session_date
     FROM change_records cr
     LEFT JOIN instrument_signals s ON s.change_record_id = cr.id
     WHERE cr.instrument_id = $1 AND cr.published_seq IS NULL
     ORDER BY cr.id, s.market_timestamp`,
    [instrumentId],
  );

  const byRecord = new Map<string, { assemblyVersion: number; latestAt: Date; signals: SignalEvidence[] }>();
  for (const r of rows) {
    let entry = byRecord.get(r.id);
    if (!entry) {
      entry = { assemblyVersion: r.assembly_version, latestAt: r.latest_at, signals: [] };
      byRecord.set(r.id, entry);
    }
    // LEFT JOIN: a record with zero signals yields one row of nulls — not a signal.
    if (r.signal_type === null || r.dedupe_key === null || r.market_timestamp === null) continue;
    entry.signals.push({
      signalType: r.signal_type as SignalEvidence['signalType'],
      detectorVersion: r.detector_version ?? 1,
      dedupeKey: r.dedupe_key,
      marketTimestamp: toUtcTimestamp(r.market_timestamp.getTime()),
      sessionDate: toSessionDate(r.session_date!) as SessionDate,
      evidence: r.evidence ?? {},
    });
  }

  return [...byRecord.entries()].map(([id, e]) => ({
    id,
    publishedSeq: null,
    assemblyVersion: e.assemblyVersion,
    // A record whose signals were all detached still needs a session; fall back to latest_at.
    sessionDate:
      e.signals[0]?.sessionDate ??
      (toSessionDate(e.latestAt.toISOString().slice(0, 10)) as SessionDate),
    latestAt: toUtcTimestamp(e.latestAt.getTime()) as UtcTimestamp,
    signals: e.signals,
  }));
}

/**
 * Insert or update one draft and attach its signals, returning the record id.
 *
 * Idempotent by construction: signals are matched by their natural key
 * `(instrument_id, detector_version, dedupe_key)` — already unique per INV-5 — so re-running
 * the same cycle re-points the same rows at the same record rather than duplicating them.
 * A draft that already has an id is updated in place; `published_seq` is never written here
 * (only `publishChangeRecord` assigns it, exactly once — INV-6).
 */
export async function persistDraft(
  client: PoolClient,
  instrumentId: string,
  draft: ChangeRecordDraft,
): Promise<string> {
  let recordId = draft.id;
  const latestAt = new Date(draft.latestAt).toISOString();

  if (recordId === null) {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO change_records (instrument_id, assembly_version, latest_at)
       VALUES ($1, $2, $3::timestamptz)
       RETURNING id`,
      [instrumentId, draft.assemblyVersion, latestAt],
    );
    recordId = rows[0]!.id;
  } else {
    await client.query(
      `UPDATE change_records
       SET latest_at = GREATEST(latest_at, $2::timestamptz), updated_at = NOW()
       WHERE id = $1 AND published_seq IS NULL`,
      [recordId, latestAt],
    );
  }

  if (draft.signals.length > 0) {
    await client.query(
      `UPDATE instrument_signals
       SET change_record_id = $1
       WHERE instrument_id = $2
         AND change_record_id IS NULL
         AND (detector_version, dedupe_key) IN (
           SELECT u.detector_version::int, u.dedupe_key
           FROM UNNEST($3::int[], $4::text[]) AS u(detector_version, dedupe_key)
         )`,
      [
        recordId,
        instrumentId,
        draft.signals.map((s) => s.detectorVersion),
        draft.signals.map((s) => s.dedupeKey),
      ],
    );
  }

  return recordId;
}
