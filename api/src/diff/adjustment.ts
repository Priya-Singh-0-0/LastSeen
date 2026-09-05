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
  /** One label per supported SPLIT action in range, e.g. "adjusted for 4-for-1 split" (T34, INV-12). */
  readonly splitLabels: readonly string[];
}

/**
 * "adjusted for 4-for-1 split" style label for a single supported split action — the label is
 * what makes the read-time baseline adjustment visible rather than a silent number swap.
 * `factor` is new-price/old-price (0.25 for a 4-for-1 split); the ratio is derived from it, never
 * stored separately, so it can't drift from the number actually multiplied into the baseline.
 */
export function describeSplit(action: CorporateAction): string | null {
  if (action.actionType !== 'SPLIT' || !action.isSupported || action.adjustmentFactor === undefined) {
    return null;
  }
  const factor = action.adjustmentFactor;
  if (D.lte(factor, D.zero())) {
    return null;
  }
  if (D.lte(factor, D.one())) {
    const ratio = D.div(D.one(), factor).toFixed(0);
    return `adjusted for ${ratio}-for-1 split`;
  }
  const ratio = factor.toFixed(0);
  return `adjusted for 1-for-${ratio} split`;
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

  const splitLabels = actions.map(describeSplit).filter((label): label is string => label !== null);

  return { factor, hasUnsupportedAction, actions, splitLabels };
}
