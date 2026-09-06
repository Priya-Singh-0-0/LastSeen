import { createHash } from 'node:crypto';
import { renderBriefTemplate } from './briefTemplate.js';
import { factStrings, type BriefFacts } from './factBundle.js';
import type { GeminiClient } from './gemini.js';
import { validateModelBrief } from './validator.js';

/**
 * ModelRenderer (architecture §F.7).
 *
 * Bump this rather than editing history when the prompt, the validator, or the
 * fact bundle changes: briefs are cached by (subject, renderer_version), so a
 * bump produces new rows and leaves prior text intact — the same discipline as
 * assembly_version and detector_version.
 */
export const BRIEF_RENDERER_VERSION = 2;

export type BriefOrigin = 'model' | 'template';

export interface RenderedBrief {
  readonly text: string;
  readonly origin: BriefOrigin;
  readonly factBundleHash: string;
  /** Why the model's output was not used, when it wasn't. Logged, never displayed. */
  readonly fallbackReason?: string;
}

const SYSTEM_INSTRUCTION = `You write one short, neutral factual note about a listed company's recent share price for a stock-tracking app.

Absolute rules:
- Use ONLY the figures given to you, copied exactly as written. Never compute, combine, round, or infer any number. Never introduce a number that is not in the list.
- Never suggest buying, selling, or holding anything. Never say whether the price is high, low, cheap, expensive, attractive, or a good or bad sign.
- Never predict or imply what the price will do next.
- Never state or imply a reason or cause for a price move. You have no news, so any cause you name would be invented.
- Do not address the reader. No "you", no "your".
- Output the note only. No preamble, no quotes, no markdown, no bullet points.
- At most two sentences.`;

function buildPrompt(facts: BriefFacts): string {
  const figures = facts.values.map(([label, value]) => `- ${label}: ${value}`).join('\n');
  const company = facts.companyName ? `${facts.companyName} (${facts.symbol})` : facts.symbol;
  const listing = facts.exchange ? `, listed on ${facts.exchange}` : '';

  if (facts.lookbackDays === null) {
    return `Company: ${company}${listing}
The price ${facts.direction} against the prior close.

Figures you may use:
${figures}

Write two sentences. The first says plainly what this company does, in general business terms, with no numbers and no judgement about the business. The second states where the share price closed and how it compares with the prior close and the 30-day trading range, using only the figures above.`;
  }

  return `Company: ${company}${listing}
The price ${facts.direction} over the last ${facts.lookbackDays} days.

Figures you may use:
${figures}

Write one or two sentences describing how the share price now compares with where it was ${facts.lookbackDays} days ago, and where it sits in the 30-day trading range. Measure time in days, never in trading sessions. Use only the figures above. Do not say why it moved.`;
}

/** Stable digest of exactly the values the output was permitted to contain. */
function hashFacts(facts: BriefFacts): string {
  const canonical = JSON.stringify({
    window: facts.window,
    symbol: facts.symbol,
    direction: facts.direction,
    values: facts.values,
    spans: facts.spans,
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

/**
 * Renders one brief. The template is produced first and unconditionally, so
 * there is always a correct answer before the network is touched; the model can
 * only ever upgrade it.
 *
 * Passing `client: null` (no GEMINI_API_KEY configured) is a supported steady
 * state, not a degraded one — the app runs template-only with no model at all.
 *
 * This function does not throw. Architecture test #14
 * (`explanation_renderer_falls_back`) is the contract: a throw, a timeout, or a
 * validation failure all resolve to the template.
 */
export async function renderBrief(
  facts: BriefFacts,
  client: GeminiClient | null,
): Promise<RenderedBrief> {
  const template = renderBriefTemplate(facts);
  const factBundleHash = hashFacts(facts);

  if (!client) {
    return { text: template, origin: 'template', factBundleHash, fallbackReason: 'no model configured' };
  }

  let candidate: string;
  try {
    candidate = await client.generate(SYSTEM_INSTRUCTION, buildPrompt(facts));
  } catch (err) {
    return {
      text: template,
      origin: 'template',
      factBundleHash,
      fallbackReason: `model call failed: ${(err as Error).message}`,
    };
  }

  const verdict = validateModelBrief(candidate, factStrings(facts));
  if (!verdict.ok) {
    return {
      text: template,
      origin: 'template',
      factBundleHash,
      fallbackReason: `validation failed: ${verdict.reason}`,
    };
  }

  return { text: candidate, origin: 'model', factBundleHash };
}
