import type { Decimal, SessionDate } from '@stockwatch/contracts';

/**
 * AdjustmentPolicy — split detection and classification (T33 — INV-12, INV-5).
 *
 * A candidate corporate action as observed this cycle, not yet versioned or persisted.
 * `versionSeq`/`isSupported` are assigned by the write side (`persist/actions.ts`), never here.
 */
export interface CorporateActionCandidate {
  readonly instrumentId: string;
  readonly actionType: string;
  readonly effectiveDate: SessionDate;
  readonly adjustmentFactor?: Decimal;
  readonly source: string;
}

/** Only SPLIT, with a factor present, is supported in v1 (architecture §D, §F.6). */
const SUPPORTED_ACTION_TYPES: ReadonlySet<string> = new Set(['SPLIT']);

/**
 * Classifies a raw candidate into supported/unsupported. Unsupported actions carry
 * no factor — never guessed (§F.6: "say cannot compare, never guess").
 */
export function classifyCorporateAction(
  candidate: CorporateActionCandidate,
): { isSupported: boolean; adjustmentFactor?: Decimal } {
  if (SUPPORTED_ACTION_TYPES.has(candidate.actionType) && candidate.adjustmentFactor) {
    return { isSupported: true, adjustmentFactor: candidate.adjustmentFactor };
  }
  return { isSupported: false };
}
