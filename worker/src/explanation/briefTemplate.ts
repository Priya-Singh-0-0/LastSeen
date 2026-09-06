import type { BriefFacts } from './factBundle.js';

/**
 * DeterministicTemplateRenderer for briefs (architecture §F.7, the "always
 * available, cannot fail" arm). Interpolates already-formatted values from the
 * bundle verbatim — no arithmetic, no model, no personal data.
 *
 * This is what the user sees whenever the model is unconfigured, slow, or
 * wrong, so it has to read acceptably on its own rather than as a degraded
 * placeholder. Its output is also held to the same validator as the model's,
 * which is asserted in the tests: a fallback that would itself be rejected is
 * not a fallback.
 */

function value(facts: BriefFacts, label: string): string {
  const found = facts.values.find(([l]) => l === label);
  if (!found) throw new Error(`brief fact bundle is missing "${label}"`);
  return found[1];
}

export function renderBriefTemplate(facts: BriefFacts): string {
  const lastClose = value(facts, 'last close');
  const changePct = value(facts, 'percent change');
  const high = value(facts, '30-day high');
  const low = value(facts, '30-day low');
  const range = `Across the last 30 days it has traded between ${low} and ${high}.`;

  if (facts.lookbackDays === null) {
    const priorClose = value(facts, 'prior close');
    const name = facts.companyName ?? facts.symbol;
    const move =
      facts.direction === 'was unchanged'
        ? `closed unchanged at ${lastClose}`
        : `closed at ${lastClose}, ${facts.direction} ${changePct}% from a prior close of ${priorClose}`;
    return `${name} (${facts.symbol}) ${move}. ${range}`;
  }

  const pastClose = value(facts, `close ${facts.lookbackDays} days earlier`);
  const days = `${facts.lookbackDays} day${facts.lookbackDays === 1 ? '' : 's'}`;
  const move =
    facts.direction === 'was unchanged'
      ? `is unchanged at ${lastClose} over the last ${days}`
      : `${facts.direction} ${changePct}% over the last ${days}, from ${pastClose} to ${lastClose}`;
  return `${facts.symbol} ${move}. ${range}`;
}
