import { UtcTimestamp, SessionDate, toSessionDate } from './time.js';

/**
 * Returns the Eastern Time (America/New_York) session date for a given UTC timestamp.
 */
export function getEasternSessionDate(ts: UtcTimestamp): SessionDate {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(new Date(ts));
  const year = parts.find(p => p.type === 'year')!.value;
  const month = parts.find(p => p.type === 'month')!.value;
  const day = parts.find(p => p.type === 'day')!.value;
  return toSessionDate(`${year}-${month}-${day}`);
}

function getUtcNoonForDate(isoDate: string): number {
  const parts = isoDate.split('-').map(Number);
  const y = parts[0]!;
  const m = parts[1]!;
  const d = parts[2]!;
  return Date.UTC(y, m - 1, d, 12, 0, 0);
}

function addDays(isoDate: string, days: number): SessionDate {
  const ts = getUtcNoonForDate(isoDate);
  const newTs = ts + days * 86400000;
  const newDate = new Date(newTs);
  const ny = newDate.getUTCFullYear();
  const nm = String(newDate.getUTCMonth() + 1).padStart(2, '0');
  const nd = String(newDate.getUTCDate()).padStart(2, '0');
  return toSessionDate(`${ny}-${nm}-${nd}`);
}

export function isWeekend(isoDate: string): boolean {
  const date = new Date(getUtcNoonForDate(isoDate));
  const dayOfWeek = date.getUTCDay();
  return dayOfWeek === 0 || dayOfWeek === 6;
}

/**
 * Counts the number of trading sessions between two timestamps.
 * A session is counted if its date falls strictly after the start timestamp's date
 * and up to (and including) the end timestamp's date, excluding weekends and holidays.
 * If start is after end, returns a negative count.
 */
export function countSessions(
  start: UtcTimestamp,
  end: UtcTimestamp,
  holidays: Set<SessionDate> | SessionDate[]
): number {
  if (start > end) {
    return -countSessions(end, start, holidays);
  }

  const holidaySet = Array.isArray(holidays) ? new Set(holidays) : holidays;
  const startIso = getEasternSessionDate(start);
  const endIso = getEasternSessionDate(end);

  if (startIso === endIso) {
    return 0;
  }

  let count = 0;
  let currentIso = startIso;

  while (currentIso < endIso) {
    currentIso = addDays(currentIso, 1);
    if (!isWeekend(currentIso) && !holidaySet.has(currentIso)) {
      count++;
    }
  }

  return count;
}
