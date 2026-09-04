import type { Pool, PoolClient } from '../db.js';
import { query } from '../db.js';
import { D, parseDecimal, toSessionDate, type Decimal, type CorporateAction } from '@stockwatch/contracts';

/**
 * AdjustmentPolicy read side (T26 — INV-12).
 * Split math itself (multiplying supported factors into a baseline) arrives in T33/T34;
 * this only has to prove the identity case and unsupported-action detection.
 */
export interface AdjustmentResult {
  readonly factor: Decimal;
  readonly hasUnsupportedAction: boolean;
  readonly actions: readonly CorporateAction[];
}

interface CorporateActionRow {
  instrument_id: string;
  action_type: string;
  effective_date: string;
  adjustment_factor: string | null;
  is_supported: boolean;
  version_seq: number;
  source: string;
}

/**
 * Reads corporate_actions for `instrumentId` with `version_seq` in `(fromVersion, toVersion]`
 * and returns the combined adjustment factor plus whether any action in range is unsupported.
 * With no actions in range, returns the identity: factor 1, no unsupported action.
 */
export async function factorBetween(
  client: Pool | PoolClient,
  instrumentId: string,
  fromVersion: number,
  toVersion: number,
): Promise<AdjustmentResult> {
  const { rows } = await query<CorporateActionRow>(
    client,
    `SELECT
       instrument_id,
       action_type,
       effective_date::text AS effective_date,
       adjustment_factor,
       is_supported,
       version_seq,
       source
     FROM corporate_actions
     WHERE instrument_id = $1 AND version_seq > $2 AND version_seq <= $3
     ORDER BY version_seq ASC`,
    [instrumentId, fromVersion, toVersion],
  );

  let factor = D.one();
  let hasUnsupportedAction = false;
  const actions: CorporateAction[] = [];

  for (const row of rows) {
    if (!row.is_supported) {
      hasUnsupportedAction = true;
    } else if (row.adjustment_factor !== null) {
      factor = D.mul(factor, parseDecimal(row.adjustment_factor));
    }
    const action: CorporateAction = {
      instrumentId: row.instrument_id,
      actionType: row.action_type,
      effectiveDate: toSessionDate(row.effective_date),
      isSupported: row.is_supported,
      versionSeq: row.version_seq,
      source: row.source,
      ...(row.adjustment_factor !== null ? { adjustmentFactor: parseDecimal(row.adjustment_factor) } : {}),
    };
    actions.push(action);
  }

  return { factor, hasUnsupportedAction, actions };
}
