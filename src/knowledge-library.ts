import { uploadFiles } from '@huggingface/hub';
import type { Env } from './env';

const HF_REPO = 'zazo301/brain';
const HF_KNOWLEDGE_DIR = 'knowledge/uploads/';
const MAX_UPLOAD_TEXT_BYTES = 20 * 1024 * 1024;
const MAX_SYNC_FILE_BYTES = 12 * 1024 * 1024;
const MAX_SYNC_BYTES_PER_RUN = 40 * 1024 * 1024;
const MAX_FILES_PER_RUN = 100;
const CHUNK_CHARS = 3000;
const SEARCH_LIMIT_PER_SHARD = 6;

export interface KnowledgeSource {
  title: string;
  path: string;
  chunk: number;
  content: string;
  url: string;
  rank: number;
}

function knowledgeDatabases(env: Env): D1Database[] {
  return [
    env.KNOWLEDGE_01, env.KNOWLEDGE_02, env.KNOWLEDGE_03, env.KNOWLEDGE_04, env.KNOWLEDGE_05,
    env.KNOWLEDGE_06, env.KNOWLEDGE_07, env.KNOWLEDGE_08, env.KNOWLEDGE_09, env.KNOWLEDGE_10,
  ].filter((database): database is D1Database => Boolean(database));
}

function shardForPath(path: string, databases: D1Database[]): D1Database {
  let hash = 2166136261;
  for (let i = 0; i < path.length; i += 1) hash = Math.imul(hash ^ path.charCodeAt(i), 16777619);
  return databases[(hash >>> 0) % databases.length];
}

function safeFileName(name: string): string {
  const normalized = name.normalize('NFKC').split(/[\\/]/).pop() || 'document';
  const stem = normalized.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 100);
  return stem || 'document';
}

function makeChunks(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/[\t\u00a0]+/g, ' ').trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length) {
    if (remaining.length <= CHUNK_CHARS) {
      chunks.push(remaining);
      break;
    }
    const window = remaining.slice(0, CHUNK_CHARS);
    let cut = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'));
    if (cut < CHUNK_CHARS * 0.55) cut = window.lastIndexOf(' ');
    if (cut < CHUNK_CHARS * 0.55) cut = CHUNK_CHARS;
    const piece = remaining.slice(0, cut).trim();
    if (piece) chunks.push(piece);
    remaining = remaining.slice(cut).trim();
  }
  return chunks;
}

function sourceUrl(path: string): string {
  return `https://huggingface.co/${HF_REPO}/blob/main/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function fileIsIndexable(path: string): boolean {
  return /\.(?:txt|md|markdown|json|jsonl|ndjson|csv|tsv)$/i.test(path);
}

function makeMatchQuery(question: string): string {
  const terms = (question.normalize('NFKC').match(/[\p{L}\p{N}]+/gu) || [])
    .filter((term) => term.length > 1)
    .slice(-12);
  return [...new Set(terms)].map((term) => `"${term.replaceAll('"', '""')}"`).join(' OR ');
}

export async function searchKnowledge(env: Env, question: string, limit = 8): Promise<KnowledgeSource[]> {
  const match = makeMatchQuery(question);
  const databases = knowledgeDatabases(env);
  if (!match || !databases.length) return [];
  const results = await Promise.all(databases.map(async (database) => {
    try {
      const { results: rows } = await database.prepare(
        `SELECT title, source_path AS path, chunk_id, content, bm25(knowledge_fts) AS rank
         FROM knowledge_fts WHERE knowledge_fts MATCH ?
         ORDER BY rank LIMIT ?`
      ).bind(match, SEARCH_LIMIT_PER_SHARD).all<{
        title: string; path: string; chunk_id: string; content: string; rank: number;
      }>();
      return (rows || []).map((row) => ({
        title: row.title,
        path: row.path,
        chunk: Number(row.chunk_id.split(':').pop()) || 0,
        content: row.content,
        url: sourceUrl(row.path),
        rank: Number(row.rank) || 0,
      }));
    } catch (error) {
      console.error('Knowledge shard search failed', error instanceof Error ? error.message : String(error));
      return [];
    }
  }));
  return results.flat().sort((a, b) => a.rank - b.rank).slice(0, limit);
}

export async function uploadKnowledgeText(env: Env, file: File): Promise<{ path: string; url: string; commit: string | null; indexedNow: boolean }> {
  if (!env.HF_TOKEN) throw new Error('HF_TOKEN is not configured on the Worker');
  if (!file.size || file.size > MAX_UPLOAD_TEXT_BYTES) throw new Error('الحد الأقصى للنص المرفوع 20 MiB');
  const text = await file.text();
  if (!text.trim()) throw new Error('الملف لا يحتوي نصاً قابلاً للحفظ');
  const base = safeFileName(file.name);
  const path = `${HF_KNOWLEDGE_DIR}${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}-${base}.txt`;
  const result = await uploadFiles({
    repo: { type: 'model', name: HF_REPO },
    accessToken: env.HF_TOKEN,
    // Knowledge files are small text blobs. The basic Hub upload is more
    // reliable in Cloudflare Workers than negotiating the optional Xet
    // transfer, and the nested directory is created by this commit itself.
    useXet: false,
    commitTitle: `Add public knowledge document: ${base}`,
    commitDescription: 'Uploaded from the Zazo knowledge library. This file is public.',
    files: [{ path, content: new Blob([text], { type: 'text/plain; charset=utf-8' }) }],
  });
  let indexedNow = false;
  try {
    const databases = knowledgeDatabases(env);
    if (databases.length) {
      const revision = result?.commit.oid || `uploaded-${Date.now()}`;
      await replaceIndexedFile(shardForPath(path, databases), path, revision, text);
      indexedNow = true;
    }
  } catch (error) {
    console.error('Knowledge uploaded to Hugging Face but immediate D1 indexing failed; daily sync will retry', error instanceof Error ? error.message : String(error));
  }
  return { path, url: sourceUrl(path), commit: result?.commit.oid ?? null, indexedNow };
}

