import { Pool, PoolClient, PoolConfig, QueryResult, QueryResultRow } from 'pg';
import { env } from './env';

/** Supabase transaction pooler (port 6543) requires prepare: false. */
function isSupabaseTransactionPooler(url: string): boolean {
  try {
    const u = new URL(url.replace(/^postgres:/, 'postgresql:'));
    return u.port === '6543' || u.searchParams.get('pgbouncer') === 'true';
  } catch {
    return false;
  }
}

function buildPoolConfig(): PoolConfig {
  const useTransactionPooler = isSupabaseTransactionPooler(env.database.url);
  return {
    connectionString: env.database.url,
    ssl: env.database.ssl ? { rejectUnauthorized: false } : undefined,
    // Remote DB (Supabase): fewer connections, release idle clients before pooler drops them.
    max: useTransactionPooler ? 8 : 20,
    idleTimeoutMillis: useTransactionPooler ? 20_000 : 30_000,
    connectionTimeoutMillis: 20_000,
    keepAlive: true,
    // Required for Supabase Supavisor transaction mode (port 6543).
    ...(useTransactionPooler ? { prepare: false as const } : {}),
  };
}

export const pool = new Pool(buildPoolConfig());

pool.on('error', (err) => {
  // Unexpected idle-client error; log and let pg recover.
  console.error('[pg] Unexpected error on idle client', err);
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params as never);
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
