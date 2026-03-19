/**
 * search_markdown_text 工具测试
 */

import { describe, it, expect, vi } from 'vitest';
import { searchMarkdownTextTool } from '../../../tools/local/search-text.js';
import type { ToolContext } from '../../../tools/types.js';

describe('search_markdown_text', () => {
  const createMockContext = (content: string): ToolContext => ({
    indexId: 'test-idx',
    pdfName: '如何阅读一本书',
    app: {
      vault: {
        getMarkdownFiles: vi.fn().mockReturnValue([
          { path: 'DeepReader/如何阅读一本书/04-第一章.md', basename: '04-第一章' }
        ]),
        cachedRead: vi.fn().mockResolvedValue(content)
      },
      metadataCache: {
        getFileCache: vi.fn().mockReturnValue({
          frontmatter: { node_id: '0004', section: '第一篇 > 第一章', level: 1 }
        })
      }
    } as any
  });

  it('AND 匹配应要求所有关键词同时出现', async () => {
    const content = 'MECE 原则是重要的。完全穷尽是关键。';
    const context = createMockContext(content);

    const result = await searchMarkdownTextTool.execute(
      { keywords: ['MECE', '完全穷尽'] },
      context
    );
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe('SUCCESS');
    expect(parsed.hits).toHaveLength(1);
  });

  it('关键词不在同一段落应返回 NOT_FOUND', async () => {
    const content = 'MECE 原则是重要的。\n\n完全穷尽是另一个话题。';
    const context = createMockContext(content);

    const result = await searchMarkdownTextTool.execute(
      { keywords: ['MECE', '完全穷尽'] },
      context
    );
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe('ERROR_NOT_FOUND');
  });

  it('命中超过 10 处应返回 TOO_BROAD', async () => {
    const content = Array(12).fill('测试内容').join('\n\n');
    const context = createMockContext(content);

    const result = await searchMarkdownTextTool.execute(
      { keywords: ['测试'] },
      context
    );
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe('ERROR_TOO_BROAD');
  });

  it('use_regex 应启用正则匹配', async () => {
    const content = '管理矩阵和管理象限都是工具。';
    const context = createMockContext(content);

    const result = await searchMarkdownTextTool.execute(
      { keywords: ['管理.*(矩阵|象限)'], use_regex: true },
      context
    );
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe('SUCCESS');
    expect(parsed.hits).toHaveLength(1);
  });

  it('缺少 keywords 应返回 INVALID_PARAMS', async () => {
    const context = createMockContext('内容');
    const result = await searchMarkdownTextTool.execute({}, context);
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe('ERROR_INVALID_PARAMS');
  });

  it('缺少 app 应返回 NO_APP_CONTEXT', async () => {
    const context = { ...createMockContext('内容'), app: undefined };
    const result = await searchMarkdownTextTool.execute({ keywords: ['test'] }, context);
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe('ERROR_NO_APP_CONTEXT');
  });
});
