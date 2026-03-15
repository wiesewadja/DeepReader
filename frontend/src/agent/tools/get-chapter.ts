/**
 * get_chapter Tool - 获取章节完整内容
 */

import { TFile } from 'obsidian';
import type { ToolDefinition } from '../types.js';
import type { ToolExecutor, ToolContext } from './types.js';
import { deeppdfClient } from '../../api/http-client.js';
import { toolsLog as log, error as logError } from '../../utils/logger.js';
import {
  updateBookFamiliarity,
  extractChapterIndexFromNodeId,
  FAMILIARITY_DELTAS,
} from '../utils/book-note.js';

// 默认最大返回长度（字符）
const DEFAULT_MAX_LENGTH = 4000;

const GET_CHAPTER_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'get_chapter',
    description: `【分析阅读】获取章节的完整文本内容。
适用场景：深入阅读特定章节、回答"详细解释"、"为什么"类问题。
支持分页读取（max_length + start_offset）。`,
    parameters: {
      type: 'object',
      properties: {
        node_id: {
          type: 'string',
          description: 'The unique identifier of the chapter/node to retrieve',
        },
        max_length: {
          type: 'number',
          description: 'Maximum characters to return (default: 4000). Increase if you need more content.',
        },
        start_offset: {
          type: 'number',
          description: 'Start reading from this character position (for reading long chapters in parts)',
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
    const maxLength = (args.max_length as number) || DEFAULT_MAX_LENGTH;
    const startOffset = (args.start_offset as number) || 0;

    if (!nodeId) {
      return 'Error: node_id parameter is required';
    }

    try {
      log('[get_chapter] 获取章节:', { nodeId, maxLength, startOffset, indexId: context.indexId });

      let fullContent: string;
      let nodeName: string;
      let section: string;
      let pageRange: string;

      // 优先从本地读取
      if (context.markdownFiles && context.markdownFiles[nodeId] && context.app) {
        let localPath = context.markdownFiles[nodeId];

        // 确保路径以 DeepReader/ 开头（后端返回的路径可能缺少这个前缀）
        if (!localPath.startsWith('DeepReader/')) {
          localPath = `DeepReader/${localPath}`;
        }

        log('[get_chapter] 尝试从本地读取:', localPath);

        try {
          const file = context.app.vault.getAbstractFileByPath(localPath);
          if (file instanceof TFile) {
            fullContent = await context.app.vault.read(file);
            log('[get_chapter] 本地读取成功:', localPath, '长度:', fullContent.length);

            // 从内容中提取标题（第一行通常是 # 标题）
            const titleMatch = fullContent.match(/^#\s+(.+)$/m);
            nodeName = titleMatch ? titleMatch[1] : localPath.split('/').pop()?.replace('.md', '') || nodeId;
            section = '';
            pageRange = '';

            // 异步更新熟悉度（不阻塞主流程）
            scheduleFamiliarityUpdate(nodeId, context);
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

      // 应用长度限制和偏移
      return formatChapterResult(fullContent, nodeName, section, pageRange, maxLength, startOffset, nodeId);

    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      logError('[get_chapter] 获取章节失败:', errorMsg);
      return `Error getting chapter content: ${errorMsg}`;
    }
  },
};

/**
 * 调度熟悉度更新（fire-and-forget，但保证错误被捕获）
 */
function scheduleFamiliarityUpdate(nodeId: string, context: ToolContext): void {
  log('[get_chapter] 开始调度熟悉度更新', {
    nodeId,
    hasApp: !!context.app,
    pdfName: context.pdfName,
  });

  // 使用 void 显式标记 fire-and-forget，并确保错误被捕获
  void (async () => {
    try {
      const chapterIndex = extractChapterIndexFromNodeId(nodeId);
      log('[get_chapter] 提取章节索引结果:', { nodeId, chapterIndex });

      if (chapterIndex === null) {
        log('[get_chapter] 无法从 nodeId 提取章节索引:', nodeId);
        return;
      }

      if (!context.app || !context.pdfName) {
        log('[get_chapter] 缺少 app 或 pdfName，跳过熟悉度更新', {
          hasApp: !!context.app,
          pdfName: context.pdfName,
        });
        return;
      }

      log('[get_chapter] 准备调用 updateBookFamiliarity', {
        pdfName: context.pdfName,
        chapterIndex,
        delta: FAMILIARITY_DELTAS.get_chapter,
      });

      const success = await updateBookFamiliarity(
        context.app,
        context.pdfName,
        chapterIndex,
        FAMILIARITY_DELTAS.get_chapter
      );

      log('[get_chapter] updateBookFamiliarity 返回:', success);

      if (success) {
        log('[get_chapter] 熟悉度更新成功，章节:', chapterIndex);
      } else {
        log('[get_chapter] 熟悉度更新失败，章节:', chapterIndex);
      }
    } catch (err) {
      // 熟悉度更新失败不影响主流程，但记录错误
      logError('[get_chapter] 熟悉度更新异常:', err);
    }
  })();
}

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

  // 异步更新熟悉度（不阻塞主流程）
  scheduleFamiliarityUpdate(nodeId, context);

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
 * 格式化章节结果（应用长度限制和偏移）
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
