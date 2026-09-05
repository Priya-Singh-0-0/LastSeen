import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_FILE = path.resolve(__dirname, '../../db/seeds/demo.sql');

/**
 * Applies db/seeds/demo.sql against the given (superuser) connection (T38).
 * Assumes migrations have already run and the database is otherwise empty —
 * see db/seeds/demo.sql's header for the non-idempotency caveat.
 */
export async function runDemoSeed(connectionString: string): Promise<void> {
  const pool = getPool(connectionString);
  const client = await pool.connect();
  try {
    const sql = await fs.readFile(SEED_FILE, 'utf-8');
    await client.query(sql);
  } finally {
    client.release();
  }
}

// ─── CLI entry point ─────────────────────────────────────────────────────────
const isMain = process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL'];
  if (!url) { console.error('TEST_DATABASE_URL or DATABASE_URL is required'); process.exit(1); }
  runDemoSeed(url)
    .then(() => { console.log('[seed] demo seed applied'); process.exit(0); })
    .catch(err => { console.error('[seed] failed:', err); process.exit(1); });
}
