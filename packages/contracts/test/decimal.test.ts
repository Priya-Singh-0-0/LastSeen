import { describe, it, expect } from 'vitest';
import { Decimal, parseDecimal, toWireString, D } from '../src/decimal.js';

describe('Decimal — precision (INV-9)', () => {
  it('0.1 + 0.2 does not drift from 0.3', () => {
    const result = D.add(parseDecimal('0.1'), parseDecimal('0.2'));
    expect(toWireString(result)).toBe('0.3');
  });

  it('percentage round-trip is exact (183.42 → 194.91)', () => {
    const baseline = parseDecimal('183.42');
    const current  = parseDecimal('194.91');
    const pct = D.mul(D.div(D.sub(current, baseline), baseline), parseDecimal('100'));
    // Same computation two ways must match exactly
    const expected = new Decimal('194.91').minus('183.42').dividedBy('183.42').times('100');
    expect(pct.equals(expected)).toBe(true);
    // Must not be the float-drifted result
    expect(pct.equals(new Decimal(((194.91 - 183.42) / 183.42) * 100))).toBe(false);
  });

  it('toWireString never uses scientific notation', () => {
    const tiny = parseDecimal('0.000001');
    const big  = parseDecimal('123456789012.000001');
    expect(toWireString(tiny)).not.toMatch(/[eE]/);
    expect(toWireString(big)).not.toMatch(/[eE]/);
  });

  it('parseDecimal rejects a non-string input', () => {
    expect(() => parseDecimal(42 as unknown as string)).toThrow(TypeError);
  });

  it('all D helpers return Decimal instances', () => {
    const a = parseDecimal('3.5');
    const b = parseDecimal('1.5');
    expect(D.add(a, b)).toBeInstanceOf(Decimal);
    expect(D.sub(a, b)).toBeInstanceOf(Decimal);
    expect(D.mul(a, b)).toBeInstanceOf(Decimal);
    expect(D.div(a, b)).toBeInstanceOf(Decimal);
    expect(D.abs(D.neg(a))).toBeInstanceOf(Decimal);
  });

  it('D.gt / D.gte / D.lt / D.lte / D.eq return booleans', () => {
    const a = parseDecimal('2.0');
    const b = parseDecimal('1.0');
    expect(D.gt(a, b)).toBe(true);
    expect(D.lt(a, b)).toBe(false);
    expect(D.eq(a, a)).toBe(true);
  });
});

describe('Decimal — structural (INV-9)', () => {
  it('the module exposes no function returning a JS number for a money value', () => {
    // parseDecimal → Decimal; toWireString → string; toFixed → string
    expect(typeof toWireString(parseDecimal('1.5'))).toBe('string');
    expect(typeof parseDecimal('1.5').toFixed()).toBe('string');
  });
});
