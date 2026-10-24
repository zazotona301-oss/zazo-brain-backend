import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_TTL_SECONDS,
  MAX_CHUNK_BYTES,
  normalizeDatasetText,
  prepareChatPairRecord,
  prepareMemoryRecord,
  splitJsonl,
} from '../src/export';

describe('RAG dataset preparation', () => {
  it('normalizes line endings and trims whitespace without changing Arabic text', () => {
    expect(normalizeDatasetText('  سؤال\r\nإجابة  ')).toBe('سؤال\nإجابة');
    expect(normalizeDatasetText(null)).toBe('');
  });

  it('converts approved complete knowledge into the Colab user/assistant format', () => {
    const prepared = prepareMemoryRecord({
      id: 'memory-1',
      instruction: 'ما معنى الوعي؟',
      context: 'سياق علمي موثّق',
      response: 'الإجابة المراجَعة',
      metadata: { needs_review: false },
      created_at: new Date('2026-10-24T00:00:00Z'),
    });
    expect(prepared.bucket).toBe('ready');
    expect(prepared.record?.messages).toEqual([
      { role: 'user', content: 'ما معنى الوعي؟\n\nسياق مرجعي:\nسياق علمي موثّق' },
      { role: 'assistant', content: 'الإجابة المراجَعة' },
    ]);
    expect(prepared.record?.metadata).toMatchObject({ source_type: 'knowledge', needs_review: false });
  });

  it('keeps flagged or incomplete knowledge separate from training-ready examples', () => {
    const prepared = prepareMemoryRecord({
      id: 'memory-2',
      instruction: 'فقرة تحتاج مراجعة',
      context: '',
      response: '',
      metadata: { needs_review: true },
      created_at: '2026-10-24T00:00:00Z',
    });
    expect(prepared.bucket).toBe('review');
    expect(prepared.record).toMatchObject({
      candidate_question: 'فقرة تحتاج مراجعة',
      candidate_answer: '',
      metadata: { needs_review: true },
    });
    expect(prepared.record).not.toHaveProperty('messages');
  });

  it('keeps chat answers as review candidates rather than trusted training examples', () => {
    const prepared = prepareChatPairRecord({
      id: 'user-message-1',
      conversation_id: 'conversation-1',
      question: 'ما الإجابة؟',
      answer: 'إجابة المساعد',
      created_at: '2026-10-24T00:00:00Z',
    });
    expect(prepared.bucket).toBe('review');
    expect(prepared.record).toMatchObject({
      candidate_question: 'ما الإجابة؟',
      candidate_answer: 'إجابة المساعد',
      metadata: { source_type: 'chat-history', needs_review: true },
    });
    expect(prepared.record).not.toHaveProperty('messages');
  });

  it('splits JSONL by UTF-8 byte size and retains the 31-day TTL', () => {
    expect(splitJsonl(['a', 'b'], 2)).toEqual(['a\n', 'b\n']);
    expect(MAX_CHUNK_BYTES).toBe(1024 * 1024);
    expect(ARCHIVE_TTL_SECONDS).toBe(31 * 24 * 60 * 60);
    expect(() => splitJsonl(['long'], 2)).toThrow(RangeError);
  });
});
