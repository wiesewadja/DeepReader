/**
 * Familiarity 工具 - 章节熟悉度管理
 *
 * 提供：
 * - update_familiarity: 更新章节熟悉度
 */

import type { ToolDefinition } from '../types.js';
import type { ToolExecutor, ToolContext } from './types.js';
import { log, error } from '../../utils/logger.js';

/**
 * update_familiarity 工具定义
 */
const updateFamiliarityDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'update_familiarity',
    description: `更新章节的阅读熟悉度。

熟悉度反映用户对某章节的互动深度，用于计算阅读进度。

触发信号与权重：
- get_chapter 调用: +2（主动获取章节内容）
- 用户高亮: +2（标注代表关注）
- 用户提问涉及: +1（讨论该章节）
- AI 回答引用: +1（说明讨论深入）

注意：此工具通常由系统自动调用，无需手动触发。`,
    parameters: {
      type: 'object',
      properties: {
        chapterIndex: {
          type: 'number',
          description: '章节索引（从 0 开始）',
        },
        delta: {
          type: 'number',
          description: '增量（默认 1）',
        },
        reason: {
          type: 'string',
          description: '更新原因',
          enum: ['get_chapter', 'user_question', 'highlight', 'ai_reference'],
        },
      },
      required: ['chapterIndex'],
    },
  },
};

/**
 * 更新书籍笔记 frontmatter 中的熟悉度
 */
async function updateFamiliarityInNote(
  app: any,
  bookName: string,
  chapterIndex: number,
  delta: number
): Promise<boolean> {
  // 构建书籍笔记路径
  const notePath = `读书笔记/${bookName}/${bookName}.md`;

  try {
    const exists = await app.vault.adapter.exists(notePath);
    if (!exists) {
      log('[update_familiarity] 书籍笔记不存在:', notePath);
      return false;
    }

    // 读取笔记内容
    let content = await app.vault.adapter.read(notePath);

    // 解析 frontmatter
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) {
      log('[update_familiarity] 没有 frontmatter，跳过');
      return false;
    }

    let frontmatter = fmMatch[1];
    const body = content.slice(fmMatch[0].length);

    // 解析 chapter_familiarity
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

    // 重建 frontmatter
    const familiarityStr = Object.entries(familiarity)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([k, v]) => `  ${k}: ${v}`)
      .join('\n');

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

    log('[update_familiarity] 章节', chapterIndex, '熟悉度+', delta, '总计:', familiarity[chapterIndex]);
    return true;
  } catch (err) {
    error('[update_familiarity] 更新失败:', err);
    return false;
  }
}

/**
 * 创建 update_familiarity 工具执行器
 */
export function createUpdateFamiliarityTool(app: any): ToolExecutor {
  return {
    definition: updateFamiliarityDefinition,
    async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
      const chapterIndex = args.chapterIndex as number;
      const delta = (args.delta as number) || 1;
      const reason = (args.reason as string) || 'unknown';

      if (typeof chapterIndex !== 'number') {
        return 'Error: chapterIndex 参数必须是数字';
      }

      if (!context.app) {
        return 'Error: Obsidian App 实例不可用';
      }

      if (!context.pdfName) {
        return 'Error: pdfName 不可用，无法更新熟悉度';
      }

      const success = await updateFamiliarityInNote(
        context.app,
        context.pdfName,
        chapterIndex,
        delta
      );

      if (success) {
        return `章节 ${chapterIndex} 熟悉度已更新 (+${delta})，原因: ${reason}`;
      } else {
        return `更新熟悉度失败，可能书籍笔记不存在`;
      }
    },
  };
}

// 导出工具定义
export const updateFamiliarityTool: ToolExecutor = {
  definition: updateFamiliarityDefinition,
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    if (!context.app) {
      return 'Error: Obsidian App 实例不可用';
    }
    return createUpdateFamiliarityTool(context.app).execute(args, context);
  },
};
