import type { Env } from './env';
import { ConfigurationError, query, jsonSafe } from './db';

export const ARCHIVE_TTL_SECONDS = 31 * 24 * 60 * 60;
export const MAX_CHUNK_BYTES = 1024 * 1024;
const encoder = new TextEncoder();
const datasetKeys = ['instruction', 'context', 'response', 'metadata'] as const;

type MemoryRow = {
  instruction: string;
  context: string;
  response: string;
  metadata: unknown;
};

export interface ExportManifest {
  version: 1;
  dataset: 'memories';
  keys: readonly string[];
  chunkKeys: string[];
  rowCount: number;
  /** Kept as an explicit alias for consumers that call this count `rows`. */
  rows: number;
  createdAt: string;
  expirationTtl: number;
}

export interface ExportResult {
  key: string;
  manifestKey: string;
  chunkKeys: string[];
  rows: number;
  rowCount: number;
  createdAt: string;
}

function utf8Bytes(value: string): number {
  return encoder.encode(value).byteLength;
}

/** Split complete JSONL records by their encoded UTF-8 byte size, never by characters. */
export function splitJsonl(lines: string[], maxBytes = MAX_CHUNK_BYTES): string[] {
  if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new RangeError('maxBytes must be a positive integer');
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const line of lines) {
    const record = line.endsWith('\n') ? line : `${line}\n`;
    const recordBytes = utf8Bytes(record);
    if (recordBytes > maxBytes) throw new RangeError(`JSONL record exceeds ${maxBytes} UTF-8 bytes`);
    if (current && currentBytes + recordBytes > maxBytes) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
    current += record;
    currentBytes += recordBytes;
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function exportDataset(env: Env, _reason: string): Promise<ExportResult> {
  if (!env.ARCHIVE_STORE) throw new ConfigurationError('ARCHIVE_STORE binding is not configured');
  const createdAt = new Date().toISOString();
  const exportId = createdAt.replace(/[:.]/g, '-');
  const prefix = `exports/memories-${exportId}`;
  const rows = await query<MemoryRow>(env, 'SELECT instruction, context, response, metadata FROM memories ORDER BY created_at ASC');
  const lines = rows.map((row) => JSON.stringify({
    instruction: row.instruction,
    context: row.context,
    response: row.response,
    metadata: jsonSafe(row.metadata) ?? {}
  }));
  const chunks = splitJsonl(lines);
  const chunkKeys = chunks.map((_, index) => `${prefix}/chunk-${String(index).padStart(5, '0')}.jsonl`);
  for (let index = 0; index < chunks.length; index += 1) {
    await env.ARCHIVE_STORE.put(chunkKeys[index], chunks[index], { expirationTtl: ARCHIVE_TTL_SECONDS });
  }
  const manifestKey = `${prefix}/manifest.json`;
  const manifest: ExportManifest = {
    version: 1,
    dataset: 'memories',
    keys: datasetKeys,
    chunkKeys,
    rowCount: rows.length,
    rows: rows.length,
    createdAt,
    expirationTtl: ARCHIVE_TTL_SECONDS
  };
  await env.ARCHIVE_STORE.put(manifestKey, JSON.stringify(manifest), { expirationTtl: ARCHIVE_TTL_SECONDS });
  return { key: manifestKey, manifestKey, chunkKeys, rows: rows.length, rowCount: rows.length, createdAt };
}
