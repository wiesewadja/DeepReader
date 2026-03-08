/**
 * search_pdf Tool - 搜索 PDF 内容
 */

import type { ToolDefinition } from '../types.js';
import type { ToolExecutor, ToolContext } from './types.js';
import { deeppdfClient } from '../../api/http-client.js';
import { log, error as logError } from '../../utils/logger.js';

const SEARCH_PDF_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'search_pdf',
    description: 'Search PDF content for relevant information. Use this to find specific passages, quotes, or information about a topic.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to find relevant content in the PDF',
        },
        top_k: {
          type: 'number',
          description: 'Maximum number of results to return (default: 5)',
        },
      },
      required: ['query'],
    },
  },
};

/**
 * 生成 Obsidian wiki 链接
 *
 * 优先级：
 * 1. 如果有 nodeId 对应的 Markdown 文件，链接到该文件（不带页码锚点，因为章节文件本身就是最小定位单元）
 * 2. 否则链接到 PDF 名称（fallback）
 */
function generateObsidianLink(
  nodeId: string | undefined,
  page: number | undefined,
  pdfName: string,
  markdownFiles?: Record<string, string>
): string {
  // 查找对应的 Markdown 文件
  const markdownFile = nodeId && markdownFiles ? markdownFiles[nodeId] : undefined;

  if (markdownFile) {
    // 有对应的章节文件，直接链接到文件（章节级别的定位）
    // 显示文字使用章节信息会更友好，但这里只有 page，暂时保留
    const displayName = page !== undefined ? `第${page}页` : markdownFile.split('/').pop()?.replace('.md', '') || '查看';
    return `[[${markdownFile}|${displayName}]]`;
  }

  // Fallback: 没有章节文件，链接到 PDF 名称
  if (page !== undefined) {
    return `[[${pdfName}#^page-${page}|第${page}页]]`;
  }
  return `[[${pdfName}]]`;
}

export const searchPdfTool: ToolExecutor = {
  definition: SEARCH_PDF_DEFINITION,

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const query = args.query as string;
    const topK = (args.top_k as number) ?? 5;

    if (!query) {
      return 'Error: query parameter is required';
    }

    try {
      log('[search_pdf] 执行搜索:', { query, topK, indexId: context.indexId });
      log('[search_pdf] context.pdfName:', context.pdfName);
      log('[search_pdf] context.markdownFiles:', context.markdownFiles ? `${Object.keys(context.markdownFiles).length} 个映射` : '无');

      const result = await deeppdfClient.queryPDF(query, context.indexId, topK);

      if (result.status !== 'success' || !result.results || result.results.length === 0) {
        return `No results found for query: "${query}"`;
      }

      // 格式化搜索结果，包含 obsidian_link
      const formattedResults = result.results
        .map((item, index) => {
          const section = item.metadata.section || item.metadata.node_name || 'Unknown Section';
          const page = item.metadata.page;
          const nodeId = item.metadata.node_id;
          const distance = item.metadata.distance !== undefined
            ? ` (relevance: ${(1 - item.metadata.distance).toFixed(2)})`
            : '';

          // 生成 obsidian_link
          const obsidianLink = generateObsidianLink(
            nodeId,
            page,
            context.pdfName,
            context.markdownFiles
          );

          log(`[search_pdf] 结果 ${index + 1}: node_id=${nodeId}, page=${page}, link=${obsidianLink}`);

          return `${index + 1}. **${section}**${page ? ` (Page ${page})` : ''}${distance}
   Link: ${obsidianLink}
   ${item.text.trim()}`;
        })
        .join('\n\n');

      log('[search_pdf] 找到', result.results.length, '条结果');
      return formattedResults;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      logError('[search_pdf] 搜索失败:', errorMsg);
      return `Error searching PDF: ${errorMsg}`;
    }
  },
};
