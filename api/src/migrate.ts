import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { getPool } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../../db/migrations');

async function getMigrationFiles(): Promise<string[]> {
  let files: string[];
  try {
    files = await fs.readdir(MIGRATIONS_DIR);
  } catch {
    throw new Error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
  }
  return files
    .filter(f => f.endsWith('.sql'))
    .sort(); // lexicographic = NNNN_ prefix order
}

/**
 * Forward-only migration runner (architecture §J).
 * - Applies each NNNN_*.sql in filename order inside a transaction.
 * - Records applied names in schema_migrations.
 * - Re-running is a no-op.
 * - A failing migration rolls back and throws; schema_migrations is unchanged.
 *
 * Executed by the API only — the worker never runs migrations.
 */
export async function runMigrations(connectionString: string): Promise<void> {
  const pool = getPool(connectionString);
  const client = await pool.connect();

  try {
    // Ensure the tracking table exists (idempotent bootstrap)
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       TEXT        PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const files = await getMigrationFiles();

    for (const file of files) {
      const { rows } = await client.query<{ name: string }>(
        'SELECT name FROM schema_migrations WHERE name = $1',
        [file],
      );
      if ((rows[0] as pg.QueryResultRow | undefined) !== undefined) {
        continue; // already applied
      }

      const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf-8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`[migrate] applied: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(
          `Migration "${file}" failed and was rolled back: ${(err as Error).message}`,
        );
      }
    }
  } finally {
    client.release();
  }
}

// ─── CLI entry point ─────────────────────────────────────────────────────────
const isMain = process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  const url = process.env['DATABASE_URL'];
  if (!url) { console.error('DATABASE_URL is required'); process.exit(1); }
  runMigrations(url)
    .then(() => { console.log('[migrate] done'); process.exit(0); })
    .catch(err => { console.error('[migrate] failed:', err); process.exit(1); });
}
