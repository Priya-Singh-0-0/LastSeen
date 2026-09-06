import type { PoolClient } from '../db.js';
import type { BriefWindow } from '../explanation/factBundle.js';
import type { BriefOrigin } from '../explanation/modelRenderer.js';

/**
 * Persistence for `instrument_briefs` — the shared, per-instrument brief cache
 * (migration 0008). Worker-write, API-read, like every other market table.
 */

export interface BriefRow {
  readonly instrumentId: string;
  readonly rendererVersion: number;
  readonly sessionDate: string;
  readonly window: BriefWindow;
  readonly text: string;
  readonly origin: BriefOrigin;
  readonly factBundleHash: string;
}

/**
 * True when a brief already exists for this exact cache key. Checked before
 * calling the model so a retried or duplicated job costs nothing.
 */
export async function briefExists(
  client: PoolClient,
  instrumentId: string,
  window: BriefWindow,
  sessionDate: string,
  rendererVersion: number,
): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM instrument_briefs
     WHERE instrument_id = $1 AND window_bucket = $2 AND session_date = $3 AND renderer_version = $4`,
    [instrumentId, window, sessionDate, rendererVersion],
  );
  return rows.length > 0;
}

/**
 * Insert-if-absent. `DO NOTHING` rather than `DO UPDATE`: a brief for a given
 * (instrument, version, session, window) is written once and then left alone, so
 * two workers racing the same job cannot produce two different sentences for the
 * same key. Changing the text is a renderer_version bump, never an overwrite.
 */
export async function insertBrief(client: PoolClient, row: BriefRow): Promise<void> {
  await client.query(
    `INSERT INTO instrument_briefs
       (instrument_id, renderer_version, session_date, window_bucket, brief_text, origin, fact_bundle_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (instrument_id, renderer_version, session_date, window_bucket) DO NOTHING`,
    [
      row.instrumentId,
      row.rendererVersion,
      row.sessionDate,
      row.window,
      row.text,
      row.origin,
      row.factBundleHash,
    ],
  );
}
