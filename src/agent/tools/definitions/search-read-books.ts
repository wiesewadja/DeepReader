/**
 * search_read_books LangChain tool wrapper
 *
 * Wraps the existing searchReadBooksTool ToolExecutor into a LangChain tool().
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { searchReadBooksTool } from '../search-read-books.js';
import type { ToolFactory } from './types.js';
import type { ToolContext } from '../types.js';

export const createSearchReadBooksTool: ToolFactory = (ctx: ToolContext) =>
  tool(
    async (args) => {
      return searchReadBooksTool.execute({ query: args.query, top_k: args.top_k }, ctx);
    },
    {
      name: 'search_read_books',
      description: '跨书搜索已读过的书籍，查找与查询相关的内容',
      schema: z.object({
        query: z.string().describe('搜索关键词'),
        top_k: z.number().optional().describe('返回结果数量'),
      }),
    },
  );
