import type { Observation } from '@stockwatch/contracts';

/**
 * ObservationSelector v1 (T15).
 *
 * Accepts any observation that passes validation ("accept if admissible").
 * This is a seam — a more sophisticated selector (hysteresis, episode revision)
 * is deferred (§7). The implementation must not grow beyond this policy.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature reserved for a future selector policy (§7 seam)
export function isAdmissible(_obs: Observation): boolean {
  // v1: unconditional accept after validation passes.
  return true;
}
