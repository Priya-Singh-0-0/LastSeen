import type { Observation } from '@stockwatch/contracts';
import { validateObservation } from './validate.js';
import { isAdmissible } from './selector.js';
import type { Pool, PoolClient } from '../db.js';
import { query } from '../db.js';
import { parseDecimal } from '@stockwatch/contracts';

export { validateObservation, isAdmissible };

/**
 * Normalize pipeline entry point (T15).
 * Validates + selects an observation, returning a result.
 */
export type NormalizeResult =
  | { accepted: true }
  | { accepted: false; reason: string };

/**
 * Full pipeline: fetch the last known price from DB, validate, select.
 */
export async function normalizeObservation(
  client: Pool | PoolClient,
  instrumentId: bigint,
  obs: Observation,
): Promise<NormalizeResult> {
  // Fetch last known price for plausibility check.
  const { rows } = await query<{ price: string }>(
    client,
    `SELECT price FROM instrument_market_state WHERE instrument_id = $1`,
    [instrumentId],
  );
  const lastPrice = rows[0]?.price ? parseDecimal(rows[0].price) : null;

  const validation = validateObservation(obs, lastPrice);
  if (!validation.ok) {
    return { accepted: false, reason: validation.reason };
  }

  if (!isAdmissible(obs)) {
    return { accepted: false, reason: 'selector rejected observation' };
  }

  return { accepted: true };
}
