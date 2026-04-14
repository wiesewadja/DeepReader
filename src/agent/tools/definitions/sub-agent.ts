/**
 * check_sub_agent LangChain tool wrapper
 *
 * Wraps the existing checkSubAgentTool ToolExecutor into a LangChain tool().
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { checkSubAgentTool } from '../create-sub-agent.js';
import type { ToolFactory } from './types.js';
import type { ToolContext } from '../types.js';

export const createCheckSubAgentTool: ToolFactory = (ctx: ToolContext) =>
  tool(
    async ({ task_id }) => {
      return checkSubAgentTool.execute({ task_id }, ctx);
    },
    {
      name: 'check_sub_agent',
      description: '检查子 Agent 任务的状态',
      schema: z.object({
        task_id: z.string().describe('子 Agent 任务 ID'),
      }),
    },
  );
