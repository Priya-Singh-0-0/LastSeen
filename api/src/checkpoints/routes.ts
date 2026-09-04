import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSession } from '../auth/middleware.js';
import { verify } from './ackToken.js';
import { advanceCheckpoint } from './repo.js';
import type { Pool } from '../db.js';
import { toWireString } from '@stockwatch/contracts';

/**
 * Acknowledge route (T30, architecture §F.6 — INV-7, INV-15).
 *
 * The only place a checkpoint's `seen_through_publication_seq` and baseline can move. Every
 * value that ends up in the checkpoint was chosen by the server at GET time and is carried,
 * tamper-evident, inside the ack token — this route never trusts anything from the request body
 * except the opaque token itself.
 */

const AcknowledgeBody = z.object({ ack_token: z.string().min(1) });

function parseBigInt(val: unknown): bigint | null {
  try { return BigInt(val as string); } catch { return null; }
}

export async function registerCheckpointRoutes(
  app: FastifyInstance,
  pool: Pool,
  ackTokenSecret: string,
): Promise<void> {
  const auth = requireSession(pool);

  // ── POST /instruments/:id/acknowledge ───────────────────────────────────────
  app.post('/instruments/:id/acknowledge', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const instrumentId = parseBigInt(id);
    if (!instrumentId) return reply.code(404).send({ error: 'Not found' });

    const parsed = AcknowledgeBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid input' });

    const payload = verify(
      parsed.data.ack_token,
      request.user!.id,
      instrumentId,
      ackTokenSecret,
    );
    if (!payload) return reply.code(403).send({ error: 'Invalid or expired ack token' });

    const updated = await advanceCheckpoint(pool, request.user!.id, instrumentId, {
      servedWatermark: payload.servedWatermark,
      baselinePrice: payload.baselinePrice,
      baselineMarketTimestamp: payload.baselineMarketTimestamp,
      corporateActionVersion: payload.corporateActionVersion,
    });
    if (!updated) return reply.code(404).send({ error: 'Not found' });

    return reply.send({
      instrumentId: updated.instrumentId,
      seenThroughPublicationSeq: updated.seenThroughPublicationSeq,
      baselinePrice: updated.baselinePrice === null ? null : toWireString(updated.baselinePrice),
      baselineMarketTimestamp: updated.baselineMarketTimestamp === null
        ? null
        : new Date(updated.baselineMarketTimestamp).toISOString(),
      baselineCorporateActionVersion: updated.baselineCorporateActionVersion,
    });
  });
}
