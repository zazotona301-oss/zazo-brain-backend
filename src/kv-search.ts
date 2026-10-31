import type { KVNamespace } from '@cloudflare/workers-types';

export type SearchDocumentType = 'memory' | 'message';
export type SearchIndex = Pick<KVNamespace, 'get' | 'put' | 'delete'>;

const TOKEN_KEY_PREFIX = 'search/v1/token/';
const MAX_TOKENS_PER_DOCUMENT = 180;
const MAX_IDS_PER_TOKEN = 500;
const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670]/g;
const TOKEN_PATTERN = /[\p{L}\p{N}]{2,}/gu;
const STOP_WORDS = new Set([
  'من', 'في', 'على', 'إلى', 'عن', 'مع', 'هذا', 'هذه', 'ذلك', 'تلك', 'التي', 'الذي',
  'هو', 'هي', 'هم', 'هن', 'ما', 'ماذا', 'كيف', 'هل', 'كان', 'كانت', 'يكون', 'تكون',
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'was', 'were',
]);

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLocaleLowerCase('ar');
}

export function tokenizeSearchText(value: string): string[] {
  const tokens = normalizeSearchText(value).match(TOKEN_PATTERN) || [];
  return [...new Set(tokens.filter((token) => !STOP_WORDS.has(token)))].slice(0, MAX_TOKENS_PER_DOCUMENT);
}

function tokenKey(token: string): string {
  return `${TOKEN_KEY_PREFIX}${encodeURIComponent(token)}`;
}

function documentId(type: SearchDocumentType, id: string): string {
  return `${type}:${id}`;
}

export function searchScore(value: string, query: string): number {
  const queryTokens = new Set(tokenizeSearchText(query));
  if (!queryTokens.size) return 0;
  const valueTokens = new Set(tokenizeSearchText(value));
  let matches = 0;
  queryTokens.forEach((token) => { if (valueTokens.has(token)) matches += 1; });
  return matches / queryTokens.size;
}

/**
 * KV is used as a durable inverted index. Neon remains canonical; KV only
 * stores token -> document references and never receives an expiration TTL.
 */
export async function indexSearchDocument(
  store: SearchIndex | undefined,
  type: SearchDocumentType,
  id: string,
  text: string,
): Promise<void> {
  if (!store) return;
  const ref = documentId(type, id);
  const tokens = tokenizeSearchText(text);
  await Promise.all(tokens.map(async (token) => {
    const key = tokenKey(token);
    const current = await store.get(key, 'json') as string[] | null;
    const ids = Array.isArray(current) ? current.filter((item) => typeof item === 'string' && item !== ref) : [];
    ids.unshift(ref);
    await store.put(key, JSON.stringify(ids.slice(0, MAX_IDS_PER_TOKEN)));
  }));
}

export async function removeSearchDocument(
  store: SearchIndex | undefined,
  type: SearchDocumentType,
  id: string,
  text: string,
): Promise<void> {
  if (!store) return;
  const ref = documentId(type, id);
  await Promise.all(tokenizeSearchText(text).map(async (token) => {
    const key = tokenKey(token);
    const current = await store.get(key, 'json') as string[] | null;
    if (!Array.isArray(current)) return;
    const ids = current.filter((item) => item !== ref);
    if (ids.length) await store.put(key, JSON.stringify(ids));
    else await store.delete(key);
  }));
}

export async function findIndexedDocuments(
  store: SearchIndex | undefined,
  query: string,
): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  if (!store) return scores;
  await Promise.all(tokenizeSearchText(query).map(async (token) => {
    const ids = await store.get(tokenKey(token), 'json') as string[] | null;
    if (!Array.isArray(ids)) return;
    ids.forEach((id) => scores.set(id, (scores.get(id) || 0) + 1));
  }));
  return scores;
}
