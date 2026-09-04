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

  it('interpolates the exact sessionsElapsed and percentageChange it was given, verbatim', () => {
    const clause = renderPersonalClause({
      comparisonStatus: 'OK',
      sessionsElapsed: 3,
      percentageChange: D.from('0.0523'),
    });
    expect(clause).toContain('3');
    expect(clause).toContain('0.0523');
  });

  it('uses singular "session" for a single elapsed session', () => {
    const clause = renderPersonalClause({
      comparisonStatus: 'OK',
      sessionsElapsed: 1,
      percentageChange: D.from('0.01'),
    });
    expect(clause).toContain('1 session ');
    expect(clause).not.toContain('1 sessions');
  });

  it('renders INSUFFICIENT_HISTORY the same shape as OK (no volatility claim needed)', () => {
    const clause = renderPersonalClause({
      comparisonStatus: 'INSUFFICIENT_HISTORY',
      sessionsElapsed: 5,
      percentageChange: D.from('-0.02'),
    });
    expect(clause).toContain('5');
    expect(clause).toContain('-0.02');
  });
});

describe('T31 — composeExplanation', () => {
  it('concatenates the stored shared explanation with the personal clause', () => {
    const composed = composeExplanation({
      topUnseenSharedExplanation: 'Price changed +5.23% from a previous close of 100.00.',
      personalClause: 'Since you last checked 3 sessions ago, it has moved 0.0523.',
    });
    expect(composed).toBe(
      'Price changed +5.23% from a previous close of 100.00. Since you last checked 3 sessions ago, it has moved 0.0523.',
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
