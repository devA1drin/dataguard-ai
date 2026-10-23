import { Pool, PoolClient } from "pg";
import { config } from "./config";

/** Serverless (Vercel): small pool, short idle timeout; use the pooled (PgBouncer) Neon URL with sslmode=require. */
export const pool = new Pool(config.serverless
  ? { connectionString: config.databaseUrl, max: 3, idleTimeoutMillis: 5000, connectionTimeoutMillis: 10000 }
  : { connectionString: config.databaseUrl, max: 10 });

export async function query<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

/** Run `fn` inside a transaction; rolls back on error. */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
