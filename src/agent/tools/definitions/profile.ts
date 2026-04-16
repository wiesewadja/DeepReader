/**
 * update_profile LangChain tool wrapper
 *
 * Wraps the existing updateProfileTool ToolExecutor into a LangChain tool().
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { updateProfileTool } from '../profile.js';
import type { ToolFactory } from './types.js';
import type { ToolContext } from '../types.js';

export const createUpdateProfileTool: ToolFactory = (ctx: ToolContext) =>
  tool(
    async (args) => {
      return updateProfileTool.execute(
        { section: args.section, field: args.field, value: args.value, mode: args.mode },
        ctx,
      );
    },
    {
      name: 'update_profile',
      description:
        '更新用户画像字段。用于用户表达新偏好、纠正行为、提供个人信息时。每次只更新一个字段。',
      schema: z.object({
        section: z
          .enum(['基础信息', '阅读偏好', '认知特点', '阅读轨迹'])
          .describe('画像部分'),
        field: z.string().describe('具体字段名，如 "称呼"、"风格"、"擅长"'),
        value: z.string().describe('新的值'),
        mode: z
          .enum(['append', 'replace'])
          .optional()
          .describe('更新模式：append（追加）或 replace（替换，默认）'),
      }),
    },
  );
