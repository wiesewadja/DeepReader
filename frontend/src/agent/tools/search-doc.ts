/**
 * search_doc Tool - 搜索文档内容（支持 PDF、EPUB 等）
 */

import type { ToolDefinition } from '../types.js';
import type { ToolExecutor, ToolContext } from './types.js';
import { deeppdfClient } from '../../api/http-client.js';
import { toolsLog as log, error as logError } from '../../utils/logger.js';
import {
  updateReadingProgress,
  extractChapterIndexFromNodeId,
  FAMILIARITY_DELTAS,
} from '../utils/book-note.js';

const SEARCH_DOC_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'search_doc',
    description: 'Search document content for relevant information. Use this to find specific passages, quotes, or information about a topic. Supports PDF, EPUB and other document formats.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to find relevant content in the document',
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
 * 2. 否则链接到文档名称（fallback）
 */
function generateObsidianLink(
  nodeId: string | undefined,
  section: string | undefined,
  docName: string,
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

  // Fallback: 没有章节文件，使用 section 或文档名称
  if (section) {
    return `[[${docName}|${section}]]`;
  }
  return `[[${docName}]]`;
}

export const searchDocTool: ToolExecutor = {
  definition: SEARCH_DOC_DEFINITION,

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const query = args.query as string;
    const topK = (args.top_k as number) ?? 5;
    const useLLMTreeSearch = context.useLLMTreeSearch ?? false;

    if (!query) {
      return 'Error: query parameter is required';
    }

    try {
      log('[search_doc] 执行搜索:', { query, topK, indexId: context.indexId, useLLMTreeSearch });
      log('[search_doc] context.pdfName:', context.pdfName);
      log('[search_doc] context.markdownFiles:', context.markdownFiles ? `${Object.keys(context.markdownFiles).length} 个映射` : '无');

      const result = await deeppdfClient.queryPDF(query, context.indexId, topK, useLLMTreeSearch);

      if (result.status !== 'success' || !result.results || result.results.length === 0) {
        // 即使没有结果，也返回 thinking 信息（如果有）
        let noResultMsg = `No results found for query: "${query}"`;
        if (result.thinking) {
          noResultMsg = `### 🧠 Deep Search Thinking\n\n${result.thinking}\n\n---\n\n${noResultMsg}`;
        }
        if (result.fallback) {
          noResultMsg = `⚠️ Fallback to hybrid search: ${result.fallback_reason || 'Unknown reason'}\n\n${noResultMsg}`;
        }
        return noResultMsg;
      }

      // 构建结果前缀（包含 thinking 和 fallback 信息）
      let resultPrefix = '';
      if (result.thinking) {
        resultPrefix += `### 🧠 Deep Search Thinking\n\n${result.thinking}\n\n---\n\n`;
      }
      if (result.fallback) {
        resultPrefix += `⚠️ Fallback to hybrid search: ${result.fallback_reason || 'Unknown reason'}\n\n`;
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

          log(`[search_doc] 结果 ${index + 1}: node_id=${nodeId}, page=${page}, link=${obsidianLink}`);

          return `${index + 1}. **${section}**${page ? ` (Page ${page})` : ''}${distance}
   Link: ${obsidianLink}
   node_id: ${nodeId || 'N/A'}
   ${item.text.trim()}`;
        })
        .join('\n\n');

      log('[search_doc] 找到', result.results.length, '条结果');

      // 自动更新搜索结果的章节熟悉度（user_question 触发）
      scheduleFamiliarityUpdateForSearchResults(result.results, context);

      return resultPrefix + formattedResults;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      logError('[search_doc] 搜索失败:', errorMsg);
      return `Error searching document: ${errorMsg}`;
    }
  },
};

/**
 * 为搜索结果自动更新熟悉度（fire-and-forget）
 * 用户提问涉及的章节 +1
 */
function scheduleFamiliarityUpdateForSearchResults(
  results: Array<{ metadata: { node_id?: string } }>,
  context: ToolContext
): void {
  if (!context.app || !context.pdfName) {
    log('[search_doc] 缺少 app 或 pdfName，跳过熟悉度更新');
    return;
  }

  // 收集所有唯一的章节索引
  const chapterIndices = new Set<number>();
  for (const result of results) {
    const nodeId = result.metadata.node_id;
    if (nodeId) {
      const chapterIndex = extractChapterIndexFromNodeId(nodeId);
      if (chapterIndex !== null) {
        chapterIndices.add(chapterIndex);
      }
    }
  }

  // 异步更新每个章节的熟悉度
  void (async () => {
    const indexId = context.indexId || context.pdfName;
    const totalChapters = context.readingProgress?.totalChapters || 100;

    for (const chapterIndex of chapterIndices) {
      try {
        await updateReadingProgress(
          context.app!,
          context.pdfName!,
          indexId,
          totalChapters,
          chapterIndex,
          FAMILIARITY_DELTAS.user_question
        );
        log('[search_doc] 熟悉度更新成功，章节:', chapterIndex);
      } catch (err) {
        logError('[search_doc] 熟悉度更新失败，章节:', chapterIndex, err);
      }
    }
  })();
}
