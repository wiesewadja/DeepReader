/**
 * search_markdown_text Tool - 使用 Page Index 搜索
 */

import type { ToolDefinition } from '../../types.js';
import type { ToolExecutor, ToolContext } from '../types.js';
import type { SearchHit } from './types.js';
import { searchBook } from '../../../pageindex/book-search.js';

const SEARCH_TEXT_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'search_markdown_text',
    description: `在书中搜索关键词，返回匹配的段落位置。

【搜索逻辑】
- 使用混合搜索（向量 + BM25）找到最相关的章节
- 返回 Top 5 最相关的片段

【返回结果】
- 返回 Top 5 最相关的片段
- 包含 distribution_map 热力图，显示各章节命中分布
- 如 total_hits > 20，建议换更精准的词重新搜索

【中文搜索技巧】
- 提取核心名词，剔除"如何"、"是什么"等修饰语
- 同义词用正则："(边界|边缘|界限)"
- 拆分复合词：不要搜"解决问题的前提"，改用 ["解决问题", "前提"]`,
    parameters: {
      type: 'object',
      properties: {
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: '关键词数组，会拼接为查询字符串'
        },
        scope_node_ids: {
          type: 'array',
          items: { type: 'string' },
          description: '限定搜索范围（章节 ID 列表），留空则全局搜索'
        },
        use_regex: {
          type: 'boolean',
          description: '启用正则表达式匹配（默认 false）。开启后支持 (A|B) 同义词'
        }
      },
      required: ['keywords']
    }
  }
};

export const searchMarkdownTextTool: ToolExecutor = {
  definition: SEARCH_TEXT_DEFINITION,

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const { app, pdfName } = context;
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
      // 构建书籍路径
      const vaultPath = (app.vault.adapter as any).basePath;
      const bookName = pdfName.replace(/\.pdf$/i, '').replace(/\.epub$/i, '');
      
      // 查找书籍文件
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
      
      const filePath = `${vaultPath}/${bookFile.path}`;
      const query = keywords.join(' ');
      
      // 调用 searchBook
      const results = await searchBook({
        filePath,
        query,
        topK: 5,
        embedding: context.plugin?.settings?.embedding,
      });

      // 转换为工具结果格式
      const hits: SearchHit[] = results.map(r => ({
        node_id: r.nodeId,
        location: {
          heading: r.chapterTitle,
          path: [r.chapterTitle],
          file_path: r.mdFilePath,
        },
        snippet: r.rawText.slice(0, 150),
        block_id: extractFirstBlockId(r.rawText),
      }));

      // 构建热力图
      const distributionMap = buildDistributionMap(results);

      // 过滤 scope（如果指定）
      let filteredHits = hits;
      if (scopeNodeIds && scopeNodeIds.length > 0) {
        const scopeSet = new Set(scopeNodeIds);
        filteredHits = hits.filter(h => scopeSet.has(h.node_id));
      }

      return JSON.stringify({
        status: 'SUCCESS',
        total_hits: results.length,
        returned_hits: filteredHits.length,
        distribution_map: distributionMap,
        hits: filteredHits,
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

/**
 * 提取第一个 block ID
 */
function extractFirstBlockId(text: string): string {
  const match = text.match(/\^([\w-]+)/);
  return match ? `^${match[1]}` : '';
}

/**
 * 构建分布热力图
 */
function buildDistributionMap(results: any[]): Record<string, { count: number; node_id: string; path: string }> {
  const distribution: Record<string, { count: number; node_id: string; path: string }> = {};

  for (const result of results) {
    const heading = result.chapterTitle;
    
    if (!distribution[heading]) {
      distribution[heading] = {
        count: 0,
        node_id: result.nodeId,
        path: result.chapterTitle,
      };
    }
    distribution[heading].count += 1;
  }

  return distribution;
}
