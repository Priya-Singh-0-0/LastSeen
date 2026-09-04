/**
 * Explanation composer (T31, architecture §F.7 — INV-14).
 * Concatenates the worker-rendered shared sentence (stored once per ChangeRecord,
 * never recomputed here) with the API's deterministic personal clause. Pure, no
 * arithmetic, no model.
 */
export interface ComposeExplanationInput {
  /** The dominant unseen change record's stored shared_explanation, or null if none unseen. */
  readonly topUnseenSharedExplanation: string | null;
  readonly personalClause: string;
}

export function composeExplanation(input: ComposeExplanationInput): string {
  return input.topUnseenSharedExplanation
    ? `${input.topUnseenSharedExplanation} ${input.personalClause}`
    : input.personalClause;
}
