import { describe, it, expect } from 'vitest';
import { SignalType, toSessionDate, toUtcTimestamp, type SignalEvidence } from '@stockwatch/contracts';
import { renderSharedExplanation, RENDERER_VERSION } from '../src/explanation/template.js';

const sessionDate = toSessionDate('2024-07-02');
const marketTimestamp = toUtcTimestamp(Date.parse('2024-07-02T16:00:00Z'));

function makeEvidence(
  signalType: SignalType,
  evidence: Record<string, string | boolean>,
  dedupeKey = 'k',
): SignalEvidence {
  return {
    signalType,
    detectorVersion: 1,
    dedupeKey,
    marketTimestamp,
    sessionDate,
    evidence,
  };
}

const FORBIDDEN_PATTERNS = [
  /\bbecause\b/i,
  /\bdue to\b/i,
  /\bwill\b/i,
  /\bshould\b/i,
  /\bexpect(s|ed)?\b/i,
  /\blikely\b/i,
  /\bpredict(s|ed|ion)?\b/i,
  /\brecommend(s|ed|ation)?\b/i,
];

const rangeBreakout = makeEvidence(SignalType.RANGE_BREAKOUT, {
  close: '150.500000',
  high20: '140.250000',
  low20: '120.000000',
  direction: 'above',
  window: '20',
});

const abnormalVolume = makeEvidence(SignalType.ABNORMAL_VOLUME, {
  volume: '9000000',
  volume_median20: '2000000',
  ratio: '4.500000',
});

describe('renderSharedExplanation (T25 shared template explanation)', () => {
  it('interpolates only values already present in the fact bundle, verbatim', () => {
    const text = renderSharedExplanation([rangeBreakout]);

    for (const value of Object.values(rangeBreakout.evidence)) {
      expect(text).toContain(String(value));
    }
  });

  it('contains no causal, predictive, or advisory phrasing', () => {
    const text = renderSharedExplanation([rangeBreakout, abnormalVolume]);

    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(text).not.toMatch(pattern);
    }
  });

  it('renders the same record identically twice', () => {
    const first = renderSharedExplanation([rangeBreakout, abnormalVolume]);
    const second = renderSharedExplanation([rangeBreakout, abnormalVolume]);

    expect(first).toBe(second);
  });

  it('is stamped with a stable renderer version', () => {
    expect(RENDERER_VERSION).toBe(1);
  });
});
