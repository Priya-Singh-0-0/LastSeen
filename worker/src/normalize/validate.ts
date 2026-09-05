import type { Decimal } from '@stockwatch/contracts';
import type { Observation } from '@stockwatch/contracts';

/**
 * Observation validation (T15 — INV-4, INV-13).
 *
 * Gates every observation before it touches the DB.
 * All validation is schema + plausibility — no network, no DB.
 */

/** Maximum clock skew: reject observations more than 5 minutes in the future. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Maximum plausibility ratio: reject prices >10× or <0.1× the last known price. */
const PLAUSIBILITY_RATIO = 10;

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Validate a raw observation before persistence.
 * @param obs       The observation to validate.
 * @param lastPrice The last known price for plausibility check (null = no prior state).
 */
export function validateObservation(
  obs: Observation,
  lastPrice: Decimal | null,
): ValidationResult {
  // price > 0
  if (!obs.price.isPositive()) {
    return { ok: false, reason: 'price must be positive' };
  }

  // timestamp within clock skew
  const now = Date.now();
  if (obs.marketTimestamp > now + CLOCK_SKEW_MS) {
    return {
      ok: false,
      reason: `marketTimestamp is too far in the future: ${obs.marketTimestamp}`,
    };
  }

  // volume non-negative (if present)
  if (obs.volume !== undefined && obs.volume.isNegative()) {
    return { ok: false, reason: 'volume must be non-negative' };
  }

  // plausibility against last known price
  if (lastPrice !== null && lastPrice.isPositive()) {
    const ratio = obs.price.div(lastPrice);
    if (ratio.greaterThan(PLAUSIBILITY_RATIO) || ratio.lessThan(1 / PLAUSIBILITY_RATIO)) {
      return {
        ok: false,
        reason: `price ${obs.price.toFixed()} implausible vs last known ${lastPrice.toFixed()}`,
      };
    }
  }

  return { ok: true };
}
