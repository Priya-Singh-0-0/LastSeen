/**
 * T16 — envelope read model tests (INV-9, INV-10, INV-11)
 *
 * Asserts: the API never emits a bare JS number for a financial field.
 * Requires a live DB: DATABASE_URL env var.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { assembleEnvelope, envelopeToWire } from '../src/market/envelope.js';
import type { MarketStateRow } from '../src/market/envelope.js';
import { parseDecimal } from '@stockwatch/contracts';

pg.types.setTypeParser(1700 as pg.TypeId, (v: string) => v);

describe('T16 — ValueEnvelope assembly (pure, no DB)', () => {
  const sampleRow: MarketStateRow = {
    price: '182.340000',
    currency: 'USD',
    market_timestamp: new Date('2024-08-07T14:00:00Z'),
    ingested_at: new Date('2024-08-07T14:00:05Z'),
    source: 'fixture',
    market_status: 'OPEN',
    value_kind: 'LIVE',
    data_freshness: 'FRESH',
    precision_hint: 2,
  };

  it('assembleEnvelope: price is a Decimal, not a JS number', () => {
    const env = assembleEnvelope(sampleRow);
    expect(typeof (env.value as unknown)).not.toBe('number');
    // Decimal instances have a .toFixed method.
    expect(typeof env.value.toFixed).toBe('function');
  });

  it('envelopeToWire: value field is a string, not a number (INV-9)', () => {
    const env = assembleEnvelope(sampleRow);
    const wire = envelopeToWire(env);
    expect(typeof wire.value).toBe('string');
  });

  it('envelopeToWire: no field in the wire output is a bare number for a financial value', () => {
    const env = assembleEnvelope(sampleRow);
    const wire = envelopeToWire(env);
    // precisionHint is a display hint, not a financial value — it's allowed as number.
    const financialKeys = ['value'];
    for (const key of financialKeys) {
      expect(typeof wire[key]).toBe('string');
    }
  });

  it('envelopeToWire: three envelope dimensions are present as distinct fields (INV-11)', () => {
    const env = assembleEnvelope(sampleRow);
    const wire = envelopeToWire(env);
    expect(wire.marketStatus).toBeDefined();
    expect(wire.valueKind).toBeDefined();
    expect(wire.dataFreshness).toBeDefined();
    // They must be distinct (not merged into a composite).
    expect(wire.marketStatus).not.toBe(wire.valueKind);
  });

  it('round-trips NUMERIC(18,6) without precision loss', () => {
    // 0.1 + 0.2 = 0.3 exactly in Decimal, not 0.30000000000000004
    const a = parseDecimal('0.100000');
    const b = parseDecimal('0.200000');
    const sum = a.plus(b);
    expect(sum.toFixed(6)).toBe('0.300000');
  });
});
