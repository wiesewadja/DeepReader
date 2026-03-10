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

/**
 * 从 nodeId 提取章节索引
 * 格式如 "western-history_03-第一章" -> 3
 */
function extractChapterIndex(nodeId: string): number | null {
  const match = nodeId.match(/_(\d+)-/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}

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

            // 异步更新熟悉度（本地读取成功）
            updateFamiliarityAsync(nodeId, context);

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

      // 异步更新熟悉度（后端获取成功）
      updateFamiliarityAsync(nodeId, context);

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

/**
 * 异步更新章节熟悉度（不阻塞主流程）
 */
async function updateFamiliarityAsync(nodeId: string, context: ToolContext): Promise<void> {
  // 不阻塞，直接 async 执行
  (async () => {
    try {
      const chapterIndex = extractChapterIndex(nodeId);
      if (chapterIndex === null) {
        log('[get_chapter] 无法从 nodeId 提取章节索引:', nodeId);
        return;
      }

      if (!context.app || !context.pdfName) {
        log('[get_chapter] 缺少 app 或 pdfName，跳过熟悉度更新');
        return;
      }

      // 直接更新书籍笔记的熟悉度
      const success = await updateBookFamiliarity(
        context.app,
        context.pdfName,
        chapterIndex,
        2 // delta: get_chapter 调用 +2
      );

      if (success) {
        log('[get_chapter] 熟悉度更新成功，章节:', chapterIndex);
      }
    } catch (err) {
      // 熟悉度更新失败不影响主流程
      log('[get_chapter] 熟悉度更新失败:', err);
    }
  })();
}

/**
 * 更新书籍笔记 frontmatter 中的熟悉度
 */
async function updateBookFamiliarity(
  app: any,
  bookName: string,
  chapterIndex: number,
  delta: number
): Promise<boolean> {
  const notePath = `读书笔记/${bookName}/${bookName}.md`;

  try {
    const exists = await app.vault.adapter.exists(notePath);
    if (!exists) {
      log('[get_chapter] 书籍笔记不存在:', notePath);
      return false;
    }

    let content = await app.vault.adapter.read(notePath);

    // 解析 frontmatter
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) {
      return false;
    }

    let frontmatter = fmMatch[1];
    const body = content.slice(fmMatch[0].length);

    // 解析并更新 chapter_familiarity
    const familiarity: Record<number, number> = {};
    const famMatch = frontmatter.match(/chapter_familiarity:\s*\n([\s\S]*?)(?=\n\w|\n*$)/);

    if (famMatch) {
      const lines = famMatch[1].split('\n');
      for (const line of lines) {
        const match = line.trim().match(/^(\d+):\s*(\d+)/);
        if (match) {
          familiarity[parseInt(match[1])] = parseInt(match[2]);
        }
      }
    }

    // 更新熟悉度
    familiarity[chapterIndex] = (familiarity[chapterIndex] || 0) + delta;

    // 计算总互动次数
    const totalInteractions = Object.values(familiarity).reduce((a, b) => a + b, 0);

    // 重建 familiarity 字符串
    const familiarityStr = Object.entries(familiarity)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([k, v]) => `  ${k}: ${v}`)
      .join('\n');

    // 更新 frontmatter
    if (famMatch) {
      frontmatter = frontmatter.replace(
        /chapter_familiarity:\s*\n[\s\S]*?(?=\n\w|\n*$)/,
        `chapter_familiarity:\n${familiarityStr}\n`
      );
    } else {
      frontmatter += `\nchapter_familiarity:\n${familiarityStr}`;
    }

    // 更新 total_interactions
    if (frontmatter.includes('total_interactions:')) {
      frontmatter = frontmatter.replace(
        /total_interactions:\s*\d+/,
        `total_interactions: ${totalInteractions}`
      );
    } else {
      frontmatter += `\ntotal_interactions: ${totalInteractions}`;
    }

    // 更新 last_active
    const today = new Date().toISOString().split('T')[0];
    if (frontmatter.includes('last_active:')) {
      frontmatter = frontmatter.replace(
        /last_active:\s*[\d-]+/,
        `last_active: ${today}`
      );
    } else {
      frontmatter += `\nlast_active: ${today}`;
    }

    // 写回文件
    const newContent = `---\n${frontmatter}\n---${body}`;
    await app.vault.adapter.write(notePath, newContent);

    return true;
  } catch (err) {
    logError('[get_chapter] 更新熟悉度失败:', err);
    return false;
  }
}
