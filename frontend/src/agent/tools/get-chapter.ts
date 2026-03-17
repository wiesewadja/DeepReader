/**
 * get_chapter Tool - 获取章节内容
 *
 * 优化策略：
 * - 默认返回 summary（精炼摘要，~500 字符）
 * - detail=true 时返回原文（用于深度分析）
 * - 支持分页读取长章节
 */

import { TFile } from 'obsidian';
import type { ToolDefinition } from '../types.js';
import type { ToolExecutor, ToolContext } from './types.js';
import { deeppdfClient } from '../../api/http-client.js';
import { toolsLog as log, error as logError } from '../../utils/logger.js';

// 默认最大返回长度（字符）- 用于 detail 模式
const DEFAULT_MAX_LENGTH = 4000;

const GET_CHAPTER_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'get_chapter',
    description: `【分析阅读】获取章节内容。
- 默认返回精炼摘要（~500字符），适合快速了解
- detail=true 返回原文，用于深度分析
- 支持分页读取长章节（start_offset + max_length）`,
    parameters: {
      type: 'object',
      properties: {
        node_id: {
          type: 'string',
          description: '章节唯一标识符',
        },
        detail: {
          type: 'boolean',
          description: '是否返回原文（默认 false，只返回摘要）',
        },
        max_length: {
          type: 'number',
          description: '原文最大字符数（默认 4000，仅 detail=true 时有效）',
        },
        start_offset: {
          type: 'number',
          description: '从该位置开始读取原文（用于分页，仅 detail=true 时有效）',
        },
      },
      required: ['node_id'],
    },
  },
};

export const getChapterTool: ToolExecutor = {
  definition: GET_CHAPTER_DEFINITION,

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const nodeId = args.node_id as string;
    const detail = args.detail === true;
    const maxLength = (args.max_length as number) || DEFAULT_MAX_LENGTH;
    const startOffset = (args.start_offset as number) || 0;

    if (!nodeId) {
      return 'Error: node_id parameter is required';
    }

    try {
      log('[get_chapter] 获取章节:', { nodeId, detail, maxLength, startOffset });

      let fullContent: string;
      let nodeName: string;
      let section: string;
      let pageRange: string;

      // 优先从本地读取
      if (context.markdownFiles && context.markdownFiles[nodeId] && context.app) {
        let localPath = context.markdownFiles[nodeId];

        // 确保路径以 DeepReader/ 开头
        if (!localPath.startsWith('DeepReader/')) {
          localPath = `DeepReader/${localPath}`;
        }

        log('[get_chapter] 尝试从本地读取:', localPath);

        try {
          const file = context.app.vault.getAbstractFileByPath(localPath);
          if (file instanceof TFile) {
            fullContent = await context.app.vault.read(file);
            log('[get_chapter] 本地读取成功:', localPath, '长度:', fullContent.length);

            // 从内容中提取标题
            const titleMatch = fullContent.match(/^#\s+(.+)$/m);
            nodeName = titleMatch ? titleMatch[1] : localPath.split('/').pop()?.replace('.md', '') || nodeId;
            section = '';
            pageRange = '';

          } else {
            throw new Error('File not found in vault');
          }
        } catch (localError) {
          log('[get_chapter] 本地读取失败，fallback 到后端:', localError);
          const backendResult = await fetchFromBackend(nodeId, context);
          fullContent = backendResult.content;
          nodeName = backendResult.nodeName;
          section = backendResult.section;
          pageRange = backendResult.pageRange;
        }
      } else {
        // 从后端获取
        log('[get_chapter] 从后端获取章节');
        const backendResult = await fetchFromBackend(nodeId, context);
        fullContent = backendResult.content;
        nodeName = backendResult.nodeName;
        section = backendResult.section;
        pageRange = backendResult.pageRange;
      }

      // 🔄 优化：默认返回 summary，detail=true 返回原文
      if (!detail) {
        return formatSummaryResult(fullContent, nodeName, section, pageRange, nodeId);
      }

      // detail 模式：返回原文（支持分页）
      return formatChapterResult(fullContent, nodeName, section, pageRange, maxLength, startOffset, nodeId);

    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      logError('[get_chapter] 获取章节失败:', errorMsg);
      return `Error getting chapter content: ${errorMsg}`;
    }
  },
};

/**
 * 从后端获取章节内容
 */
