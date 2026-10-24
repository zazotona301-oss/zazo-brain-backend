import { describe, expect, it } from 'vitest';
import {
  classifyWorkersAiFailure,
  fitChatMessages,
  MAX_CHAT_HISTORY_CHARS,
  truncatePromptSection,
} from '../src/chat-context';

describe('chat context limits', () => {
  it('keeps the latest user question and the most recent history within budget', () => {
    const turns = [
      { role: 'user' as const, content: 'سؤال قديم'.repeat(20) },
      { role: 'assistant' as const, content: 'إجابة قديمة'.repeat(20) },
      { role: 'user' as const, content: 'سؤال حالي' },
    ];

    const fitted = fitChatMessages(turns, 80);
    expect(fitted.at(-1)).toEqual({ role: 'user', content: 'سؤال حالي' });
    expect(fitted.reduce((sum, turn) => sum + turn.content.length, 0)).toBeLessThanOrEqual(80);
    expect(fitted.length).toBeLessThanOrEqual(3);
  });

  it('limits a single oversized user turn without exceeding the requested budget', () => {
    const fitted = fitChatMessages([{ role: 'user', content: 'س'.repeat(100) }], 24);
    expect(fitted).toEqual([{ role: 'user', content: 'س'.repeat(24) }]);
  });

  it('caps a retrieved context section and marks the truncation', () => {
    const result = truncatePromptSection('معلومة'.repeat(30), 40);
    expect(result.length).toBeLessThanOrEqual(40);
    expect(result).toContain('[اختصار]');
  });

  it('uses a bounded default history budget', () => {
    const fitted = fitChatMessages([{ role: 'user', content: 'سؤال' }]);
    expect(fitted.reduce((sum, turn) => sum + turn.content.length, 0)).toBeLessThanOrEqual(MAX_CHAT_HISTORY_CHARS);
  });
});

describe('Workers AI error classification', () => {
  it('recognizes context, quota, LoRA, model, and provider errors', () => {
    expect(classifyWorkersAiFailure(new Error('3006: request too large'))).toBe('context_limit');
    expect(classifyWorkersAiFailure(new Error('429 quota exceeded'))).toBe('quota_limit');
    expect(classifyWorkersAiFailure(new Error('5005 LoRA unsupported'))).toBe('lora_configuration');
    expect(classifyWorkersAiFailure(new Error('3042 invalid model'))).toBe('model_configuration');
    expect(classifyWorkersAiFailure(new Error('503 service unavailable'))).toBe('provider_unavailable');
  });

  it('classifies unrecognized provider errors without exposing their text', () => {
    expect(classifyWorkersAiFailure(new Error('unclassified provider failure'))).toBe('unknown');
  });
});
