/**
 * Output validator for the ModelRenderer (architecture §F.7).
 *
 * The prompt asks the model to stay grounded and neutral; this module is what
 * makes it true. Two rules here are product invariants, not preferences:
 *
 *   1. "LLMs never calculate or originate financial facts" (CLAUDE.md). Every
 *      figure in the output must already appear in the fact bundle the renderer
 *      was given. A number the model produced by arithmetic, by re-rounding, or
 *      from its own memory is a rejection.
 *   2. No buy/sell suggestion, in any phrasing, ever.
 *
 * A rejection is not an error path — it means the deterministic template is used
 * instead, which is always correct. The validator is therefore deliberately
 * biased toward false rejections: losing a well-written sentence costs polish,
 * letting one through costs the product promise.
 */

/** Prose budget for a brief. Roughly two full sentences of financial copy. */
const MAX_CHARS = 400;
const MAX_SENTENCES = 3;

export type BriefValidation = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const OK: BriefValidation = { ok: true };
const fail = (reason: string): BriefValidation => ({ ok: false, reason });

/**
 * Conversational scaffolding around the answer. Cheap to detect and always
 * wrong: the brief is inserted into a UI verbatim, so a preamble would render.
 */
const PREAMBLE = /^\s*(?:```|here(?:'s| is)\b|sure\b|certainly\b|of course\b|okay\b|ok\b|brief:|answer:)/i;

const SECOND_PERSON = /\b(?:you|your|yours|yourself)\b/i;

/**
 * Briefs measure elapsed time in calendar days, because the span they describe
 * is how long it has been since someone last opened the stock — and that is
 * wall-clock time. "Two sessions" and "two days" name different spans across a
 * weekend, so trading-session vocabulary is rejected rather than trusted to the
 * prompt.
 */
const SESSION_VOCABULARY = /\b(?:trading[- ])?sessions?\b/i;

/**
 * Advisory vocabulary. This list is the enforcement of the product's hardest
 * constraint, so it errs wide — "position", "target" and "hold" have innocent
 * uses that are simply not worth the risk of the guilty ones.
 */
const ADVISORY = [
  /\bbuy(?:ing)?\b/i,
  /\bsell(?:ing)?\b/i,
  /\bhold\b/i,
  /\baccumulat(?:e|ing)\b/i,
  /\bdivest\b/i,
  /\brecommend(?:ed|ation|s)?\b/i,
  /\badvis(?:e|ed|able|ory)\b/i,
  /\bshould\b/i,
  /\bconsider\b/i,
  /\bunder-?valued\b/i,
  /\bover-?valued\b/i,
  /\b(?:cheap|expensive)\b/i,
  /\bbargain\b/i,
  /\bopportunit(?:y|ies)\b/i,
  /\bbull(?:ish)?\b/i,
  /\bbear(?:ish)?\b/i,
  /\b(?:price )?target\b/i,
  /\bposition\b/i,
  /\bportfolio\b/i,
  /\bentry point\b/i,
  /\boutperform|underperform\b/i,
  /\bworth (?:a look|buying|owning)\b/i,
];

/** Forward-looking claims. The system forecasts nothing; neither may its copy. */
const PREDICTIVE = [
  /\bwill\b/i,
  /\bwon't\b/i,
  /\bexpect(?:s|ed|ation|ations)?\b/i,
  /\banticipat(?:e|es|ed)\b/i,
  /\bforecast(?:s|ed)?\b/i,
  /\bproject(?:s|ed|ion|ions)\b/i,
  /\blikely\b/i,
  /\bunlikely\b/i,
  /\bpoised\b/i,
  /\bset to\b/i,
  /\bgoing forward\b/i,
  /\bnear-?term outlook\b/i,
  /\bcould (?:rise|fall|climb|drop|continue)\b/i,
];

/**
 * Asserted causes. The system ingests no news, so any cause the model names is
 * invented — a fluent, plausible, unfalsifiable fabrication. §F.7 rejects the
 * category outright rather than trying to tell good causes from bad ones.
 */
const CAUSAL = [
  /\bbecause\b/i,
  /\bdue to\b/i,
  /\bdriven by\b/i,
  /\bcaused by\b/i,
  /\bon the back of\b/i,
  /\bas a result of\b/i,
  /\bthanks to\b/i,
  /\bowing to\b/i,
  /\bprompted by\b/i,
  /\battributabl[ey] to\b/i,
  /\breflect(?:s|ing)? (?:concerns|optimism|fears)\b/i,
];

/**
 * Spelled numerals are how a figure evades a digit scan. Only flagged when
 * quantifying something — "one of the largest" is prose, "twelve percent" is an
 * ungrounded number wearing a disguise.
 */
const NUMBER_WORD =
  '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|trillion)';
const UNIT_NOUN =
  '(?:percent|per cent|points?|sessions?|days?|weeks?|months?|years?|quarters?|times|fold|dollars?|cents?|shares?)';
const SPELLED_QUANTITY = new RegExp(`\\b${NUMBER_WORD}[- ]${UNIT_NOUN}\\b`, 'i');

/** Multipliers that state a magnitude on their own, with no unit noun to anchor them. */
const SPELLED_MULTIPLIER = /\b(?:doubl(?:e|ed|ing)|tripl(?:e|ed|ing)|quadrupl(?:e|ed)|halv(?:e|ed)|half)\b/i;

/** Digit runs, with optional sign, thousands separators, and decimal part. */
const NUMERIC_TOKEN = /-?\d[\d,]*(?:\.\d+)?/g;

function parseToken(token: string): number {
  return Number(token.replace(/,/g, ''));
}

/**
 * Numbers the output is permitted to contain. Both the signed value and its
 * magnitude are allowed: a bundle carrying "-3.10" must not reject the sentence
 * "fell 3.10%", where direction is carried by the verb rather than by a sign.
 * Direction is kept honest by handing the model an explicit direction fact, not
 * by sign-checking here.
 */
function allowedNumbers(factStrings: readonly string[]): Set<number> {
  const allowed = new Set<number>();
  for (const fact of factStrings) {
    for (const token of fact.match(NUMERIC_TOKEN) ?? []) {
      const value = parseToken(token);
      if (!Number.isNaN(value)) {
        allowed.add(value);
        allowed.add(Math.abs(value));
      }
    }
  }
  return allowed;
}

function countSentences(text: string): number {
  // Splits only on terminators followed by whitespace or end-of-string, so the
  // decimal point in "182.44" is not a sentence boundary.
  return text.split(/[.!?]+(?=\s|$)/).filter((s) => s.trim().length > 0).length;
}

function firstMatch(patterns: readonly RegExp[], text: string): string | null {
  for (const pattern of patterns) {
    const m = pattern.exec(text);
    if (m) return m[0];
  }
  return null;
}

/**
 * Validates one model-produced brief against the fact bundle it was rendered
 * from. `factStrings` are the already-formatted values handed to the model —
 * the only numbers the output may contain.
 */
export function validateModelBrief(text: string, factStrings: readonly string[]): BriefValidation {
  const trimmed = text.trim();

  if (trimmed.length === 0) return fail('empty output');
  if (PREAMBLE.test(trimmed)) return fail('model preamble in output');
  if (trimmed.length > MAX_CHARS) return fail(`too long: ${trimmed.length} > ${MAX_CHARS} chars`);

  const sentences = countSentences(trimmed);
  if (sentences > MAX_SENTENCES) return fail(`too many sentences: ${sentences} > ${MAX_SENTENCES}`);

  const causal = firstMatch(CAUSAL, trimmed);
  if (causal) return fail(`causal phrasing: "${causal}"`);

  const advisory = firstMatch(ADVISORY, trimmed);
  if (advisory) return fail(`advisory phrasing: "${advisory}"`);

  const predictive = firstMatch(PREDICTIVE, trimmed);
  if (predictive) return fail(`predictive phrasing: "${predictive}"`);

  const secondPerson = SECOND_PERSON.exec(trimmed);
  if (secondPerson) return fail(`second person: "${secondPerson[0]}"`);

  const sessionWord = SESSION_VOCABULARY.exec(trimmed);
  if (sessionWord) return fail(`trading-session vocabulary: "${sessionWord[0]}" — briefs measure days`);

  const spelledQuantity = SPELLED_QUANTITY.exec(trimmed);
  if (spelledQuantity) return fail(`spelled-out quantity: "${spelledQuantity[0]}"`);

  const spelledMultiplier = SPELLED_MULTIPLIER.exec(trimmed);
  if (spelledMultiplier) return fail(`spelled-out multiplier: "${spelledMultiplier[0]}"`);

  const allowed = allowedNumbers(factStrings);
  for (const token of trimmed.match(NUMERIC_TOKEN) ?? []) {
    if (!allowed.has(parseToken(token))) return fail(`ungrounded number: ${token}`);
  }

  return OK;
}
