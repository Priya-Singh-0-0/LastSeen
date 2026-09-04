import { describe, it, expect } from 'vitest';

// Trivial test proving the web vitest harness is wired up (T1).
describe('web smoke (T1)', () => {
  it('true is true', () => {
    expect(true).toBe(true);
  });
});
