import { Pool, type QueryResultRow } from 'pg';
import type { Env } from './env';

const pools = new WeakMap<object, Pool>();

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export function getPool(env: Env): Pool {
  if (!env.HYPERDRIVE?.connectionString) {
    throw new ConfigurationError('HYPERDRIVE binding is not configured');
  }
  const key = env as object;
  const existing = pools.get(key);
  if (existing) return existing;
  const pool = new Pool({ connectionString: env.HYPERDRIVE.connectionString, max: 4, idleTimeoutMillis: 10_000 });
  pools.set(key, pool);
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(env: Env, text: string, values: unknown[] = []): Promise<T[]> {
  const result = await getPool(env).query<T>(text, values);
  return result.rows;
}

export function jsonSafe(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonSafe(v)]));
  return value;
}
