/**
 * write_note LangChain tool wrapper
 *
 * Wraps the existing writeNoteTool ToolExecutor into a LangChain tool().
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { writeNoteTool } from '../write-note.js';
import type { ToolFactory } from './types.js';
import type { ToolContext } from '../types.js';

export const createWriteNoteTool: ToolFactory = (ctx: ToolContext) =>
  tool(
    async ({ path, content, mode }) => {
      return writeNoteTool.execute({ path, content, mode }, ctx);
    },
    {
      name: 'write_note',
      description: `将内容写入 Obsidian 笔记文件。AI 创建的文件带有 aicreate 标记。
支持三种模式: create (新建), overwrite (覆盖已有 AI 文件), append (追加内容)。
只能操作 AI 创建的文件（安全机制）。`,
      schema: z.object({
        path: z.string().describe("笔记的相对路径（如 'DeepReader/Notes/分析.md'）"),
        content: z.string().describe('笔记的 Markdown 内容'),
        mode: z
          .enum(['create', 'overwrite', 'append'])
          .optional()
          .describe('写入模式: create=新建, overwrite=覆盖, append=追加'),
      }),
    },
  );
