/**
 * Memory 工具 - Agent 记忆管理
 *
 * 提供：
 * - add_memory: 添加记忆条目
 * - search_memory: 搜索记忆
 * - summarize_memory: 触发记忆摘要
 */

import type { ToolDefinition } from '../types.js';
import type { ToolExecutor, ToolContext } from './types.js';
import { ContextLoader } from '../context/loader.js';
import { toolsLog as log, error } from '../../utils/logger.js';
import {
  MEMORY_DATA_DIR,
  MEMORY_ENTRIES_DIR,
  ensurePluginDataDirs,
} from '../utils/plugin-data.js';

/**
 * add_memory 工具定义
 */
const addMemoryDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'add_memory',
    description: `添加一条记忆到用户的长期记忆中。

使用场景：
- 用户明确表达了偏好（如"我喜欢简洁的总结"）
- 用户纠正了你的行为（如"不要用列表形式"）
- 用户提供了个人信息（如"我是程序员"）
- 重要的对话上下文需要记住

注意：
- 不要添加临时性信息（如"当前正在读第三章"）
- 不要添加书籍内容本身
- 每条记忆应该是一个独立、有价值的观察`,
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: '要记住的内容，应该简洁明了，例如："用户偏好使用段落式叙述而非列表"',
        },
        category: {
          type: 'string',
          description: '记忆类别（可选）',
          enum: ['preference', 'correction', 'info', 'feedback'],
        },
      },
      required: ['content'],
    },
  },
};

/**
 * search_memory 工具定义
 */
const searchMemoryDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'search_memory',
    description: `搜索用户的长期记忆，查找与当前话题相关的历史信息。

使用场景：
- 用户提到之前的偏好，你想确认具体内容
- 想了解用户对某个话题的历史反馈
- 不确定是否已经记录过某个信息

返回匹配的记忆条目列表。`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词，用空格分隔多个词',
        },
      },
      required: ['query'],
    },
  },
};

/**
 * summarize_memory 工具定义
 */
const summarizeMemoryDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'summarize_memory',
    description: `触发记忆摘要生成。

当记忆条目积累较多时，将详细记忆压缩为摘要。
这个操作会读取所有记忆条目，生成一个精简的摘要文件。

使用场景：
- 系统提示需要压缩时
- 记忆条目过多时（超过 10 条）

注意：这是一个耗时操作，谨慎使用。`,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

/**
 * 创建 add_memory 工具执行器
 */
export function createAddMemoryTool(app: any): ToolExecutor {
  return {
    definition: addMemoryDefinition,
    async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
      const content = args.content as string;
      const category = args.category as string | undefined;

      if (!content || typeof content !== 'string') {
        return 'Error: content 参数是必需的，且必须是字符串';
      }

      if (!context.app) {
        return 'Error: Obsidian App 实例不可用';
      }

      const loader = new ContextLoader(context.app);

      try {
        // 添加分类标签（如果有）
        const entryContent = category
          ? `[${category}] ${content}`
          : content;

        const success = await loader.addMemoryEntry(entryContent);

        if (success) {
          // 检查是否需要摘要
          const needsSummary = await loader.needsSummarization();
          if (needsSummary) {
            log('[add_memory] 记忆条目已达阈值，建议触发摘要');
            return `记忆已保存。提示：记忆条目已较多，可以考虑使用 summarize_memory 工具压缩记忆。`;
          }
          return '记忆已成功保存。';
        } else {
          return '保存记忆失败，请稍后重试。';
        }
      } catch (err) {
        error('[add_memory] 执行失败:', err);
        return `保存记忆时出错: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

/**
 * 创建 search_memory 工具执行器
 */
export function createSearchMemoryTool(app: any): ToolExecutor {
  return {
    definition: searchMemoryDefinition,
    async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
      const query = args.query as string;

      if (!query || typeof query !== 'string') {
        return 'Error: query 参数是必需的，且必须是字符串';
      }

      if (!context.app) {
        return 'Error: Obsidian App 实例不可用';
      }

      const loader = new ContextLoader(context.app);

      try {
        const results = await loader.searchMemory(query);

        if (results.length === 0) {
          return `未找到与 "${query}" 相关的记忆。`;
        }

        return `找到 ${results.length} 条相关记忆：\n\n${results.map((r, i) => `--- 记忆 ${i + 1} ---\n${r}`).join('\n\n')}`;
      } catch (err) {
        error('[search_memory] 执行失败:', err);
        return `搜索记忆时出错: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

/**
 * 创建 summarize_memory 工具执行器
 *
 * 注意：实际的摘要生成需要 LLM 参与，这里只做基础整合
 * 完整实现需要调用 LLM API 来生成摘要
 */
export function createSummarizeMemoryTool(): ToolExecutor {
  return {
    definition: summarizeMemoryDefinition,
    async execute(_args: Record<string, unknown>, context: ToolContext): Promise<string> {
      if (!context.app) {
        return 'Error: Obsidian App 实例不可用';
      }

      try {
        // 确保目录存在
        await ensurePluginDataDirs(context.app);

        // 读取所有记忆条目（从插件数据目录）
        const entriesDir = MEMORY_ENTRIES_DIR;
        const exists = await context.app.vault.adapter.exists(entriesDir);

        if (!exists) {
          return '没有记忆条目需要摘要。';
        }

        const files = await context.app.vault.adapter.list(entriesDir);
        const mdFiles = files.files.filter((f: string) => f.endsWith('.md'));

        if (mdFiles.length === 0) {
          return '没有记忆条目需要摘要。';
        }

        // 读取所有条目内容
        const entries: string[] = [];
        for (const file of mdFiles) {
          const content = await context.app.vault.adapter.read(file);
          entries.push(content);
        }

        // 简单合并为摘要（实际应用中应该调用 LLM 生成）
        const summaryContent = `# 记忆摘要

> 生成时间: ${new Date().toISOString().split('T')[0]}
> 条目数: ${entries.length}

## 用户偏好

${entries.join('\n\n')}

---
*此摘要由系统自动生成，包含 ${entries.length} 条记忆条目*`;

        // 写入摘要文件（到插件数据目录）
        const summaryPath = `${MEMORY_DATA_DIR}/summary.md`;
        await context.app.vault.adapter.write(summaryPath, summaryContent);

        log('[summarize_memory] 摘要已生成，包含', entries.length, '条记忆');

        return `记忆摘要已生成，整合了 ${entries.length} 条记忆条目。

注意：当前使用简单合并方式生成摘要。如需更智能的摘要，可以考虑：
1. 在后端实现 LLM 摘要服务
2. 或者在前端使用 Agent 自身来生成摘要`;
      } catch (err) {
        error('[summarize_memory] 执行失败:', err);
        return `生成摘要时出错: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

// 导出工具定义（用于注册）
export const addMemoryTool: ToolExecutor = {
  definition: addMemoryDefinition,
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    // 这个默认导出需要 app 实例，实际使用时应该用 createAddMemoryTool
    if (!context.app) {
      return 'Error: Obsidian App 实例不可用';
    }
    return createAddMemoryTool(context.app).execute(args, context);
  },
};

export const searchMemoryTool: ToolExecutor = {
  definition: searchMemoryDefinition,
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    if (!context.app) {
      return 'Error: Obsidian App 实例不可用';
    }
    return createSearchMemoryTool(context.app).execute(args, context);
  },
};

export const summarizeMemoryTool: ToolExecutor = {
  definition: summarizeMemoryDefinition,
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    return createSummarizeMemoryTool().execute(args, context);
  },
};
