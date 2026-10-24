import type { KVNamespace } from '@cloudflare/workers-types';
import type { Env } from './env';
import { ConfigurationError, query, jsonSafe } from './db';

export const ARCHIVE_TTL_SECONDS = 31 * 24 * 60 * 60;
export const MAX_CHUNK_BYTES = 1024 * 1024;
export const EXPORT_PAGE_SIZE = 500;
const encoder = new TextEncoder();
const datasetKeys = ['messages', 'instruction', 'context', 'response', 'metadata', 'candidate_question', 'candidate_answer'] as const;

type MemoryRow = {
  id: string;
  instruction: string;
  context: string;
  response: string;
  metadata: unknown;
  created_at: Date | string;
};

type ChatPairRow = {
  id: string;
  conversation_id: string;
  question: string;
  answer: string;
  created_at: Date | string;
};

type PreparedRecord = Record<string, unknown>;
type ExportBucket = 'ready' | 'review' | 'skip';

export interface ExportManifest {
  version: 2;
  dataset: 'zazo-rag-prepared';
  keys: readonly string[];
  chunkKeys: string[];
  readyChunkKeys: string[];
  reviewChunkKeys: string[];
  rowCount: number;
  rows: number;
  readyRows: number;
  reviewRows: number;
  duplicateRows: number;
  skippedRows: number;
  memoryRows: number;
  chatPairs: number;
  createdAt: string;
  expirationTtl: number;
}

export interface ExportResult {
  manifestKey: string;
  latestManifestKey: string;
  readyRows: number;
  reviewRows: number;
  duplicateRows: number;
  skippedRows: number;
  memoryRows: number;
  chatPairs: number;
  chunkCount: number;
  createdAt: string;
}

function utf8Bytes(value: string): number {
  return encoder.encode(value).byteLength;
}

/** Normalize line endings and surrounding whitespace without rewriting prose. */
export function normalizeDatasetText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.normalize('NFC').replace(/\r\n?/g, '\n').trim();
}

function metadataObject(value: unknown): Record<string, unknown> {
  const safe = jsonSafe(value);
  return safe && typeof safe === 'object' && !Array.isArray(safe) ? safe as Record<string, unknown> : {};
}

function dedupeKey(question: string, context: string, answer: string): string {
  return [question, context, answer]
    .map((part) => normalizeDatasetText(part).replace(/\s+/g, ' ').toLocaleLowerCase('ar'))
    .join('\u0000');
}

export function prepareMemoryRecord(row: MemoryRow): { bucket: ExportBucket; key: string; record?: PreparedRecord } {
  const instruction = normalizeDatasetText(row.instruction);
  const context = normalizeDatasetText(row.context);
  const response = normalizeDatasetText(row.response);
  if (!instruction && !context && !response) return { bucket: 'skip', key: '' };

  const sourceMetadata = metadataObject(row.metadata);
  const needsReview = sourceMetadata.needs_review === true || !instruction || !response;
  const key = dedupeKey(instruction, context, response);
  const metadata = {
    ...sourceMetadata,
    source_type: 'knowledge',
    source_record_id: row.id,
    source_created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    needs_review: needsReview,
  };

  if (needsReview) {
    return {
      bucket: 'review',
      key,
      record: {
        candidate_question: instruction,
        candidate_context: context,
        candidate_answer: response,
        metadata,
      },
    };
  }

  const userContent = context ? `${instruction}\n\nسياق مرجعي:\n${context}` : instruction;
  return {
    bucket: 'ready',
    key,
    record: {
      messages: [
        { role: 'user', content: userContent },
        { role: 'assistant', content: response },
      ],
      instruction,
      context,
      response,
      metadata,
    },
  };
}

