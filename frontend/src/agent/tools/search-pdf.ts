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
 * 从文件名中提取章节名
 * 例如: "09-苏秦合纵.md" -> "苏秦合纵"
 */
function extractChapterName(filename: string): string {
  const name = filename.replace('.md', '');
  // 移除开头的数字和连缀（如 "09-", "1-", "001-"）
  const match = name.match(/^\d+[-\s]*(.+)$/);
  return match ? match[1] : name;
}

/**
 * 生成 Obsidian wiki 链接
 *
 * 优先级：
 * 1. 如果有 nodeId 对应的 Markdown 文件，链接到该文件，显示章节名
 * 2. 否则链接到 PDF 名称（fallback）
 */
function generateObsidianLink(
  nodeId: string | undefined,
  section: string | undefined,
  pdfName: string,
  markdownFiles?: Record<string, string>
): string {
  // 查找对应的 Markdown 文件
  const markdownFile = nodeId && markdownFiles ? markdownFiles[nodeId] : undefined;

  if (markdownFile) {
    // 有对应的章节文件，使用章节名作为显示文字
    const filename = markdownFile.split('/').pop() || '';
    const chapterName = extractChapterName(filename);
    return `[[${markdownFile}|${chapterName}]]`;
  }

  // Fallback: 没有章节文件，使用 section 或 PDF 名称
  if (section) {
    return `[[${pdfName}|${section}]]`;
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
            section,
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
