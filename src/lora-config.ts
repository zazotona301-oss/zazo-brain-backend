import type { KVNamespace } from '@cloudflare/workers-types';

export const ACTIVE_LORA_CONFIG_KEY = 'active-lora';

interface LoraConfigReader {
  get(key: string, type: 'json'): Promise<unknown | null>;
}

export async function resolveActiveLoraId(
  store: Pick<KVNamespace, 'get'> | LoraConfigReader | undefined,
  fallbackId?: string,
): Promise<string | undefined> {
  if (store) {
    try {
      const value = await store.get(ACTIVE_LORA_CONFIG_KEY, 'json');
      if (value && typeof value === 'object' && 'id' in value) {
        const id = (value as { id?: unknown }).id;
        if (typeof id === 'string' && id.trim()) return id.trim();
      }
    } catch {
      // Keep chat available if KV is unavailable; use the previously configured ID.
    }
  }

  const configuredFallback = fallbackId?.trim();
  return configuredFallback || undefined;
}
