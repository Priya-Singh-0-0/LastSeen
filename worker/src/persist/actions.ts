import { parseDecimal, type CorporateAction } from '@stockwatch/contracts';
import type { PoolClient } from '../db.js';
import { query } from '../db.js';
import { classifyCorporateAction, type CorporateActionCandidate } from '../adjustment/index.js';

export interface PersistCorporateActionResult {
  readonly action: CorporateAction;
  /** False if this candidate was already recorded — the instrument's version was not touched. */
  readonly isNew: boolean;
}

interface CorporateActionRow {
  action_type: string;
  effective_date: string;
  adjustment_factor: string | null;
  is_supported: boolean;
  version_seq: number;
  source: string;
}

function toDTO(instrumentId: string, row: CorporateActionRow): CorporateAction {
  return {
    instrumentId,
    actionType: row.action_type,
    effectiveDate: row.effective_date as CorporateAction['effectiveDate'],
    isSupported: row.is_supported,
    versionSeq: row.version_seq,
    source: row.source,
    ...(row.adjustment_factor !== null ? { adjustmentFactor: parseDecimal(row.adjustment_factor) } : {}),
  };
}

/**
 * AdjustmentPolicy write side (T33 — INV-12, INV-5). Classifies `candidate`, then writes a
 * `CorporateAction` under a per-instrument row lock with an incrementing `version_seq`, bumping
 * `instruments.corporate_action_version` in lockstep (mirrors the Publisher's `last_published_seq`
 * pattern). Re-ingesting an identical candidate (same instrument/type/date/factor) is a no-op:
 * the existing row is returned and the version counter is not touched (INV-5).
 *
 * Stored checkpoint baselines are never touched here — read-time adjustment only (§F.6).
 */
export async function persistCorporateAction(
  client: PoolClient,
  candidate: CorporateActionCandidate,
): Promise<PersistCorporateActionResult> {
  const classified = classifyCorporateAction(candidate);
  const factorParam = classified.adjustmentFactor ? classified.adjustmentFactor.toFixed(6) : null;

  const { rows: instrumentRows } = await query<{ corporate_action_version: number }>(
    client,
    `SELECT corporate_action_version FROM instruments WHERE id = $1 FOR UPDATE`,
    [candidate.instrumentId],
  );
  if (instrumentRows.length === 0) {
    throw new Error(`instrument not found: ${candidate.instrumentId}`);
  }

  const { rows: existingRows } = await query<CorporateActionRow>(
    client,
    `SELECT action_type, effective_date::text AS effective_date, adjustment_factor, is_supported, version_seq, source
     FROM corporate_actions
     WHERE instrument_id = $1 AND action_type = $2 AND effective_date = $3
       AND adjustment_factor IS NOT DISTINCT FROM $4::NUMERIC`,
    [candidate.instrumentId, candidate.actionType, candidate.effectiveDate, factorParam],
  );
  if (existingRows.length > 0) {
    return { action: toDTO(candidate.instrumentId, existingRows[0]!), isNew: false };
  }

  const nextVersion = instrumentRows[0]!.corporate_action_version + 1;

  const { rows: inserted } = await query<CorporateActionRow>(
    client,
    `INSERT INTO corporate_actions
       (instrument_id, action_type, effective_date, adjustment_factor, is_supported, version_seq, source)
     VALUES ($1, $2, $3, $4::NUMERIC, $5, $6, $7)
     RETURNING action_type, effective_date::text AS effective_date, adjustment_factor, is_supported, version_seq, source`,
    [
      candidate.instrumentId,
      candidate.actionType,
      candidate.effectiveDate,
      factorParam,
      classified.isSupported,
      nextVersion,
      candidate.source,
    ],
  );

  await query(
    client,
    `UPDATE instruments SET corporate_action_version = $1, updated_at = NOW() WHERE id = $2`,
    [nextVersion, candidate.instrumentId],
  );

  return { action: toDTO(candidate.instrumentId, inserted[0]!), isNew: true };
}