export function prepareChatPairRecord(row: ChatPairRow): { bucket: ExportBucket; key: string; record?: PreparedRecord } {
  const question = normalizeDatasetText(row.question);
  const answer = normalizeDatasetText(row.answer);
  if (!question || !answer) return { bucket: 'skip', key: '' };
  const key = dedupeKey(question, '', answer);
  return {
    bucket: 'review',
    key,
    record: {
      candidate_question: question,
      candidate_context: '',
      candidate_answer: answer,
      metadata: {
        source_type: 'chat-history',
        conversation_id: row.conversation_id,
        user_message_id: row.id,
        source_created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        needs_review: true,
      },
    },
  };
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

class JsonlChunkWriter {
  readonly chunkKeys: string[] = [];
  rows = 0;
  private lines: string[] = [];
  private bytes = 0;
  private chunkIndex = 0;

  constructor(private readonly store: KVNamespace, private readonly prefix: string) {}

  async add(record: PreparedRecord): Promise<void> {
    const line = JSON.stringify(record);
    const recordBytes = utf8Bytes(`${line}\n`);
    if (recordBytes > MAX_CHUNK_BYTES) throw new RangeError('A prepared JSONL record exceeds the 1 MiB KV chunk size');
    if (this.lines.length && this.bytes + recordBytes > MAX_CHUNK_BYTES) await this.flush();
    this.lines.push(line);
    this.bytes += recordBytes;
    this.rows += 1;
  }

  async finish(): Promise<void> {
    await this.flush();
  }

  private async flush(): Promise<void> {
    if (!this.lines.length) return;
    const key = `${this.prefix}/chunk-${String(this.chunkIndex).padStart(5, '0')}.jsonl`;
    await this.store.put(key, `${this.lines.join('\n')}\n`, { expirationTtl: ARCHIVE_TTL_SECONDS });
    this.chunkKeys.push(key);
    this.chunkIndex += 1;
    this.lines = [];
    this.bytes = 0;
  }
}

const MEMORY_PAGE_SQL = `
  SELECT id, instruction, context, response, metadata, created_at
  FROM memories
  WHERE ($1::timestamptz IS NULL OR (created_at, id) > ($1::timestamptz, $2::uuid))
  ORDER BY created_at ASC, id ASC
  LIMIT $3
`;

const CHAT_PAIR_PAGE_SQL = `
  SELECT user_message.id,
         user_message.conversation_id,
         user_message.content AS question,
         assistant_message.content AS answer,
         user_message.created_at
  FROM messages AS user_message
  JOIN LATERAL (
    SELECT candidate.id, candidate.content, candidate.created_at
    FROM messages AS candidate
    WHERE candidate.conversation_id = user_message.conversation_id
      AND candidate.role = 'assistant'
      AND (candidate.created_at, candidate.id) > (user_message.created_at, user_message.id)
    ORDER BY candidate.created_at ASC, candidate.id ASC
    LIMIT 1
  ) AS assistant_message ON TRUE
  WHERE user_message.role = 'user'
    AND user_message.content <> ''
    AND assistant_message.content <> ''
    AND NOT EXISTS (
      SELECT 1
      FROM messages AS later_user
      WHERE later_user.conversation_id = user_message.conversation_id
        AND later_user.role = 'user'
        AND (later_user.created_at, later_user.id) > (user_message.created_at, user_message.id)
        AND (later_user.created_at, later_user.id) < (assistant_message.created_at, assistant_message.id)
    )
    AND ($1::timestamptz IS NULL OR (user_message.created_at, user_message.id) > ($1::timestamptz, $2::uuid))
  ORDER BY user_message.created_at ASC, user_message.id ASC
  LIMIT $3
`;

async function fingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function exportDataset(env: Env, _reason: string): Promise<ExportResult> {
  if (!env.ARCHIVE_STORE) throw new ConfigurationError('ARCHIVE_STORE binding is not configured');
  const createdAt = new Date().toISOString();
  const exportId = createdAt.replace(/[:.]/g, '-');
  const prefix = `exports/zazo-rag-prepared/${exportId}`;
  const readyWriter = new JsonlChunkWriter(env.ARCHIVE_STORE, `${prefix}/ready`);
  const reviewWriter = new JsonlChunkWriter(env.ARCHIVE_STORE, `${prefix}/review`);
  const seenReady = new Set<string>();
  const seenReview = new Set<string>();
  let duplicateRows = 0;
  let skippedRows = 0;
  let memoryRows = 0;
  let chatPairs = 0;

  let memoryCursor: { createdAt: Date | string; id: string } | null = null;
  while (true) {
    const page: MemoryRow[] = await query<MemoryRow>(env, MEMORY_PAGE_SQL, [memoryCursor?.createdAt ?? null, memoryCursor?.id ?? null, EXPORT_PAGE_SIZE]);
    if (!page.length) break;
    for (const row of page) {
      memoryRows += 1;
      const prepared = prepareMemoryRecord(row);
      if (prepared.bucket === 'skip' || !prepared.record) {
        skippedRows += 1;
        continue;
      }
      const seen = prepared.bucket === 'ready' ? seenReady : seenReview;
      const key = await fingerprint(prepared.key);
      if (seen.has(key)) {
        duplicateRows += 1;
        continue;
      }
      seen.add(key);
      await (prepared.bucket === 'ready' ? readyWriter : reviewWriter).add(prepared.record);
    }
    const last: MemoryRow = page[page.length - 1];
    memoryCursor = { createdAt: last.created_at, id: last.id };
    if (page.length < EXPORT_PAGE_SIZE) break;
  }

  let chatCursor: { createdAt: Date | string; id: string } | null = null;
  while (true) {
    const page: ChatPairRow[] = await query<ChatPairRow>(env, CHAT_PAIR_PAGE_SQL, [chatCursor?.createdAt ?? null, chatCursor?.id ?? null, EXPORT_PAGE_SIZE]);
    if (!page.length) break;
    for (const row of page) {
      chatPairs += 1;
      const prepared = prepareChatPairRecord(row);
      if (prepared.bucket === 'skip' || !prepared.record) {
        skippedRows += 1;
        continue;
      }
      const key = await fingerprint(prepared.key);
      if (seenReview.has(key)) {
        duplicateRows += 1;
        continue;
      }
      seenReview.add(key);
      await reviewWriter.add(prepared.record);
    }
    const last: ChatPairRow = page[page.length - 1];
    chatCursor = { createdAt: last.created_at, id: last.id };
    if (page.length < EXPORT_PAGE_SIZE) break;
  }

  await readyWriter.finish();
  await reviewWriter.finish();
  const readyChunkKeys = readyWriter.chunkKeys;
  const reviewChunkKeys = reviewWriter.chunkKeys;
  const chunkKeys = [...readyChunkKeys, ...reviewChunkKeys];
  const manifestKey = `${prefix}/manifest.json`;
  const rowCount = readyWriter.rows + reviewWriter.rows;
  const manifest: ExportManifest = {
    version: 2,
    dataset: 'zazo-rag-prepared',
    keys: datasetKeys,
    chunkKeys,
    readyChunkKeys,
    reviewChunkKeys,
    rowCount,
    rows: rowCount,
    readyRows: readyWriter.rows,
    reviewRows: reviewWriter.rows,
    duplicateRows,
    skippedRows,
    memoryRows,
    chatPairs,
    createdAt,
    expirationTtl: ARCHIVE_TTL_SECONDS,
  };
  await env.ARCHIVE_STORE.put(manifestKey, JSON.stringify(manifest), { expirationTtl: ARCHIVE_TTL_SECONDS });
  const latestManifestKey = 'exports/zazo-rag-prepared/latest.json';
  await env.ARCHIVE_STORE.put(latestManifestKey, JSON.stringify({ manifestKey, createdAt, rowCount, readyRows: readyWriter.rows, reviewRows: reviewWriter.rows }), { expirationTtl: ARCHIVE_TTL_SECONDS });
  return {
    manifestKey,
    latestManifestKey,
    readyRows: readyWriter.rows,
    reviewRows: reviewWriter.rows,
    duplicateRows,
    skippedRows,
    memoryRows,
    chatPairs,
    chunkCount: chunkKeys.length,
    createdAt,
  };
}
