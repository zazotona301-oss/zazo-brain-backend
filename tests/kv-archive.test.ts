import { describe, expect, it, vi } from 'vitest';
import { ARCHIVE_TTL_SECONDS } from '../src/export';
import { archiveRecord, deleteArchiveKey, deleteArchivePrefix, type ArchiveKV } from '../src/kv-archive';

describe('KV archives', () => {
  it('stores a JSON record with the shared archive TTL', async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const store = { put, delete: vi.fn(), list: vi.fn() } as unknown as ArchiveKV;
    const record = { recordType: 'chat-message', content: 'test' };

    await expect(archiveRecord(store, 'chat/v1/conversation/message.json', record)).resolves.toBe(true);
    expect(put).toHaveBeenCalledWith('chat/v1/conversation/message.json', JSON.stringify(record), { expirationTtl: ARCHIVE_TTL_SECONDS });
  });

  it('reports a missing KV binding without failing Neon persistence callers', async () => {
    await expect(archiveRecord(undefined, 'knowledge/v1/id.json', {})).resolves.toBe(false);
  });

  it('deletes every key under a conversation prefix', async () => {
    const deleted: string[] = [];
    const store = {
      put: vi.fn(),
      delete: vi.fn(async (key: string) => { deleted.push(key); }),
      list: vi.fn(async () => ({ keys: [{ name: 'chat/v1/c1/m1.json' }, { name: 'chat/v1/c1/m2.json' }], list_complete: true, cacheStatus: null }))
    } as unknown as ArchiveKV;

    await expect(deleteArchivePrefix(store, 'chat/v1/c1/')).resolves.toBe(true);
    expect(deleted).toEqual(['chat/v1/c1/m1.json', 'chat/v1/c1/m2.json']);
  });

  it('deletes one archived record', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const store = { put: vi.fn(), delete: remove, list: vi.fn() } as unknown as ArchiveKV;

    await expect(deleteArchiveKey(store, 'knowledge/v1/id.json')).resolves.toBe(true);
    expect(remove).toHaveBeenCalledWith('knowledge/v1/id.json');
  });
});
