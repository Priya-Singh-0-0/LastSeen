import { Decimal } from 'decimal.js';

// Global decimal.js configuration — applied once at module load.
// Precision 28 matches the Postgres NUMERIC(18,6) headroom with room for intermediate results.
// ROUND_HALF_EVEN (banker's rounding) is the least-biased default.
Decimal.set({
  precision: 28,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpPos: 28,
  toExpNeg: -28,
});

export { Decimal };

/**
 * Parse a Postgres NUMERIC string into a Decimal.
 * The pg driver is configured to return NUMERIC as string — this is the only
 * entry point from a DB value into a Decimal.
 */
export function parseDecimal(value: string): Decimal {
  if (typeof value !== 'string') {
    throw new TypeError(`parseDecimal: expected string, got ${typeof value} — check pg NUMERIC type parser config`);
  }
  return new Decimal(value);
}

/**
 * Serialize a Decimal to its wire string. Never scientific notation.
 * Use this for JSON responses and all storage round-trips.
 */
export function toWireString(value: Decimal): string {
  return value.toFixed();
}

/**
 * Format to a fixed number of decimal places (display only).
 */
export function toFixed(value: Decimal, dp: number): string {
  return value.toFixed(dp);
}

/**
 * Safe arithmetic helpers — always return Decimal, never number.
 * Arithmetic operators (+, -, *, /) on Decimal values are forbidden
 * to prevent accidental JS number coercion.
 */
export const D = {
  add: (a: Decimal, b: Decimal): Decimal => a.plus(b),
  sub: (a: Decimal, b: Decimal): Decimal => a.minus(b),
  mul: (a: Decimal, b: Decimal): Decimal => a.times(b),
  div: (a: Decimal, b: Decimal): Decimal => a.dividedBy(b),
  abs: (a: Decimal): Decimal => a.abs(),
  neg: (a: Decimal): Decimal => a.neg(),
  sqrt: (a: Decimal): Decimal => a.sqrt(),
  pow: (a: Decimal, exp: number): Decimal => a.pow(exp),
  gt:  (a: Decimal, b: Decimal): boolean => a.greaterThan(b),
  gte: (a: Decimal, b: Decimal): boolean => a.greaterThanOrEqualTo(b),
  lt:  (a: Decimal, b: Decimal): boolean => a.lessThan(b),
  lte: (a: Decimal, b: Decimal): boolean => a.lessThanOrEqualTo(b),
  eq:  (a: Decimal, b: Decimal): boolean => a.equals(b),
  zero: (): Decimal => new Decimal(0),
  one:  (): Decimal => new Decimal(1),
  from: (value: string): Decimal => parseDecimal(value),
} as const;
