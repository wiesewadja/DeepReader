/**
 * get_document_outline 工具测试
 *
 * TODO: 模块 get-outline.ts 尚未创建，暂时跳过
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
// import { getDocumentOutlineTool } from '../../../tools/local/get-outline.js';
import type { ToolContext } from '../../../tools/types.js';

describe.skip('get_document_outline', () => {
  const createMockContext = (): ToolContext => ({
    indexId: 'test-idx',
    pdfName: '如何阅读一本书',
    app: {
      vault: {
        getMarkdownFiles: vi.fn().mockReturnValue([
          { path: 'DeepReader/如何阅读一本书/04-第一章.md' },
          { path: 'DeepReader/如何阅读一本书/05-第二章.md' },
          { path: 'DeepReader/如何阅读一本书/如何阅读一本书.md' }, // 主文件，应被排除
        ]),
        cachedRead: vi.fn().mockResolvedValue('内容 ^block1')
      },
      metadataCache: {
        getFileCache: vi.fn().mockImplementation((file: any) => {
          if (file.path.includes('第一章')) {
            return {
              frontmatter: {
                node_id: '0004',
                section: '第一篇 > 第一章',
                level: 1,
                summary: '本章探讨...'
              }
            };
          }
          if (file.path.includes('第二章')) {
            return {
              frontmatter: {
                node_id: '0005',
                section: '第一篇 > 第二章',
                level: 1,
                summary: '第二章内容'
              }
            };
          }
          return { frontmatter: {} };
        })
      }
    } as any
  });

  it('应返回大纲树结构', async () => {
    const result = await getDocumentOutlineTool.execute({}, createMockContext());
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe('SUCCESS');
    expect(parsed.book_title).toBe('如何阅读一本书');
    expect(Array.isArray(parsed.outline)).toBe(true);
    expect(parsed.total_chapters).toBe(2);
  });

  it('max_depth 应限制层级深度', async () => {
    const result = await getDocumentOutlineTool.execute(
      { max_depth: 1 },
      createMockContext()
    );
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe('SUCCESS');
  });

  it('缺少 app 时应返回错误', async () => {
    const context = { ...createMockContext(), app: undefined };
    const result = await getDocumentOutlineTool.execute({}, context);
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe('ERROR_NO_APP_CONTEXT');
  });

  it('无章节文件时应返回 ERROR_NO_FILES', async () => {
    const context: ToolContext = {
      indexId: 'test-idx',
      pdfName: '不存在的书',
      app: {
        vault: {
          getMarkdownFiles: vi.fn().mockReturnValue([]),
          cachedRead: vi.fn()
        },
        metadataCache: {
          getFileCache: vi.fn()
        }
      } as any
    };

    const result = await getDocumentOutlineTool.execute({}, context);
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe('ERROR_NO_FILES');
  });
});
