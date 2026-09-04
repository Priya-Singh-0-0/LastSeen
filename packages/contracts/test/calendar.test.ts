import { describe, it, expect } from 'vitest';
import { toUtcTimestamp, toSessionDate } from '../src/time.js';
import { countSessions, getEasternSessionDate, isWeekend } from '../src/calendar.js';

describe('calendar', () => {
  const holidays = [
    toSessionDate('2024-01-01'),
    toSessionDate('2024-07-04'),
    toSessionDate('2024-11-28'),
    toSessionDate('2024-12-25'),
  ];

  describe('getEasternSessionDate', () => {
    it('converts UTC correctly for EST', () => {
      // 2024-01-15 01:00:00 UTC is 2024-01-14 20:00:00 EST
      const ts = toUtcTimestamp(Date.UTC(2024, 0, 15, 1, 0, 0));
      expect(getEasternSessionDate(ts)).toBe('2024-01-14');
    });

    it('converts UTC correctly for EDT', () => {
      // 2024-07-15 01:00:00 UTC is 2024-07-14 21:00:00 EDT
      const ts = toUtcTimestamp(Date.UTC(2024, 6, 15, 1, 0, 0));
      expect(getEasternSessionDate(ts)).toBe('2024-07-14');
    });
  });

  describe('isWeekend', () => {
    it('identifies Saturday and Sunday', () => {
      expect(isWeekend('2024-07-12')).toBe(false); // Friday
      expect(isWeekend('2024-07-13')).toBe(true);  // Saturday
      expect(isWeekend('2024-07-14')).toBe(true);  // Sunday
      expect(isWeekend('2024-07-15')).toBe(false); // Monday
    });
  });

  describe('countSessions', () => {
    it('returns 0 for same-day span', () => {
      // Both timestamps fall on the same Eastern date
      const start = toUtcTimestamp(Date.UTC(2024, 6, 15, 14, 0, 0)); // 10:00 AM EDT
      const end = toUtcTimestamp(Date.UTC(2024, 6, 15, 16, 0, 0));   // 12:00 PM EDT
      expect(countSessions(start, end, holidays)).toBe(0);
    });

    it('counts a regular weekday span correctly', () => {
      // Tuesday to Thursday = 2 sessions (Wednesday, Thursday)
      const start = toUtcTimestamp(Date.UTC(2024, 6, 16, 14, 0, 0)); // Tuesday
      const end = toUtcTimestamp(Date.UTC(2024, 6, 18, 14, 0, 0));   // Thursday
      expect(countSessions(start, end, holidays)).toBe(2);
    });

    it('handles weekend spans correctly', () => {
      // Friday to Monday = 1 session (Monday)
      const start = toUtcTimestamp(Date.UTC(2024, 6, 12, 14, 0, 0)); // Friday
      const end = toUtcTimestamp(Date.UTC(2024, 6, 15, 14, 0, 0));   // Monday
      expect(countSessions(start, end, holidays)).toBe(1);

      // Saturday to Sunday = 0 sessions
      const start2 = toUtcTimestamp(Date.UTC(2024, 6, 13, 14, 0, 0)); // Saturday
      const end2 = toUtcTimestamp(Date.UTC(2024, 6, 14, 14, 0, 0));   // Sunday
      expect(countSessions(start2, end2, holidays)).toBe(0);
    });

    it('handles holiday spans correctly', () => {
      // July 3 (Wed) to July 5 (Fri) with July 4 as holiday = 1 session (Friday)
      const start = toUtcTimestamp(Date.UTC(2024, 6, 3, 14, 0, 0));
      const end = toUtcTimestamp(Date.UTC(2024, 6, 5, 14, 0, 0));
      expect(countSessions(start, end, holidays)).toBe(1);
    });

    it('handles a span crossing a DST boundary (Spring Forward)', () => {
      // DST starts Sunday, March 10, 2024
      // Friday March 8 to Monday March 11 = 1 session (Monday)
      const start = toUtcTimestamp(Date.UTC(2024, 2, 8, 14, 0, 0)); // Friday
      const end = toUtcTimestamp(Date.UTC(2024, 2, 11, 14, 0, 0));  // Monday
      expect(countSessions(start, end, holidays)).toBe(1);
    });

    it('handles a span crossing a DST boundary (Fall Back)', () => {
      // DST ends Sunday, November 3, 2024
      // Friday November 1 to Monday November 4 = 1 session (Monday)
      const start = toUtcTimestamp(Date.UTC(2024, 10, 1, 14, 0, 0)); // Friday
      const end = toUtcTimestamp(Date.UTC(2024, 10, 4, 14, 0, 0));  // Monday
      expect(countSessions(start, end, holidays)).toBe(1);
    });

    it('returns negative count if start > end', () => {
      const start = toUtcTimestamp(Date.UTC(2024, 6, 18, 14, 0, 0)); // Thursday
      const end = toUtcTimestamp(Date.UTC(2024, 6, 16, 14, 0, 0));   // Tuesday
      expect(countSessions(start, end, holidays)).toBe(-2);
    });
  });
});
