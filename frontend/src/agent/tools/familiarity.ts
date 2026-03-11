/**
 * Familiarity 工具 - 章节熟悉度管理
 *
 * 提供：
 * - update_familiarity: 更新章节熟悉度
 */

import type { ToolDefinition } from '../types.js';
import type { ToolExecutor, ToolContext } from './types.js';
import { toolsLog as log, error } from '../../utils/logger.js';
import {
  updateReadingProgress,
  FAMILIARITY_DELTAS,
  FamiliarityReason,
} from '../utils/book-note.js';

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
          enum: Object.keys(FAMILIARITY_DELTAS),
        },
      },
      required: ['chapterIndex'],
    },
  },
};

/**
 * 创建 update_familiarity 工具执行器
 */
export function createUpdateFamiliarityTool(): ToolExecutor {
  return {
    definition: updateFamiliarityDefinition,
    async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
      const chapterIndex = args.chapterIndex as number;
      const reason = (args.reason as FamiliarityReason) || 'user_question';
      const delta = (args.delta as number) ?? FAMILIARITY_DELTAS[reason] ?? 1;

      if (typeof chapterIndex !== 'number') {
        return 'Error: chapterIndex 参数必须是数字';
      }

      if (!context.app) {
        return 'Error: Obsidian App 实例不可用';
      }

      if (!context.pdfName) {
        return 'Error: pdfName 不可用，无法更新熟悉度';
      }

      // 获取 indexId 和 totalChapters（从 context）
      const indexId = context.indexId || context.pdfName;
      const totalChapters = context.readingProgress?.totalChapters || 100; // 默认值

      const success = await updateReadingProgress(
        context.app,
        context.pdfName,
        indexId,
        totalChapters,
        chapterIndex,
        delta
      );

      if (success) {
        return `章节 ${chapterIndex} 熟悉度已更新 (+${delta})，原因: ${reason}`;
      } else {
        return `更新熟悉度失败`;
      }
    },
  };
}

// 导出工具定义
export const updateFamiliarityTool: ToolExecutor = {
  definition: updateFamiliarityDefinition,
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    return createUpdateFamiliarityTool().execute(args, context);
  },
};
