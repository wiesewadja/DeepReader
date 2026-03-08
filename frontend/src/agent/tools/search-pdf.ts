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

      const result = await deeppdfClient.queryPDF(query, context.indexId, topK);

      if (result.status !== 'success' || !result.results || result.results.length === 0) {
        return `No results found for query: "${query}"`;
      }

      // 格式化搜索结果为编号列表
      const formattedResults = result.results
        .map((item, index) => {
          const section = item.metadata.section || item.metadata.node_name || 'Unknown Section';
          const page = item.metadata.page ? `Page ${item.metadata.page}` : '';
          const distance = item.metadata.distance !== undefined
            ? ` (relevance: ${(1 - item.metadata.distance).toFixed(2)})`
            : '';

          return `${index + 1}. **${section}**${page ? ` (${page})` : ''}${distance}
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