async function fetchKnowledgeFiles(): Promise<Array<{ path: string; oid: string; size: number }>> {
  let nextUrl: string | null = `https://huggingface.co/api/models/${HF_REPO}/tree/main/${HF_KNOWLEDGE_DIR.replace(/\/$/, '')}?recursive=true&expand=false&limit=1000`;
  const output: Array<{ path: string; oid: string; size: number }> = [];
  while (nextUrl) {
    const response: Response = await fetch(nextUrl as string, { headers: { 'User-Agent': 'zazo-brain-knowledge-sync/1.0' } });
    if (response.status === 404 && output.length === 0) return [];
    if (!response.ok) throw new Error(`Hugging Face file listing failed (${response.status})`);
    const items = await response.json() as Array<{ type?: string; path?: string; oid?: string; size?: number }>;
    output.push(...items.filter((item): item is { type: 'file'; path: string; oid: string; size: number } =>
      item.type === 'file' && typeof item.path === 'string' && typeof item.oid === 'string' &&
      typeof item.size === 'number' && item.path.startsWith(HF_KNOWLEDGE_DIR) && fileIsIndexable(item.path)
    ).map(({ path, oid, size }) => ({ path, oid, size })));
    const link: string = response.headers.get('Link') || '';
    const next: string | undefined = link.split(',').find((part: string) => /rel="?next"?/i.test(part));
    nextUrl = next?.match(/<([^>]+)>/)?.[1] || null;
  }
  return output.sort((a, b) => a.path.localeCompare(b.path));
}

async function replaceIndexedFile(database: D1Database, path: string, revision: string, text: string): Promise<number> {
  const chunks = makeChunks(text);
  const statements: D1PreparedStatement[] = [
    database.prepare('DELETE FROM knowledge_fts WHERE source_path = ?').bind(path),
    database.prepare('DELETE FROM knowledge_chunks WHERE source_path = ?').bind(path),
  ];
  for (let i = 0; i < chunks.length; i += 1) {
    const id = `${revision}:${i}`;
    const title = path.split('/').pop() || path;
    statements.push(database.prepare(
      'INSERT INTO knowledge_chunks (id, source_path, source_revision, chunk_index, title, content, checksum, language) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, path, revision, i, title, chunks[i], revision, 'auto'));
    statements.push(database.prepare(
      'INSERT INTO knowledge_fts (title, content, source_path, chunk_id) VALUES (?, ?, ?, ?)'
    ).bind(title, chunks[i], path, id));
  }
  for (let offset = 0; offset < statements.length; offset += 80) {
    await database.batch(statements.slice(offset, offset + 80));
  }
  await database.prepare(
    'INSERT INTO knowledge_sync_files (source_path, source_revision, indexed_chunks, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(source_path) DO UPDATE SET source_revision = excluded.source_revision, indexed_chunks = excluded.indexed_chunks, updated_at = CURRENT_TIMESTAMP'
  ).bind(path, revision, chunks.length).run();
  return chunks.length;
}

export async function syncKnowledgeLibrary(env: Env): Promise<{ checked: number; indexed: number; chunks: number; skipped: number }> {
  const databases = knowledgeDatabases(env);
  if (!databases.length) throw new Error('Knowledge D1 bindings are not configured');
  const files = await fetchKnowledgeFiles();
  const previousCursor = await env.ACTIVE_CONTEXT?.get('knowledge-sync-cursor') || '';
  const firstIndex = files.findIndex((file) => file.path > previousCursor);
  const start = firstIndex < 0 ? 0 : firstIndex;
  const orderedFiles = files.length ? [...files.slice(start), ...files.slice(0, start)] : [];
  let checked = 0;
  let indexed = 0;
  let chunks = 0;
  let skipped = 0;
  let downloadedBytes = 0;
  let cursor = previousCursor;
  for (const file of orderedFiles) {
    if (checked >= MAX_FILES_PER_RUN) break;
    checked += 1;
    cursor = file.path;
    const database = shardForPath(file.path, databases);
    const current = await database.prepare('SELECT source_revision FROM knowledge_sync_files WHERE source_path = ?').bind(file.path).first<{ source_revision: string }>();
    if (current?.source_revision === file.oid) continue;
    if (file.size > MAX_SYNC_FILE_BYTES || downloadedBytes + file.size > MAX_SYNC_BYTES_PER_RUN) {
      console.warn('Knowledge file exceeds per-file sync bound; upload a text extraction or split it', { path: file.path, size: file.size });
      skipped += 1;
      continue;
    }
    const downloadUrl = `https://huggingface.co/${HF_REPO}/resolve/main/${file.path.split('/').map(encodeURIComponent).join('/')}`;
    const response = await fetch(downloadUrl, { headers: { 'User-Agent': 'zazo-brain-knowledge-sync/1.0' } });
    if (!response.ok) throw new Error(`Hugging Face file download failed (${response.status}) for ${file.path}`);
    const text = await response.text();
    downloadedBytes += new TextEncoder().encode(text).byteLength;
    if (downloadedBytes > MAX_SYNC_BYTES_PER_RUN) {
      skipped += 1;
      break;
    }
    chunks += await replaceIndexedFile(database, file.path, file.oid, text);
    indexed += 1;
  }
  if (cursor) await env.ACTIVE_CONTEXT?.put('knowledge-sync-cursor', cursor);
  if (files.length > MAX_FILES_PER_RUN) skipped += Math.max(0, files.length - checked);
  return { checked, indexed, chunks, skipped };
}
