import { Client, type QueryResultRow } from 'pg';
import type { Env } from './env';

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export async function query<T extends QueryResultRow = QueryResultRow>(env: Env, text: string, values: unknown[] = []): Promise<T[]> {
  if (!env.HYPERDRIVE?.connectionString) {
    throw new ConfigurationError('HYPERDRIVE binding is not configured');
  }

  // Hyperdrive maintains the underlying pool. A Client must be created per
  // Worker request instead of keeping a global pg Pool across invocations.
  const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
  await client.connect();
  try {
    const result = await client.query<T>(text, values);
    return result.rows;
  } finally {
    await client.end();
  }
}

export function jsonSafe(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonSafe(v)]));
  return value;
}
