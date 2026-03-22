/**
 * read_markdown_section 工具测试
 */

import { describe, it, expect, vi } from 'vitest';
import { readMarkdownSectionTool } from '../../../tools/local/read-section.js';
import type { ToolContext } from '../../../tools/types.js';

describe('read_markdown_section', () => {
  const createMockContext = (content: string): ToolContext => ({
    indexId: 'test-idx',
    pdfName: '如何阅读一本书',
    app: {
      vault: {
        getMarkdownFiles: vi.fn().mockReturnValue([
          { path: 'DeepReader/如何阅读一本书/04-MECE原则.md', basename: '04-MECE原则' }
        ]),
        cachedRead: vi.fn().mockResolvedValue(content)
      },
      metadataCache: {
        getFileCache: vi.fn().mockReturnValue({
          frontmatter: { node_id: '0004', section: '第一篇 > MECE原则', level: 2 }
        })
      }
    } as any
  });

  it('应返回完整章节内容', async () => {
    const content = '# MECE原则\n\n这是内容。';
    const context = createMockContext(content);

    const result = await readMarkdownSectionTool.execute(
      { heading: 'MECE' },
      context
    );
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe('SUCCESS_FULL_SECTION');
    expect(parsed.content).toContain('MECE');
  });

  it('超限内容应返回截断+子标题', async () => {
    // 生成超长内容（中文确保 token 估算正确）
    const longContent = '# MECE原则\n\n' + '这是测试内容。'.repeat(3000);  // 约 18000 tokens
    const context = createMockContext(longContent);

    const result = await readMarkdownSectionTool.execute(
      { heading: 'MECE' },  // 匹配 mock 的 section
      context
    );
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe('WARNING_SECTION_TOO_LARGE');
    expect(parsed.overview_text).toBeDefined();
    expect(parsed.sub_headings).toBeDefined();
  });

  it('未找到标题应返回 NOT_FOUND', async () => {
    const content = '# 其他标题\n\n内容';
    const context = createMockContext(content);

    const result = await readMarkdownSectionTool.execute(
      { heading: '不存在的标题' },
      context
    );
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe('ERROR_NOT_FOUND');
  });

  it('block_id 应定位到对应章节', async () => {
    const content = '内容 ^block123';
    const context = createMockContext(content);

    const result = await readMarkdownSectionTool.execute(
      { block_id: '^block123' },
      context
    );
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe('SUCCESS_FULL_SECTION');
  });

  it('缺少参数应返回 INVALID_PARAMS', async () => {
    const context = createMockContext('内容');
    const result = await readMarkdownSectionTool.execute({}, context);
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe('ERROR_INVALID_PARAMS');
  });

  it('缺少 app 应返回 NO_APP_CONTEXT', async () => {
    const context = { ...createMockContext('内容'), app: undefined };
    const result = await readMarkdownSectionTool.execute({ heading: 'test' }, context);
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe('ERROR_NO_APP_CONTEXT');
  });

  it('多匹配应返回候选列表', async () => {
    const context: ToolContext = {
      indexId: 'test-idx',
      pdfName: '如何阅读一本书',
      app: {
        vault: {
          getMarkdownFiles: vi.fn().mockReturnValue([
            { path: 'DeepReader/如何阅读一本书/04-第一章-MECE.md', basename: '04-第一章-MECE' },
            { path: 'DeepReader/如何阅读一本书/05-第二章-MECE.md', basename: '05-第二章-MECE' }
          ]),
          cachedRead: vi.fn().mockResolvedValue('内容')
        },
        metadataCache: {
          getFileCache: vi.fn().mockImplementation((file: any) => ({
            frontmatter: {
              section: file.path.includes('第一章') ? '第一章 > MECE' : '第二章 > MECE'
            }
          }))
        }
      } as any
    };

    const result = await readMarkdownSectionTool.execute({ heading: 'MECE' }, context);
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe('ERROR_MULTIPLE_MATCHES');
    expect(parsed.candidates).toHaveLength(2);
  });
});
