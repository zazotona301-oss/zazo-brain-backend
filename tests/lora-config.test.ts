import { describe, expect, it } from 'vitest';
import { ACTIVE_LORA_CONFIG_KEY, resolveActiveLoraId } from '../src/lora-config';

describe('active LoRA configuration', () => {
  it('prefers the active fine-tune ID stored in KV', async () => {
    const store = {
      async get(key: string, type: 'json') {
        expect(key).toBe(ACTIVE_LORA_CONFIG_KEY);
        expect(type).toBe('json');
        return { id: 'new-finetune-id' };
      },
    };

    await expect(resolveActiveLoraId(store, 'legacy-finetune-id')).resolves.toBe('new-finetune-id');
  });

  it('uses the existing configured ID when the KV key is absent or invalid', async () => {
    await expect(resolveActiveLoraId({ async get() { return null; } }, 'legacy-finetune-id')).resolves.toBe('legacy-finetune-id');
    await expect(resolveActiveLoraId({ async get() { return { id: '   ' }; } }, 'legacy-finetune-id')).resolves.toBe('legacy-finetune-id');
  });

  it('keeps the base-model path available if KV and fallback are both empty', async () => {
    await expect(resolveActiveLoraId(undefined, undefined)).resolves.toBeUndefined();
  });

  it('falls back if reading the active key fails', async () => {
    await expect(resolveActiveLoraId({ async get() { throw new Error('KV unavailable'); } }, 'legacy-finetune-id')).resolves.toBe('legacy-finetune-id');
  });
});
