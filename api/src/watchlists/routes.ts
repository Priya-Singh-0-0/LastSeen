import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSession } from '../auth/middleware.js';
import {
  createWatchlist,
  listWatchlists,
  getWatchlist,
  renameWatchlist,
  deleteWatchlist,
  listWatchlistItems,
  removeWatchlistItem,
} from './repo.js';
import { resolveOrRegisterSymbol } from './resolve.js';
import { onItemAdded, onItemRemoved } from './tracking.js';
import type { Pool } from '../db.js';

/**
 * Watchlist routes (T10, T11, T12 — INV-15).
 *
 * Ownership is enforced by the repo layer (returns null on mismatch);
 * routes return 404 — never 403 — so the existence of another user's data is not revealed.
 */

const CreateWatchlistBody = z.object({ name: z.string().min(1).max(100) });
const RenameWatchlistBody  = z.object({ name: z.string().min(1).max(100) });
const AddItemBody          = z.object({ symbol: z.string().min(1).max(20) });

function parseBigInt(val: unknown): bigint | null {
  try { return BigInt(val as string); } catch { return null; }
}

export async function registerWatchlistRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  const auth = requireSession(pool);

  // ── POST /watchlists ────────────────────────────────────────────────────────
  app.post('/watchlists', { preHandler: auth }, async (request, reply) => {
    const parsed = CreateWatchlistBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid input' });

    const wl = await createWatchlist(pool, request.user!.id, parsed.data.name);
    return reply.code(201).send(wl);
  });

  // ── GET /watchlists ─────────────────────────────────────────────────────────
  app.get('/watchlists', { preHandler: auth }, async (request, reply) => {
    const wls = await listWatchlists(pool, request.user!.id);
    return reply.send(wls);
  });

  // ── GET /watchlists/:id ─────────────────────────────────────────────────────
  app.get('/watchlists/:id', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const wlId = parseBigInt(id);
    if (!wlId) return reply.code(404).send({ error: 'Not found' });

    const wl = await getWatchlist(pool, request.user!.id, wlId);
    if (!wl) return reply.code(404).send({ error: 'Not found' });
    return reply.send(wl);
  });

  // ── PATCH /watchlists/:id ───────────────────────────────────────────────────
  app.patch('/watchlists/:id', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const wlId = parseBigInt(id);
    if (!wlId) return reply.code(404).send({ error: 'Not found' });

    const parsed = RenameWatchlistBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid input' });

    const updated = await renameWatchlist(pool, request.user!.id, wlId, parsed.data.name);
    if (!updated) return reply.code(404).send({ error: 'Not found' });
    return reply.send({ ok: true });
  });

  // ── DELETE /watchlists/:id ──────────────────────────────────────────────────
  app.delete('/watchlists/:id', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const wlId = parseBigInt(id);
    if (!wlId) return reply.code(404).send({ error: 'Not found' });

    const deleted = await deleteWatchlist(pool, request.user!.id, wlId);
    if (!deleted) return reply.code(404).send({ error: 'Not found' });
    return reply.code(204).send();
  });

  // ── GET /watchlists/:id/items ───────────────────────────────────────────────
  app.get('/watchlists/:id/items', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const wlId = parseBigInt(id);
    if (!wlId) return reply.code(404).send({ error: 'Not found' });

    const items = await listWatchlistItems(pool, request.user!.id, wlId);
    if (!items) return reply.code(404).send({ error: 'Not found' });
    return reply.send(items);
  });

  // ── POST /watchlists/:id/items ──────────────────────────────────────────────
  app.post('/watchlists/:id/items', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const wlId = parseBigInt(id);
    if (!wlId) return reply.code(404).send({ error: 'Not found' });

    // Verify ownership.
    const wl = await getWatchlist(pool, request.user!.id, wlId);
    if (!wl) return reply.code(404).send({ error: 'Not found' });

    const parsed = AddItemBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid input' });

    const { instrumentId, warming } = await resolveOrRegisterSymbol(pool, parsed.data.symbol);

    // Upsert watchlist item (idempotent on duplicate add).
    await pool.query(
      `INSERT INTO watchlist_items (watchlist_id, instrument_id)
       VALUES ($1, $2)
       ON CONFLICT (watchlist_id, instrument_id) DO NOTHING`,
      [wlId, instrumentId],
    );

    // Maintain tracking (T12).
    await onItemAdded(pool, request.user!.id, instrumentId);

    return reply.code(201).send({
      instrumentId: String(instrumentId),
      state: warming ? 'WARMING' : 'READY',
    });
  });

  // ── DELETE /watchlists/:id/items/:itemId ────────────────────────────────────
  app.delete('/watchlists/:id/items/:itemId', { preHandler: auth }, async (request, reply) => {
    const { id, itemId } = request.params as { id: string; itemId: string };
    const wlId = parseBigInt(id);
    const itmId = parseBigInt(itemId);
    if (!wlId || !itmId) return reply.code(404).send({ error: 'Not found' });

    // Determine instrument before deletion (for tracking update).
    const { rows } = await pool.query<{ instrument_id: string }>(
      `SELECT wi.instrument_id FROM watchlist_items wi
       JOIN watchlists w ON w.id = wi.watchlist_id
       WHERE wi.id = $1 AND wi.watchlist_id = $2 AND w.user_id = $3`,
      [itmId, wlId, request.user!.id],
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'Not found' });
    const instrumentId = BigInt(rows[0].instrument_id);

    const deleted = await removeWatchlistItem(pool, request.user!.id, wlId, itmId);
    if (!deleted) return reply.code(404).send({ error: 'Not found' });

    await onItemRemoved(pool, request.user!.id, instrumentId);

    return reply.code(204).send();
  });
}
