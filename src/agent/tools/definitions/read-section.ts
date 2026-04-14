/**
 * read_book_section LangChain tool wrapper
 *
 * Wraps the existing readBookSectionTool ToolExecutor into a LangChain tool().
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { readBookSectionTool } from '../local/read-section.js';
import type { ToolFactory } from './types.js';
import type { ToolContext } from '../types.js';

const readBookSectionSchema = z.object({
  node_ids: z.array(z.string()).optional().describe('批量读取多个章节（推荐，一次读取多个 node_id）'),
  node_id: z.string().optional().describe('单个章节 ID'),
  block_id: z.string().optional().describe('块引用 ID（如 ^s1-002），需配合 node_id 使用'),
  heading: z.string().optional().describe('标题名称（模糊匹配）'),
});

export const createReadBookSectionTool: ToolFactory = (ctx: ToolContext) =>
  tool(
    async (args) => {
      return readBookSectionTool.execute(args as Record<string, unknown>, ctx);
    },
    {
      name: 'read_book_section',
      description: `读取指定章节的完整内容（含 ^block_id 标记）。

【推荐用法】先 search_book 获取 node_id 列表，再批量读取。
参数优先级: node_ids (批量) > node_id+block_id (精确定位) > heading`,
      schema: readBookSectionSchema,
    },
  );
