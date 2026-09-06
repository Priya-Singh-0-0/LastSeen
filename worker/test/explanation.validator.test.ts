import { describe, it, expect } from 'vitest';
import { validateModelBrief } from '../src/explanation/validator.js';

/**
 * The validator is the enforcement point for two non-negotiables (CLAUDE.md, §F.7):
 * the model may not originate a financial number, and it may not give advice.
 * The prompt asks for both; only this module makes them true.
 */

const FACTS = ['3.10', '182.44', '176.95', '2.5', '20', '1,204,338'];

function reasonOf(text: string, facts: readonly string[] = FACTS): string | null {
  const result = validateModelBrief(text, facts);
  return result.ok ? null : result.reason;
}

describe('validateModelBrief — numeric grounding', () => {
  it('accepts prose whose every figure appears in the fact bundle', () => {
    expect(validateModelBrief('Apple closed at 182.44, up 3.10% from 176.95.', FACTS).ok).toBe(true);
  });

  it('accepts a figure whose trailing zeros differ from the bundle formatting', () => {
    // "3.1" and the bundle's "3.10" are the same number; comparison is numeric,
    // not textual, so display formatting is not a rejection reason.
    expect(validateModelBrief('It moved 3.1% over the period.', FACTS).ok).toBe(true);
  });

  it('accepts thousands separators the bundle also carries', () => {
    expect(validateModelBrief('Volume reached 1,204,338 shares.', FACTS).ok).toBe(true);
  });

  it('rejects a figure absent from the fact bundle', () => {
    expect(reasonOf('Apple closed at 182.44, up 4.20% from 176.95.')).toMatch(/ungrounded number: 4.20/);
  });

  it('rejects a re-rounded figure, which is arithmetic the model may not perform', () => {
    expect(reasonOf('Revenue grew 182.4%.')).toMatch(/ungrounded number/);
  });

  it('rejects a spelled-out numeral used as a figure', () => {
    // Spelling a number is the obvious way around a digit scan.
    expect(reasonOf('The price rose twelve percent over the period.')).toMatch(/spelled-out/i);
  });

  it('rejects a spelled-out multiplier', () => {
    expect(reasonOf('Volume was double its usual level.')).toMatch(/spelled-out/i);
  });

  it('allows a spelled numeral that is not quantifying anything', () => {
    expect(validateModelBrief('Apple is one of the largest listed companies.', FACTS).ok).toBe(true);
  });

  it('accepts text with no figures at all', () => {
    // The FIRST_VIEW company description is expected to be number-free.
    expect(validateModelBrief('Datadog sells cloud observability software.', FACTS).ok).toBe(true);
  });
});

describe('validateModelBrief — advisory phrasing', () => {
  const ADVICE = [
    'Investors should buy this stock.',
    'This looks like a good time to sell.',
    'Hold the position for now.',
    'The shares appear undervalued.',
    'The stock is overvalued at this level.',
    'This presents a compelling opportunity.',
    'Sentiment is bullish.',
    'Analysts are bearish on the name.',
    'We recommend accumulating shares.',
    'Consider adding to your position.',
    'Our price target is 182.44.',
  ];

  for (const text of ADVICE) {
    it(`rejects: ${text}`, () => {
      expect(reasonOf(text)).toMatch(/advisory/i);
    });
  }
});

describe('validateModelBrief — predictive phrasing', () => {
  const PREDICTIONS = [
    'The price will rise from here.',
    'We expect further weakness.',
    'A rebound is likely.',
    'The stock is poised for a breakout.',
    'Shares are set to continue climbing.',
    'This should continue into next quarter.',
  ];

  for (const text of PREDICTIONS) {
    it(`rejects: ${text}`, () => {
      expect(reasonOf(text)).toMatch(/predictive|advisory/i);
    });
  }
});

describe('validateModelBrief — causal phrasing', () => {
  // §F.7 rejects causal claims, and the system ingests no news, so any asserted
  // cause is invented. Adjacency is not offered here either: the scoped product
  // surface is "price now vs. price before", not "why".
  const CAUSAL = [
    'The price fell because of weak guidance.',
    'Shares dropped due to the earnings miss.',
    'The move was driven by heavy selling.',
    'The decline was caused by a downgrade.',
    'Shares rose on the back of strong demand.',
  ];

  for (const text of CAUSAL) {
    it(`rejects: ${text}`, () => {
      expect(reasonOf(text)).toMatch(/causal/i);
    });
  }
});

describe('validateModelBrief — elapsed time is measured in days', () => {
  // The span a brief describes is how long since the stock was last opened,
  // which is wall-clock. "2 sessions" and "2 days" differ across a weekend.
  const SESSIONS = [
    'The price rose over the last 2 sessions.',
    'It closed within its 20-session range.',
    'The stock fell during the trading session.',
  ];

  for (const text of SESSIONS) {
    it(`rejects: ${text}`, () => {
      expect(reasonOf(text, [...FACTS, '2'])).toMatch(/trading-session vocabulary/i);
    });
  }

  it('accepts the same statement phrased in days', () => {
    expect(validateModelBrief('The price rose 3.10% over the last 20 days.', FACTS).ok).toBe(true);
  });
});

describe('validateModelBrief — shape', () => {
  it('rejects empty output', () => {
    expect(reasonOf('   ')).toMatch(/empty/i);
  });

  it('rejects output longer than the character budget', () => {
    expect(reasonOf('Apple is a listed company. '.repeat(40))).toMatch(/too long/i);
  });

  it('rejects more sentences than the budget allows', () => {
    expect(reasonOf('One. Two. Three. Four. Five.')).toMatch(/too many sentences/i);
  });

  it('rejects second person, which is shared copy addressing no one in particular', () => {
    expect(reasonOf('You are looking at a software company.')).toMatch(/second person/i);
  });

  it('rejects a fenced or prefixed model preamble', () => {
    expect(reasonOf('Here is the brief: Apple makes phones.')).toMatch(/preamble/i);
  });
});
