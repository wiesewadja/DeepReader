/**
 * save_memory + search_memory LangChain tool wrappers
 *
 * Wraps the existing addMemoryTool and searchMemoryTool ToolExecutors
 * into LangChain tool() format.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { addMemoryTool, searchMemoryTool } from '../memory.js';
import type { ToolFactory } from './types.js';
import type { ToolContext } from '../types.js';

export const createSaveMemoryTool: ToolFactory = (ctx: ToolContext) =>
  tool(
    async ({ history_entry, memory_update }) => {
      return addMemoryTool.execute({ history_entry, memory_update }, ctx);
    },
    {
      name: 'save_memory',
      description: `保存信息到长期记忆系统。
- history_entry: 必填，记录到阅读历史（HISTORY.md）
- memory_update: 可选，更新用户画像/偏好（MEMORY.md）`,
      schema: z.object({
        history_entry: z
          .string()
          .describe('阅读历史条目，记录本次交互的关键信息'),
        memory_update: z
          .string()
          .optional()
          .describe('要更新到长期记忆的内容（如用户偏好、阅读习惯等）'),
      }),
    },
  );

export const createSearchMemoryTool: ToolFactory = (ctx: ToolContext) =>
  tool(
    async ({ query }) => {
      return searchMemoryTool.execute({ query }, ctx);
    },
    {
      name: 'search_memory',
      description:
        '搜索长期记忆（MEMORY.md 和 HISTORY.md），查找与查询相关的用户偏好、阅读历史等',
      schema: z.object({
        query: z.string().describe('搜索关键词，空格分隔'),
      }),
    },
  );
