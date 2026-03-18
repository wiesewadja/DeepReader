/**
 * search_doc Tool - 搜索文档内容（支持 PDF、EPUB 等）
 */

import type { ToolDefinition } from '../types.js';
import type { ToolExecutor, ToolContext } from './types.js';
import { deeppdfClient } from '../../api/http-client.js';
import { toolsLog as log, error as logError } from '../../utils/logger.js';

// 性能优化常量：限制返回内容大小，防止 token 膨胀
const MAX_TEXT_LENGTH_PER_RESULT = 1500;  // 单条结果最大字符数
const DEFAULT_TOP_K = 3;                   // 默认返回结果数（从 5 减少到 3）

const SEARCH_DOC_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'search_doc',
    description: `【检视阅读】搜索文档内容。用于"讲什么/总结"类问题。传入完整问题（非关键词）。`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '用户的完整问题（不要简化为关键词）',
        },
        top_k: {
          type: 'number',
          description: `Maximum number of results to return (default: ${DEFAULT_TOP_K})`,
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
    const topK = (args.top_k as number) ?? DEFAULT_TOP_K;
    const useLLMTreeSearch = context.useLLMTreeSearch ?? false;
    const scopeNodeIds = context.scopeNodeIds;

    if (!query) {
      return 'Error: query parameter is required';
    }

    try {
      log('[search_doc] 执行搜索:', { query, topK, indexId: context.indexId, useLLMTreeSearch, scopeNodeIds });
      log('[search_doc] context.pdfName:', context.pdfName);
      log('[search_doc] context.markdownFiles:', context.markdownFiles ? `${Object.keys(context.markdownFiles).length} 个映射` : '无');

      const result = await deeppdfClient.queryPDF(query, context.indexId, topK, useLLMTreeSearch, scopeNodeIds);

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

      // 格式化搜索结果
      const formattedResults = result.results
        .map((item, index) => {
          const type = item.metadata.type || 'section';
          const isParagraph = type === 'paragraph';
          const page = item.metadata.page;
          const nodeId = (item.metadata as any).node_id || (item.metadata as any).parent_node_id || 'N/A';

          // 生成 Obsidian 链接
          let obsidianLink: string;
          if (isParagraph) {
            const blockId = item.metadata.block_id || '';
            const markdownPath = item.metadata.markdown_path;
            if (markdownPath && blockId) {
              obsidianLink = `[[${markdownPath}#${blockId}]]`;
            } else if (blockId) {
              obsidianLink = `[[${context.pdfName}#${blockId}]]`;
            } else {
              obsidianLink = `[[${context.pdfName}]]`;
            }
          } else {
            const section = item.metadata.section || item.metadata.node_name || 'Unknown';
            obsidianLink = generateObsidianLink(
              nodeId !== 'N/A' ? nodeId : undefined,
              section,
              context.pdfName,
              context.markdownFiles
            );
          }

          // 内容处理：截断过长文本
          const trimmedText = item.text.trim();
          const truncatedText = trimmedText.length > MAX_TEXT_LENGTH_PER_RESULT
            ? trimmedText.slice(0, MAX_TEXT_LENGTH_PER_RESULT) + '...[已截断]'
            : trimmedText;

          // 统一格式：Link + nodeId + 页码 + 内容
          const pageInfo = page ? `p.${page}` : '';
          const nodeInfo = `node: ${nodeId}`;

          return `${index + 1}. ${obsidianLink} (${pageInfo}, ${nodeInfo})
> ${truncatedText.replace(/\n/g, '\n> ')}`;
        })
        .join('\n\n');

      log('[search_doc] 找到', result.results.length, '条结果');

      return resultPrefix + formattedResults;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      logError('[search_doc] 搜索失败:', errorMsg);
      return `Error searching document: ${errorMsg}`;
    }
  },
};
