/**
 * search_book LangChain tool wrapper
 *
 * Wraps the existing searchBookTool ToolExecutor into a LangChain tool().
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { searchBookTool } from '../local/search-text.js';
import type { ToolContext } from '../types.js';
import type { ToolFactory } from './types.js';

const searchBookSchema = z.object({
  keywords: z.array(z.string().max(200)).min(1).max(20).describe('关键词数组，每个关键词独立检索后融合排序（OR 语义）'),
  scope_node_ids: z.array(z.string()).optional().describe('限定搜索范围（章节 ID 列表），留空则全局搜索'),
});

export const createSearchBookTool: ToolFactory = (ctx: ToolContext) =>
  tool(
    async (args) => {
      return searchBookTool.execute(args as Record<string, unknown>, ctx);
    },
    {
      name: 'search_book',
      description: `在书中搜索关键词，返回匹配段落片段（聚焦到 block_id 级别）。

【搜索逻辑】
- 多关键词并行检索 + RRF 融合：每个关键词独立搜索，合并排序
- 8 阶段管线：BM25 + 向量语义 + scope 过滤 + 层级加权
- 每个 hit 返回 node 内匹配最密集的段落片段（含 ^block_id）

【返回结果】
- matched_blocks: 匹配的段落片段，可直接引用 ^block_id
- 大部分情况无需再调 read_book_section

【中文搜索技巧】
- 提取核心名词，剔除"如何"、"是什么"等修饰语
- 拆分复合词：不要搜"解决问题的前提"，改用 ["解决问题", "前提"]`,
      schema: searchBookSchema,
    },
  );
