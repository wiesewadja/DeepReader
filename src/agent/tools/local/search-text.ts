/**
 * search_book Tool - 8-stage hybrid search with block_id level precision
 */

import type { ToolDefinition } from '../../types.js';
import type { ToolExecutor, ToolContext } from '../types.js';
import { searchBookV2 } from '../../../pageindex/book-search-v2.js';

const SEARCH_BOOK_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'search_book',
    description: `在书中搜索关键词，返回匹配段落片段（聚焦到 block_id 级别）。

【搜索逻辑】
- 8 阶段管线：BM25 + 向量语义 + scope 过滤 + 层级加权
- 每个 hit 返回 node 内匹配最密集的段落片段（含 ^block_id）

【返回结果】
- matched_blocks: 匹配的段落片段，可直接引用 ^block_id
- 大部分情况无需再调 read_book_section

【中文搜索技巧】
- 提取核心名词，剔除"如何"、"是什么"等修饰语
- 拆分复合词：不要搜"解决问题的前提"，改用 ["解决问题", "前提"]`,
    parameters: {
      type: 'object',
      properties: {
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: '关键词数组，AND 逻辑'
        },
        scope_node_ids: {
          type: 'array',
          items: { type: 'string' },
          description: '限定搜索范围（章节 ID 列表），留空则全局搜索'
        }
      },
      required: ['keywords']
    }
  }
};

export const searchBookTool: ToolExecutor = {
  definition: SEARCH_BOOK_DEFINITION,

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const { app, pdfName, indexId } = context;
    const keywords = args.keywords as string[];
    const scopeNodeIds = args.scope_node_ids as string[] | undefined;

    if (!app) {
      return JSON.stringify({
        status: 'ERROR_NO_APP_CONTEXT',
        message: '缺少 Obsidian App 实例'
      });
    }

    if (!keywords || keywords.length === 0) {
      return JSON.stringify({
        status: 'ERROR_INVALID_PARAMS',
        message: 'keywords 参数不能为空'
      });
    }

    if (!pdfName) {
      return JSON.stringify({
        status: 'ERROR_NO_BOOK_SELECTED',
        message: '未选择书籍，请先在书库中选择一本书'
      });
    }

    try {
      const vaultPath = (app.vault.adapter as any).basePath;
      const query = keywords.join(' ');

      // 优先使用 indexId（bookId）和 vaultPath，避免路径不匹配
      console.log('[search_book] indexId:', indexId, 'pdfName:', pdfName, 'vaultPath:', vaultPath);
      const searchOptions: any = {
        filePath: '',  // 当 bookId + vaultPath 直接传入时，filePath 仅作为 fallback
        query,
        topK: 5,
        embedding: context.plugin?.settings?.embedding,
        scopeNodeIds,
      };

      if (indexId && vaultPath) {
        searchOptions.bookId = indexId;
        searchOptions.vaultPath = vaultPath;
      } else {
        // Fallback: 从 vault 文件计算路径
        const bookName = pdfName.replace(/\.pdf$/i, '').replace(/\.epub$/i, '');
        const files = app.vault.getFiles();
        const bookFile = files.find(f =>
          f.path.includes(bookName) && (f.extension === 'pdf' || f.extension === 'epub')
        );
        if (!bookFile) {
          return JSON.stringify({
            status: 'ERROR_BOOK_NOT_FOUND',
            message: `未找到书籍文件: ${bookName}`
          });
        }
        searchOptions.filePath = `${vaultPath}/${bookFile.path}`;
      }

      // Call searchBookV2
      const results = await searchBookV2(searchOptions);

      const hits = results.map(r => ({
        node_id: r.nodeId,
        title: r.title,
        file_name: r.fileName,
        path: r.hierarchyPath,
        matched_blocks: r.matchedBlocks.map(b => ({
          block_id: b.blockId,
          content: b.content,
        })),
        score: Math.round(r.score * 100) / 100,
      }));

      return JSON.stringify({
        status: 'SUCCESS',
        total_hits: results.length,
        hits,
        scope_filter: scopeNodeIds ? `已限定在 ${scopeNodeIds.length} 个章节` : '全局搜索'
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return JSON.stringify({
        status: 'ERROR_SEARCH_FAILED',
        message: `搜索失败: ${errorMsg}`
      });
    }
  }
};
