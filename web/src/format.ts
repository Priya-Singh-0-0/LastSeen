/**
 * Display-only formatting of canonical values the API already returned. This is permitted
 * client-side (CLAUDE.md): rounding and grouping phrase an existing fact at a readable
 * precision, they never derive a new one. Nothing here multiplies, divides, or compares —
 * `percentageChange` arrives from the API already expressed as a percentage.
 *
 * Every caller pairs the formatted output with the canonical string in a `title`, so the
 * full-precision value the API sent is always one hover away.
 */

/** Prices, baselines and absolute amounts all render at two places (surface brief §5). */
const DISPLAY_DECIMALS = 2;

/** A price the API sent, at the column's display precision. */
export function formatPrice(value: string): string {
  return formatFixed(value, DISPLAY_DECIMALS);
}

/**
 * A `YYYY-MM-DD` session date as a short human label ("5 Sep 2026").
 *
 * Parsed as UTC deliberately: a session date is a calendar day, not an instant, and
 * `new Date('2026-09-05')` in a negative-offset timezone would render the day before.
 */
export function formatSessionDate(sessionDate: string): string {
  const parsed = new Date(`${sessionDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return sessionDate;
  return parsed.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** A percentage the API computed, with an explicit sign so direction survives greyscale. */
export function formatSignedPercent(value: string): string {
  const formatted = formatFixed(value, DISPLAY_DECIMALS);
  return `${formatted.startsWith('-') ? '' : '+'}${formatted}%`;
}

/** An absolute price move, same sign convention as the percentage beside it. */
export function formatSignedAmount(value: string): string {
  const formatted = formatFixed(value, DISPLAY_DECIMALS);
  return `${formatted.startsWith('-') ? '' : '+'}${formatted}`;
}

/** An unsigned ratio (e.g. the volatility multiple) at the same display precision. */
export function formatMultiple(value: string): string {
  return formatFixed(value, DISPLAY_DECIMALS);
}

function formatFixed(value: string, decimals: number): string {
  const parsed = Number(value);
  // An unparseable value is rendered exactly as the API sent it rather than as "NaN".
  if (!Number.isFinite(parsed)) return value;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(parsed);
}

/** True when the API's value is negative, read off the canonical string, not the rounded one. */
export function isNegative(value: string): boolean {
  return value.trimStart().startsWith('-');
}

/**
 * `SESSION_CLOSE` is a database enum, not something a retail investor reads. Sentence-casing
 * is display phrasing of a value the API owns — it changes no fact and reinterprets nothing.
 * (Rendered in caps by the stylesheet; the DOM keeps the readable form for assistive tech.)
 */
export function humanizeEnum(value: string): string {
  const spaced = value.replace(/_/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  const diffSeconds = Math.round((then - now.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  const units: readonly [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60],
  ];

  for (const [unit, secondsInUnit] of units) {
    if (Math.abs(diffSeconds) >= secondsInUnit) {
      return rtf.format(Math.round(diffSeconds / secondsInUnit), unit);
    }
  }
  return rtf.format(diffSeconds, 'second');
}
