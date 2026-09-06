import { describe, it, expect } from 'vitest';
import { BriefWindow, ComparisonStatus } from '@stockwatch/contracts';
import { briefWindowFor } from '../src/explanation/brief.js';

const DAY = 24 * 60 * 60 * 1000;

/**
 * The bucket is the only thing about a user's timing that ever leaves the API,
 * so what matters here is that it is coarse, total, and never leaks a precise
 * elapsed time.
 */
describe('briefWindowFor', () => {
  it('treats an unestablished baseline as the first-view surface', () => {
    expect(briefWindowFor(ComparisonStatus.AWAITING_BASELINE, 40 * DAY)).toBe(BriefWindow.FIRST_VIEW);
  });

  it('treats a missing elapsed time as the first-view surface', () => {
    expect(briefWindowFor(ComparisonStatus.OK, undefined)).toBe(BriefWindow.FIRST_VIEW);
  });

  it.each([
    [0, BriefWindow.D1],
    [1, BriefWindow.D1],
    [1.9, BriefWindow.D1],
    [2, BriefWindow.D2],
    [3.5, BriefWindow.D2],
    [4, BriefWindow.W1],
    [7, BriefWindow.W1],
    [13.9, BriefWindow.W1],
    [14, BriefWindow.M1],
    [365, BriefWindow.M1],
  ])('rounds %s days down to %s', (days, expected) => {
    expect(briefWindowFor(ComparisonStatus.OK, days * DAY)).toBe(expected);
  });

  it('buckets a suppressed comparison rather than falling through', () => {
    // A suppressed corporate action still has a real elapsed time; the brief is
    // shared market copy and does not depend on the comparison being usable.
    expect(briefWindowFor(ComparisonStatus.SUPPRESSED_CORPORATE_ACTION, 3 * DAY)).toBe(BriefWindow.D2);
  });

  it('collapses distinct elapsed times within a bucket to the same value', () => {
    const a = briefWindowFor(ComparisonStatus.OK, 4.1 * DAY);
    const b = briefWindowFor(ComparisonStatus.OK, 13.4 * DAY);
    expect(a).toBe(b);
  });
});