async function fetchFromBackend(
  nodeId: string,
  context: ToolContext
): Promise<{ content: string; nodeName: string; section: string; pageRange: string }> {
  const exportData = await deeppdfClient.exportIndex(context.indexId);
  const node = exportData.nodes.find((n) => n.node_id === nodeId);

  if (!node) {
    // 尝试提供可用节点列表
    const availableNodes = exportData.nodes
      .slice(0, 10)
      .map((n) => `- ${n.node_id}: ${n.node_name}`)
      .join('\n');
    const moreInfo = exportData.nodes.length > 10
      ? `\n... and ${exportData.nodes.length - 10} more nodes`
      : '';

    throw new Error(`Chapter with node_id "${nodeId}" not found.\n\nAvailable nodes:\n${availableNodes}${moreInfo}`);
  }

  log('[get_chapter] 找到章节:', node.node_name);

  // 返回章节内容
  const header = `## ${node.node_name}
**Section:** ${node.section}
**Pages:** ${node.page_range}

---`;

  return {
    content: `${header}\n\n${node.text}`,
    nodeName: node.node_name,
    section: node.section,
    pageRange: node.page_range,
  };
}

/**
 * 从 frontmatter 提取 summary 字段
 */
function extractSummary(content: string): string | null {
  // 匹配 frontmatter 中的 summary 字段
  // 支持两种格式：
  // summary: "xxx"
  // summary: xxx
  const summaryMatch = content.match(/^---\n[\s\S]*?^summary:\s*"?([^"\n]+)"?\s*$/m);
  if (summaryMatch) {
    return summaryMatch[1].trim();
  }
  return null;
}

/**
 * 格式化摘要结果（默认模式）
 * 返回精炼的 summary，大幅减少 token 消耗
 */
function formatSummaryResult(
  fullContent: string,
  nodeName: string,
  section: string,
  pageRange: string,
  nodeId: string
): string {
  // 提取 summary
  const summary = extractSummary(fullContent);

  if (summary) {
    const totalLength = fullContent.length;
    return `📖 **${nodeName}**
📍 ${section} | 📄 ${pageRange}

> ${summary}

💡 如需详细内容：\`get_chapter(node_id="${nodeId}", detail=true)\`
📊 原文共 ${totalLength} 字符`;
  }

  // 如果没有 summary，返回前 500 字符作为摘要
  const contentWithoutFrontmatter = fullContent.replace(/^---[\s\S]*?---\n/, '');
  const preview = contentWithoutFrontmatter.slice(0, 500);
  const totalLength = fullContent.length;

  return `📖 **${nodeName}**
📍 ${section} | 📄 ${pageRange}

${preview}${totalLength > 500 ? '...' : ''}

💡 如需详细内容：\`get_chapter(node_id="${nodeId}", detail=true)\`
📊 原文共 ${totalLength} 字符`;
}

/**
 * 格式化章节结果（detail 模式 - 返回原文）
 */
function formatChapterResult(
  fullContent: string,
  nodeName: string,
  section: string,
  pageRange: string,
  maxLength: number,
  startOffset: number,
  nodeId: string
): string {
  const totalLength = fullContent.length;

  // 如果内容很短，直接返回
  if (totalLength <= maxLength && startOffset === 0) {
    return fullContent;
  }

  // 应用偏移
  const contentFromOffset = fullContent.slice(startOffset);
  const actualLength = contentFromOffset.length;

  // 如果从偏移开始的内容比 maxLength 短，直接返回
  if (actualLength <= maxLength) {
    if (startOffset > 0) {
      return `📖 **${nodeName}** (从第 ${startOffset} 字符开始，共 ${totalLength} 字符)

${contentFromOffset}

✅ 已显示完整内容（从偏移位置到结尾）`;
    }
    return fullContent;
  }

  // 需要截断
  const truncated = contentFromOffset.slice(0, maxLength);
  const endOffset = startOffset + maxLength;
  const remaining = totalLength - endOffset;

  let pageInfo = '';
  if (startOffset > 0) {
    pageInfo = `(显示第 ${startOffset}-${endOffset} 字符，共 ${totalLength} 字符)`;
  } else {
    pageInfo = `(显示前 ${maxLength} 字符，共 ${totalLength} 字符)`;
  }

  return `📖 **${nodeName}** ${pageInfo}

${truncated}

---
📌 **还有 ${remaining} 字符未显示**。如需继续阅读：
- 调用 \`get_chapter(node_id="${nodeId}", start_offset=${endOffset})\` 继续阅读
- 或增加 \`max_length\` 参数获取更多内容`;
}
