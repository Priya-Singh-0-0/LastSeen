/**
 * T31 — deterministic personal clause + composition (architecture §F.7 — INV-14, INV-9).
 * Pure functions, no DB, no model.
 */
import { describe, it, expect } from 'vitest';
import { D } from '@stockwatch/contracts';
import { renderPersonalClause } from '../src/explanation/personalTemplate.js';
import { composeExplanation } from '../src/explanation/renderer.js';

describe('T31 — renderPersonalClause', () => {
  it('renders a first-time clause when AWAITING_BASELINE, with no numeric claim', () => {
    const clause = renderPersonalClause({ comparisonStatus: 'AWAITING_BASELINE' });
    expect(clause).not.toMatch(/\d/);
  });

  it('renders a suppression clause when SUPPRESSED_CORPORATE_ACTION, with no percentage', () => {
    const clause = renderPersonalClause({ comparisonStatus: 'SUPPRESSED_CORPORATE_ACTION' });
    expect(clause.toLowerCase()).toContain('corporate action');
    expect(clause).not.toMatch(/%/);
  });

  it('interpolates the percentageChange it was given, verbatim', () => {
    const clause = renderPersonalClause({
      comparisonStatus: 'OK',
      elapsedMs: 3 * 24 * 60 * 60 * 1000,
      percentageChange: D.from('0.0523'),
    });
    expect(clause).toContain('3 days');
    expect(clause).toContain('0.0523');
  });

  it('uses a singular unit for a single elapsed day', () => {
    const clause = renderPersonalClause({
      comparisonStatus: 'OK',
      elapsedMs: 24 * 60 * 60 * 1000,
      percentageChange: D.from('0.01'),
    });
    expect(clause).toContain('1 day ');
    expect(clause).not.toContain('1 days');
  });

  it('renders INSUFFICIENT_HISTORY the same shape as OK (no volatility claim needed)', () => {
    const clause = renderPersonalClause({
      comparisonStatus: 'INSUFFICIENT_HISTORY',
      elapsedMs: 5 * 60 * 60 * 1000,
      percentageChange: D.from('-0.02'),
    });
    expect(clause).toContain('5 hours');
    expect(clause).toContain('-0.02');
  });
});

describe('T31 — composeExplanation', () => {
  it('concatenates the stored shared explanation with the personal clause', () => {
    const composed = composeExplanation({
      topUnseenSharedExplanation: 'Price changed +5.23% from a previous close of 100.00.',
      personalClause: 'Since you last checked 3 days ago, it has moved 0.0523%.',
    });
    expect(composed).toBe(
      'Price changed +5.23% from a previous close of 100.00. Since you last checked 3 days ago, it has moved 0.0523%.',
    );
  });

  it('is just the personal clause when there is no shared explanation to compose with', () => {
    const composed = composeExplanation({
      topUnseenSharedExplanation: null,
      personalClause: 'This is the first time you are seeing this instrument.',
    });
    expect(composed).toBe('This is the first time you are seeing this instrument.');
  });
});
