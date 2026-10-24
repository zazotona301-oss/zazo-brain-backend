import { describe, expect, it } from 'vitest';
import {
  createTrainingUploadName,
  invalidArabicTrainingRows,
  isSupportedTrainingFile,
  parseTrainingFile,
  totalTrainingTextCharacters,
  trainingRowId,
  trainingRowsSchema,
} from '../src/training-upload';

describe('training file upload validation', () => {
  it('accepts only structured dataset formats', () => {
    expect(isSupportedTrainingFile('qa.jsonl')).toBe(true);
    expect(isSupportedTrainingFile('qa.CSV')).toBe(true);
    expect(isSupportedTrainingFile('كتاب.pdf')).toBe(false);
    expect(isSupportedTrainingFile('notes.txt')).toBe(false);
  });

  it('parses BOM-prefixed JSONL, JSON records, and ShareGPT turns', () => {
    const jsonl = '\uFEFF{"instruction":"ما معنى المعرفة؟","response":"المعرفة إدراك منظم."}\n';
    expect(parseTrainingFile('examples.jsonl', jsonl)).toMatchObject([
      { instruction: 'ما معنى المعرفة؟', response: 'المعرفة إدراك منظم.', sourceRow: 1 },
    ]);
    const sharegpt = JSON.stringify([{ messages: [
      { role: 'user', content: 'ما التفكير؟' },
      { role: 'assistant', content: 'التفكير عملية عقلية.' },
      { role: 'user', content: 'ما فائدته؟' },
      { role: 'assistant', content: 'يساعد على الفهم واتخاذ القرار.' },
    ] }]);
    expect(parseTrainingFile('examples.json', sharegpt)).toMatchObject([
      { instruction: 'ما التفكير؟', response: 'التفكير عملية عقلية.', sourceRow: 1 },
      { instruction: 'ما فائدته؟', response: 'يساعد على الفهم واتخاذ القرار.', sourceRow: 1 },
    ]);
  });

  it('parses quoted commas, escaped quotes, and embedded newlines in CSV', () => {
    const csv = 'question,context,answer,tags\n"ما معنى المعرفة؟","سياق, فيه فاصلة\nوسطر ثانٍ","المعرفة ""إدراك"" منظم.","فلسفة,تعلم"';
    expect(parseTrainingFile('examples.csv', csv)).toMatchObject([
      {
        instruction: 'ما معنى المعرفة؟',
        context: 'سياق, فيه فاصلة\nوسطر ثانٍ',
        response: 'المعرفة "إدراك" منظم.',
        tags: ['فلسفة', 'تعلم'],
        sourceRow: 2,
      },
    ]);
  });

  it('rejects malformed JSONL, missing columns, duplicate headers, and unclosed CSV quotes', () => {
    expect(() => parseTrainingFile('examples.jsonl', '{bad json}')).toThrow(/سطر JSONL رقم 1/);
    expect(() => parseTrainingFile('examples.csv', 'prompt,notes\nسؤال,جواب')).toThrow(/أعمدة instruction/);
    expect(() => parseTrainingFile('examples.csv', 'question,question,answer\nسؤال,سؤال,جواب')).toThrow(/غير مكررة/);
    expect(() => parseTrainingFile('examples.csv', 'question,answer\n"سؤال,جواب')).toThrow(/غير مغلق/);
  });

  it('parses complete instruction/response records and requires Arabic content', () => {
    const parsed = trainingRowsSchema.safeParse([
      { instruction: 'ما معنى المعرفة؟', context: '', response: 'المعرفة هي إدراك منظم للمعلومات.', tags: ['فلسفة'], sourceRow: 2 },
    ]);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(invalidArabicTrainingRows(parsed.data)).toEqual([]);

    const english = trainingRowsSchema.parse([
      { instruction: 'What is knowledge?', response: 'Knowledge is organized information.' },
    ]);
    expect(invalidArabicTrainingRows(english)).toEqual([1]);
    expect(() => parseTrainingFile('examples.json', JSON.stringify([{ instruction: 'ما المعرفة؟', response: '' }]))).toThrow(/ناقص/);
  });

  it('rejects excessive record counts and reports total text length', () => {
    expect(trainingRowsSchema.safeParse(Array.from({ length: 1_001 }, () => ({ instruction: 'سؤال عربي', response: 'إجابة عربية' }))).success).toBe(false);
    const rows = trainingRowsSchema.parse([
      { instruction: 'سؤال', context: 'سياق', response: 'جواب' },
      { instruction: 'ثانٍ', response: 'رد' },
    ]);
    expect(totalTrainingTextCharacters(rows)).toBe(18);
  });

  it('creates safe unique batch names that retain a recognizable source stem', () => {
    const createdAt = new Date('2026-10-25T00:00:00.000Z');
    const first = createTrainingUploadName('علوم عربية.jsonl', '123e4567-e89b-42d3-a456-426614174000', createdAt);
    const second = createTrainingUploadName('علوم عربية.jsonl', '123e4567-e89b-42d3-a456-426614174001', createdAt);
    expect(first).toContain('zazo-training-20261025T000000000Z-123e4567-e89b-42d3-a456-426614174000-training-file.jsonl');
    expect(second).not.toBe(first);
    expect(first).toMatch(/^[A-Za-z0-9_.-]+$/);
  });

  it('generates deterministic distinct UUIDs for each row of one upload', async () => {
    const uploadId = '123e4567-e89b-42d3-a456-426614174000';
    const first = await trainingRowId(uploadId, 1);
    expect(first).toBe(await trainingRowId(uploadId, 1));
    expect(first).not.toBe(await trainingRowId(uploadId, 2));
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
