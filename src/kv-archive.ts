import type { KVNamespace } from '@cloudflare/workers-types';
import { ARCHIVE_TTL_SECONDS } from './export';

export type ArchiveKV = Pick<KVNamespace, 'put' | 'delete' | 'list'>;

export async function archiveRecord(
  store: ArchiveKV | undefined,
  key: string,
  record: unknown,
): Promise<boolean> {
  if (!store) return false;
  try {
    await store.put(key, JSON.stringify(record), { expirationTtl: ARCHIVE_TTL_SECONDS });
    return true;
  } catch (error) {
    console.error('KV record archive failed', { key, error: error instanceof Error ? error.message : 'unknown error' });
    return false;
  }
}

export async function deleteArchiveKey(store: ArchiveKV | undefined, key: string): Promise<boolean> {
  if (!store) return false;
  try {
    await store.delete(key);
    return true;
  } catch (error) {
    console.error('KV record deletion failed', { key, error: error instanceof Error ? error.message : 'unknown error' });
    return false;
  }
}

export async function deleteArchivePrefix(store: ArchiveKV | undefined, prefix: string): Promise<boolean> {
  if (!store) return false;
  try {
    let cursor: string | undefined;
    let complete = false;
    while (!complete) {
      const page = await store.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
      for (let start = 0; start < page.keys.length; start += 100) {
        await Promise.all(page.keys.slice(start, start + 100).map(({ name }) => store.delete(name)));
      }
      if (page.list_complete) {
        complete = true;
        continue;
      }
      if (!page.cursor || page.cursor === cursor) throw new Error('KV list did not return a next cursor');
      cursor = page.cursor;
    }
    return true;
  } catch (error) {
    console.error('KV prefix deletion failed', { prefix, error: error instanceof Error ? error.message : 'unknown error' });
    return false;
  }
}
