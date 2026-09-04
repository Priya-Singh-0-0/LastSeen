import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Decimal } from '@stockwatch/contracts';
import { parseDecimal, toWireString, toUtcTimestamp, nowUtc } from '@stockwatch/contracts';
import type { UtcTimestamp } from '@stockwatch/contracts';

/**
 * Acknowledgement token — stateless, integrity-protected (T28, INV-7, INV-15).
 *
 * A base64url JSON payload + HMAC-SHA256 signature over that encoded payload, keyed by
 * `ACK_TOKEN_SECRET`. Carries everything the POST /acknowledge handler needs to advance a
 * checkpoint (T29/T30) without any server-side token storage: no table, no revocation list,
 * no cleanup job. Forging or tampering is caught by signature verification; replay of a
 * legitimately-issued token is harmless because advancing a checkpoint with an
 * already-seen watermark is a no-op (T29's `GREATEST` upsert).
 */

const ACK_TOKEN_VERSION = 1;
const TOKEN_TTL_MS = 15 * 60 * 1000;

export interface AckTokenPayload {
  v: number;
  userId: bigint;
  instrumentId: bigint;
  servedWatermark: bigint;
  baselinePrice: Decimal | null;
  baselineMarketTimestamp: UtcTimestamp | null;
  corporateActionVersion: number;
  issuedAt: UtcTimestamp;
  expiresAt: UtcTimestamp;
}

export type MintInput = Omit<AckTokenPayload, 'v' | 'issuedAt' | 'expiresAt'>;

const WirePayloadSchema = z.object({
  v: z.number(),
  userId: z.string(),
  instrumentId: z.string(),
  servedWatermark: z.string(),
  baselinePrice: z.string().nullable(),
  baselineMarketTimestamp: z.number().nullable(),
  corporateActionVersion: z.number(),
  issuedAt: z.number(),
  expiresAt: z.number(),
});

function toWirePayload(payload: AckTokenPayload): z.infer<typeof WirePayloadSchema> {
  return {
    v: payload.v,
    userId: payload.userId.toString(),
    instrumentId: payload.instrumentId.toString(),
    servedWatermark: payload.servedWatermark.toString(),
    baselinePrice: payload.baselinePrice === null ? null : toWireString(payload.baselinePrice),
    baselineMarketTimestamp: payload.baselineMarketTimestamp,
    corporateActionVersion: payload.corporateActionVersion,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
  };
}

function fromWirePayload(wire: z.infer<typeof WirePayloadSchema>): AckTokenPayload {
  return {
    v: wire.v,
    userId: BigInt(wire.userId),
    instrumentId: BigInt(wire.instrumentId),
    servedWatermark: BigInt(wire.servedWatermark),
    baselinePrice: wire.baselinePrice === null ? null : parseDecimal(wire.baselinePrice),
    baselineMarketTimestamp: wire.baselineMarketTimestamp === null ? null : toUtcTimestamp(wire.baselineMarketTimestamp),
    corporateActionVersion: wire.corporateActionVersion,
    issuedAt: toUtcTimestamp(wire.issuedAt),
    expiresAt: toUtcTimestamp(wire.expiresAt),
  };
}

function sign(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

/**
 * Mint a signed ack token. `now` is injectable for testing; defaults to the real clock.
 */
export function mint(input: MintInput, secret: string, now: UtcTimestamp = nowUtc()): string {
  const payload: AckTokenPayload = {
    ...input,
    v: ACK_TOKEN_VERSION,
    issuedAt: now,
    expiresAt: toUtcTimestamp(now + TOKEN_TTL_MS),
  };

  const payloadB64 = Buffer.from(JSON.stringify(toWirePayload(payload)), 'utf8').toString('base64url');
  const signature = sign(payloadB64, secret);
  return `${payloadB64}.${signature}`;
}

/**
 * Verify a token's signature, expiry, and scope (owning user + path instrument).
 * Returns the decoded payload on success, or null on any failure — never throws.
 */
export function verify(
  token: string,
  sessionUserId: bigint,
  pathInstrumentId: bigint,
  secret: string,
  now: UtcTimestamp = nowUtc(),
): AckTokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) return null;
    const payloadB64 = parts[0];
    const signature = parts[1];

    const expectedSignature = sign(payloadB64, secret);
    const actual = Buffer.from(signature, 'base64url');
    const expected = Buffer.from(expectedSignature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return null;
    }

    const json = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const wire = WirePayloadSchema.parse(JSON.parse(json));
    const payload = fromWirePayload(wire);

    if (payload.expiresAt <= now) return null;
    if (payload.userId !== sessionUserId) return null;
    if (payload.instrumentId !== pathInstrumentId) return null;

    return payload;
  } catch {
    return null;
  }
}
