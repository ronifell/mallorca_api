/**
 * Simple migration runner. Reads .sql files from src/db/migrations in
 * alphabetical order and applies any that have not been executed yet.
 *
 * Each migration is run inside a transaction so partial failures roll back.
 */
import fs from 'fs';
import path from 'path';
import { pool } from '../config/database';
import { logger } from '../utils/logger';

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function alreadyApplied(name: string): Promise<boolean> {
  const r = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
  return r.rowCount! > 0;
}

async function applyMigration(name: string, sql: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    await client.query('COMMIT');
    logger.info('Applied migration', { name });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function main() {
  await ensureMigrationsTable();
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const f of files) {
    if (await alreadyApplied(f)) {
      logger.info('Skipping migration (already applied)', { name: f });
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    await applyMigration(f, sql);
  }

  await pool.end();
  logger.info('Migrations complete');
}

main().catch((e) => {
  logger.error('Migration failed', { err: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
