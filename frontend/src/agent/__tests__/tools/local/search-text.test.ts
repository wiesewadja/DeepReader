/**
 * search_markdown_text 工具测试
 */

import { describe, it, expect, vi } from 'vitest';
import { searchMarkdownTextTool } from '../../../tools/local/search-text.js';
import type { ToolContext } from '../../../tools/types.js';

describe('search_markdown_text', () => {
  // 创建完整的 mock TFile 对象
  const createMockTFile = (path: string, basename: string): any => ({
    path,
    basename,
    extension: 'md',
    name: `${basename}.md`,
    stat: { mtime: Date.now(), ctime: Date.now(), size: 0 },
    parent: null
  });

  const createMockContext = (content: string): ToolContext => {
    const mockFile = createMockTFile('DeepReader/如何阅读一本书/04-第一章.md', '04-第一章');

    return {
      indexId: 'test-idx',
      pdfName: '如何阅读一本书',
      app: {
        vault: {
          getMarkdownFiles: vi.fn().mockReturnValue([mockFile]),
          cachedRead: vi.fn().mockResolvedValue(content)
        },
        metadataCache: {
          getFileCache: vi.fn().mockReturnValue({
            frontmatter: { node_id: '0004', section: '第一篇 > 第一章', level: 1 }
          })
        }
      } as any
    };
  };

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

  it('滑动窗口应匹配相邻段落中的关键词', async () => {
    // 滑动窗口 WINDOW_SIZE=1，上下各取 1 段
    // 所以即使关键词分布在不同段落，只要相邻就能匹配
    const content = 'MECE 原则是重要的。\n\n完全穷尽是另一个话题。';
    const context = createMockContext(content);

    const result = await searchMarkdownTextTool.execute(
      { keywords: ['MECE', '完全穷尽'] },
      context
    );
    const parsed = JSON.parse(result);

    // 新行为：滑动窗口会匹配相邻段落
    expect(parsed.status).toBe('SUCCESS');
    expect(parsed.total_hits).toBe(2); // 两个段落各匹配一次
  });

  it('命中多处应返回 Top 5 + 热力图', async () => {
    const content = Array(12).fill('测试内容').join('\n\n');
    const context = createMockContext(content);

    const result = await searchMarkdownTextTool.execute(
      { keywords: ['测试'] },
      context
    );
    const parsed = JSON.parse(result);

    // 新行为：不再报错，而是返回 Top 5 + 热力图
    expect(parsed.status).toBe('SUCCESS');
    expect(parsed.total_hits).toBe(12);  // 总命中数
    expect(parsed.returned_hits).toBe(5); // 实际返回 Top 5
    expect(parsed.distribution_map).toBeDefined(); // 有热力图
    expect(parsed.hits.length).toBe(5);
  });

  it('命中超过 200 处应返回 TOO_BROAD（物理防爆阀）', async () => {
    // 创建 250 个段落的超长内容
    const content = Array(250).fill('测试内容').join('\n\n');
    const context = createMockContext(content);

    const result = await searchMarkdownTextTool.execute(
      { keywords: ['测试'] },
      context
    );
    const parsed = JSON.parse(result);

    // 超过 200 的物理防爆阀应该触发
    expect(parsed.status).toBe('ERROR_TOO_BROAD');
    expect(parsed.message).toContain('200');
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
