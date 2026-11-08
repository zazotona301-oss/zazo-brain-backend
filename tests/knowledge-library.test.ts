import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { buildKnowledgeMatchQuery, extractPageReference, searchKnowledge } from '../src/knowledge-library';

describe('D1 knowledge retrieval', () => {
  it('builds a content-only Arabic FTS query and removes common question words', () => {
    const match = buildKnowledgeMatchQuery('من هو مؤلف كتاب الإسلام وفلسفة الحكم؟ أجب باختصار اعتمادًا على مكتبة المعرفة.');

    expect(match).toContain('content : (');
    expect(match).toContain('"مؤلف"');
    expect(match).toContain('"المؤلف"');
    expect(match).toContain('"الإسلام"');
    expect(match).toContain('"فلسفة"');
    expect(match).not.toContain('"الكتاب"');
    expect(match).not.toContain('"من"');
    expect(match).not.toContain('"مكتبة"');
    expect(match).not.toContain('"المعرفة"');
  });

  it('returns an empty FTS query when the question only contains stop words', () => {
    expect(buildKnowledgeMatchQuery('من هو في على من')).toBe('');
  });

  it('quotes search terms so FTS operators from user input are not treated as syntax', () => {
    const match = buildKnowledgeMatchQuery('شرح OR * "موضوع سياسي"');

    expect(match).toContain('content : (');
    expect(match).not.toMatch(/\bOR\s+\*/);
    expect(match).toContain('"سياسي"');
  });

  it('extracts source page references from indexed chunks', () => {
    expect(extractPageReference('===== صفحة المصدر 008 =====\nنص')).toBe('8');
    expect(extractPageReference('===== صفحة المصدر 052 =====\nنص\n===== صفحة المصدر 053 =====')).toBe('52–53');
    expect(extractPageReference('مقتطف بلا علامة صفحة')).toBeNull();
  });

  it('returns the full indexed chunk and page-aware metadata from D1', async () => {
    const rows = [{
      title: 'الإسلام_وفلسفة_الحكم_نص_مستخرج.txt',
      path: 'knowledge/uploads/الإسلام_وفلسفة_الحكم_نص_مستخرج.txt',
      chunk_id: '82557f39a397830a5612dbc03677379a37d3a1d4:9',
      content: 'عنوانها نظرية الإمامة عند المعتزلة\n===== صفحة المصدر 008 =====',
      rank: -1.2,
    }];
    const all = vi.fn().mockResolvedValue({ results: rows });
    const bind = vi.fn().mockReturnValue({ all });
    const prepare = vi.fn().mockReturnValue({ bind });
    const env = { KNOWLEDGE_01: { prepare } } as unknown as Env;

    const sources = await searchKnowledge(env, 'ما موقف المعتزلة من الإمامة؟', 3);

    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('JOIN knowledge_chunks ON knowledge_chunks.id = knowledge_fts.chunk_id'));
    expect(bind).toHaveBeenCalledWith(expect.stringContaining('content : ('), 10);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      title: 'الإسلام_وفلسفة_الحكم_نص_مستخرج.txt',
      chunk: 9,
      pageReference: '8',
      content: 'عنوانها نظرية الإمامة عند المعتزلة\n===== صفحة المصدر 008 =====',
    });
  });
});
