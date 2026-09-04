/**
 * UTC-branded timestamp — milliseconds since Unix epoch, always UTC.
 *
 * Use UtcTimestamp for every market and financial timestamp.
 * Never use a bare number or Date directly in financial calculations.
 * Display-time conversion (to the user's locale/timezone) happens in the frontend only.
 */
export type UtcTimestamp = number & { readonly _brand: 'UtcTimestamp' };

export function toUtcTimestamp(value: number): UtcTimestamp {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`toUtcTimestamp: invalid value ${value}`);
  }
  return value as UtcTimestamp;
}

export function fromDate(date: Date): UtcTimestamp {
  return toUtcTimestamp(date.getTime());
}

export function toDate(ts: UtcTimestamp): Date {
  return new Date(ts);
}

export function nowUtc(): UtcTimestamp {
  return toUtcTimestamp(Date.now());
}

/**
 * Session date — ISO 8601 YYYY-MM-DD string in the exchange's local date.
 * Not a timestamp; do not use for elapsed-time arithmetic.
 */
export type SessionDate = string & { readonly _brand: 'SessionDate' };

export function toSessionDate(isoDate: string): SessionDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    throw new Error(`toSessionDate: expected YYYY-MM-DD, got "${isoDate}"`);
  }
  return isoDate as SessionDate;
}
