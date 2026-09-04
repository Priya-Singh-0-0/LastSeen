import type { PoolClient } from '../db.js';
import type { SignalEvidence } from '@stockwatch/contracts';

export * from './dedupe.js';
export * from './detectors.js';

/**
 * Persist detected signals (T21). Idempotent: re-running the same detector
 * output for the same (instrument_id, detector_version, dedupe_key) updates
 * the existing row rather than duplicating it.
 */
export async function persistSignals(
  client: PoolClient,
  instrumentId: string,
  signals: readonly SignalEvidence[],
): Promise<number> {
  if (signals.length === 0) return 0;

  const instrumentIds = signals.map(() => instrumentId);
  const signalTypes = signals.map((s) => s.signalType);
  const detectorVersions = signals.map((s) => s.detectorVersion);
  const dedupeKeys = signals.map((s) => s.dedupeKey);
  const evidenceJson = signals.map((s) => JSON.stringify(s.evidence));
  const marketTimestamps = signals.map((s) => new Date(s.marketTimestamp).toISOString());

  const query = `
    INSERT INTO instrument_signals (
      instrument_id, signal_type, detector_version, dedupe_key, evidence, market_timestamp
    )
    SELECT
      u.instrument_id::BIGINT,
      u.signal_type::signal_type,
      u.detector_version::INT,
      u.dedupe_key,
      u.evidence::JSONB,
      u.market_timestamp::TIMESTAMPTZ
    FROM UNNEST(
      $1::TEXT[], $2::TEXT[], $3::INT[], $4::TEXT[], $5::TEXT[], $6::TEXT[]
    ) AS u(
      instrument_id, signal_type, detector_version, dedupe_key, evidence, market_timestamp
    )
    ON CONFLICT (instrument_id, detector_version, dedupe_key) DO UPDATE SET
      evidence = EXCLUDED.evidence,
      market_timestamp = EXCLUDED.market_timestamp
  `;

  const { rowCount } = await client.query(query, [
    instrumentIds,
    signalTypes,
    detectorVersions,
    dedupeKeys,
    evidenceJson,
    marketTimestamps,
  ]);

  return rowCount ?? 0;
}
