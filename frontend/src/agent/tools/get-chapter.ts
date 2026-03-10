/**
 * get_chapter Tool - 获取章节完整内容
 */

import { TFile } from 'obsidian';
import type { ToolDefinition } from '../types.js';
import type { ToolExecutor, ToolContext } from './types.js';
import { deeppdfClient } from '../../api/http-client.js';
import { log, error as logError } from '../../utils/logger.js';

const GET_CHAPTER_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'get_chapter',
    description: 'Get the full text content of a specific chapter/section. Use this when you need to read the complete content of a chapter identified by node_id.',
    parameters: {
      type: 'object',
      properties: {
        node_id: {
          type: 'string',
          description: 'The unique identifier of the chapter/node to retrieve',
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

    if (!nodeId) {
      return 'Error: node_id parameter is required';
    }

    try {
      log('[get_chapter] 获取章节:', { nodeId, indexId: context.indexId });

      // 优先从本地读取
      if (context.markdownFiles && context.markdownFiles[nodeId] && context.app) {
        const localPath = context.markdownFiles[nodeId];
        log('[get_chapter] 尝试从本地读取:', localPath);

        try {
          const file = context.app.vault.getAbstractFileByPath(localPath);
          if (file instanceof TFile) {
            const content = await context.app.vault.read(file);
            log('[get_chapter] 本地读取成功:', localPath);
            return content;
          }
        } catch (localError) {
          log('[get_chapter] 本地读取失败，fallback 到后端:', localError);
        }
      }

      // Fallback: 从后端获取
      log('[get_chapter] 从后端获取章节');

      // 导出索引数据并查找指定节点
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

        return `Chapter with node_id "${nodeId}" not found.\n\nAvailable nodes:\n${availableNodes}${moreInfo}`;
      }

      log('[get_chapter] 找到章节:', node.node_name);

      // 返回章节内容
      const header = `## ${node.node_name}
**Section:** ${node.section}
**Pages:** ${node.page_range}

---`;

      return `${header}\n\n${node.text}`;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      logError('[get_chapter] 获取章节失败:', errorMsg);
      return `Error getting chapter content: ${errorMsg}`;
    }
  },
};
