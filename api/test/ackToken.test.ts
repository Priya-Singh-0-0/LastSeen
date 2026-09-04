/**
 * T28 — Ack token mint and verify (architecture §H) (INV-7, INV-15)
 *
 * Pure-function tests — no DB, no token table. `mint`/`verify` are the only entry points.
 */
import { describe, it, expect } from 'vitest';
import { mint, verify, type MintInput } from '../src/checkpoints/ackToken.js';
import { D, parseDecimal, toUtcTimestamp } from '@stockwatch/contracts';

const SECRET = 'a'.repeat(32);
const OTHER_SECRET = 'b'.repeat(32);
const NOW = toUtcTimestamp(new Date('2024-01-08T14:30:00Z').getTime());

const BASE_INPUT: MintInput = {
  userId: 1n,
  instrumentId: 2n,
  servedWatermark: 100n,
  baselinePrice: parseDecimal('150.500000'),
  baselineMarketTimestamp: toUtcTimestamp(new Date('2024-01-08T14:30:00Z').getTime()),
  corporateActionVersion: 0,
};

describe('T28 — ack_token_integrity', () => {
  it('round-trips successfully', () => {
    const token = mint(BASE_INPUT, SECRET, NOW);
    const result = verify(token, BASE_INPUT.userId, BASE_INPUT.instrumentId, SECRET, NOW);

    expect(result).not.toBeNull();
    expect(result!.userId).toBe(1n);
    expect(result!.instrumentId).toBe(2n);
    expect(result!.servedWatermark).toBe(100n);
    expect(D.eq(result!.baselinePrice!, parseDecimal('150.500000'))).toBe(true);
    expect(result!.baselineMarketTimestamp).toBe(BASE_INPUT.baselineMarketTimestamp);
    expect(result!.corporateActionVersion).toBe(0);
    expect(result!.issuedAt).toBe(NOW);
    expect(result!.expiresAt).toBe(toUtcTimestamp(NOW + 15 * 60 * 1000));
  });

  it('round-trips a null baseline (warming instrument)', () => {
    const input: MintInput = { ...BASE_INPUT, baselinePrice: null, baselineMarketTimestamp: null };
    const token = mint(input, SECRET, NOW);
    const result = verify(token, input.userId, input.instrumentId, SECRET, NOW);

    expect(result).not.toBeNull();
    expect(result!.baselinePrice).toBeNull();
    expect(result!.baselineMarketTimestamp).toBeNull();
  });

  it('rejects a token with a flipped byte in the payload', () => {
    const token = mint(BASE_INPUT, SECRET, NOW);
    const [payloadB64, signature] = token.split('.');
    const bytes = Buffer.from(payloadB64, 'base64url');
    bytes[0] = bytes[0] ^ 0xff; // flip a byte
    const tamperedToken = `${bytes.toString('base64url')}.${signature}`;

    expect(verify(tamperedToken, BASE_INPUT.userId, BASE_INPUT.instrumentId, SECRET, NOW)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = mint(BASE_INPUT, SECRET, NOW);
    const afterExpiry = toUtcTimestamp(NOW + 15 * 60 * 1000 + 1);

    expect(verify(token, BASE_INPUT.userId, BASE_INPUT.instrumentId, SECRET, afterExpiry)).toBeNull();
  });

  it('accepts a token exactly at issuance and rejects one exactly at expiry', () => {
    const token = mint(BASE_INPUT, SECRET, NOW);
    const atExpiry = toUtcTimestamp(NOW + 15 * 60 * 1000);

    expect(verify(token, BASE_INPUT.userId, BASE_INPUT.instrumentId, SECRET, NOW)).not.toBeNull();
    expect(verify(token, BASE_INPUT.userId, BASE_INPUT.instrumentId, SECRET, atExpiry)).toBeNull();
  });

  it('rejects a token minted for another user', () => {
    const token = mint(BASE_INPUT, SECRET, NOW);

    expect(verify(token, 999n, BASE_INPUT.instrumentId, SECRET, NOW)).toBeNull();
  });

  it('rejects a token minted for another instrument', () => {
    const token = mint(BASE_INPUT, SECRET, NOW);

    expect(verify(token, BASE_INPUT.userId, 999n, SECRET, NOW)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const token = mint(BASE_INPUT, SECRET, NOW);

    expect(verify(token, BASE_INPUT.userId, BASE_INPUT.instrumentId, OTHER_SECRET, NOW)).toBeNull();
  });

  it('rejects a malformed token', () => {
    expect(verify('not-a-valid-token', BASE_INPUT.userId, BASE_INPUT.instrumentId, SECRET, NOW)).toBeNull();
    expect(verify('', BASE_INPUT.userId, BASE_INPUT.instrumentId, SECRET, NOW)).toBeNull();
    expect(verify('a.b.c', BASE_INPUT.userId, BASE_INPUT.instrumentId, SECRET, NOW)).toBeNull();
  });
});
