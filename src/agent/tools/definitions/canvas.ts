/**
 * canvas LangChain tool wrapper
 *
 * Wraps the existing createCanvasTool ToolExecutor into a LangChain tool().
 * Depends on ctx.app (Obsidian vault operations).
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createCanvasTool } from '../canvas.js';
import type { ToolFactory } from './types.js';
import type { ToolContext } from '../types.js';

export const createCanvasToolDefinition: ToolFactory = (ctx: ToolContext) =>
  tool(
    async (args) => {
      return createCanvasTool(ctx.vault.app).execute(args, ctx);
    },
    {
      name: 'canvas',
      description: `创建或修改 Obsidian Canvas 文件。
支持操作: create(创建), add_node(添加节点), add_edge(添加边), get(获取), list(列表), mindmap(思维导图), export_to_excalidraw(导出)。
export_to_excalidraw 将 Canvas 转换为 Excalidraw 文件（需要安装 Excalidraw 插件）。`,
      schema: z.object({
        action: z.enum(['create', 'add_node', 'add_edge', 'get', 'list', 'mindmap', 'export_to_excalidraw']).describe('操作类型'),
        path: z.string().optional().describe('Canvas 文件路径 (如 "Canvas/mind-map.canvas")'),
        nodes: z.array(z.object({
          type: z.enum(['text', 'file', 'link', 'group']).optional(),
          text: z.string().optional().describe('文本内容'),
          file: z.string().optional().describe('文件路径'),
          url: z.string().optional().describe('URL'),
          x: z.number().optional(),
          y: z.number().optional(),
          width: z.number().optional(),
          height: z.number().optional(),
          color: z.string().optional().describe('节点颜色 (1-6)'),
        })).optional().describe('节点列表 (create/add_node)'),
        edges: z.array(z.object({
          fromNode: z.string().optional().describe('源节点 ID'),
          toNode: z.string().optional().describe('目标节点 ID'),
          fromSide: z.enum(['top', 'right', 'bottom', 'left']).optional(),
          toSide: z.enum(['top', 'right', 'bottom', 'left']).optional(),
          label: z.string().optional().describe('边标签'),
          color: z.string().optional(),
        })).optional().describe('边列表 (create/add_edge)'),
        topic: z.string().optional().describe('思维导图中心主题 (mindmap)'),
        branches: z.array(z.object({
          label: z.string().optional().describe('分支标签'),
          children: z.array(z.object({
            label: z.string().optional(),
            children: z.array(z.any()).optional(),
          })).optional().describe('子节点'),
        })).optional().describe('思维导图分支 (mindmap)'),
        excalidraw_filename: z.string().optional().describe('导出文件名 (export_to_excalidraw)'),
        excalidraw_folder: z.string().optional().describe('导出文件夹 (export_to_excalidraw)'),
      }),
    },
  );
