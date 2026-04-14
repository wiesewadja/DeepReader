/**
 * excalidraw LangChain tool wrapper
 *
 * Wraps the existing createExcalidrawTool ToolExecutor into a LangChain tool().
 * Uses window.ExcalidrawAutomate global API — does NOT depend on ctx.app.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createExcalidrawTool } from '../excalidraw.js';
import type { ToolFactory } from './types.js';
import type { ToolContext } from '../types.js';

export const createExcalidrawToolDefinition: ToolFactory = (ctx: ToolContext) =>
  tool(
    async (args) => {
      return createExcalidrawTool().execute(args, ctx);
    },
    {
      name: 'excalidraw',
      description: `创建 Excalidraw 图表。
支持操作: create(创建空白文件), mindmap(思维导图), knowledge_graph(知识图谱), add_node(添加节点), add_edge(添加连接), check(检查插件状态)。`,
      schema: z.object({
        action: z.enum(['create', 'mindmap', 'knowledge_graph', 'add_node', 'add_edge', 'check']).describe('操作类型'),
        filename: z.string().optional().describe('Excalidraw 文件名（不含扩展名）'),
        folder: z.string().optional().describe('输出文件夹（默认: DeepReader/Excalidraw）'),
        topic: z.string().optional().describe('思维导图中心主题 (mindmap)'),
        branches: z.array(z.object({
          label: z.string().describe('分支标签'),
          children: z.array(z.object({
            label: z.string().optional(),
            children: z.array(z.any()).optional(),
          })).optional().describe('子节点'),
        })).optional().describe('思维导图分支 (mindmap)'),
        nodes: z.array(z.object({
          id: z.string().optional().describe('节点 ID'),
          label: z.string().optional().describe('节点标签'),
          type: z.enum(['concept', 'entity', 'topic']).optional().describe('节点类型'),
        })).optional().describe('知识图谱节点 (knowledge_graph)'),
        edges: z.array(z.object({
          from: z.string().optional().describe('起始节点 ID'),
          to: z.string().optional().describe('目标节点 ID'),
          label: z.string().optional().describe('边标签'),
        })).optional().describe('知识图谱边 (knowledge_graph)'),
      }),
    },
  );
