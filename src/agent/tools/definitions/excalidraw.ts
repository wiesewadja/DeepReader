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

const mindmapDataSchema = z.object({
  topic: z.string().describe('中心主题'),
  summary: z.string().optional().describe('主题摘要，显示在节点下方'),
  branches: z.array(z.object({
    label: z.string().describe('分支标签'),
    annotation: z.string().optional().describe('分支注释'),
    importance: z.enum(['high', 'medium', 'low']).optional().describe('重要性'),
    children: z.array(z.object({
      label: z.string().describe('子节点标签'),
      annotation: z.string().optional().describe('子节点注释'),
      importance: z.enum(['high', 'medium', 'low']).optional(),
      children: z.array(z.object({
        label: z.string().describe('叶节点标签'),
        annotation: z.string().optional(),
      })).optional().describe('叶节点（最多一层）'),
    })).describe('子节点列表'),
  })).describe('分支列表，每个分支自动分配不同颜色'),
}).describe('思维导图数据 (diagramType=mindmap 时使用)');

const knowledgeGraphDataSchema = z.object({
  title: z.string().describe('图谱标题'),
  groups: z.array(z.object({
    id: z.string().describe('分组 ID'),
    label: z.string().describe('分组名称'),
  })).optional().describe('分组列表，节点通过 group 字段关联分组'),
  nodes: z.array(z.object({
    id: z.string().describe('唯一标识符'),
    label: z.string().describe('节点标签'),
    type: z.enum(['concept', 'person', 'event', 'book', 'theme']).optional().describe('节点类型决定形状：concept=矩形, person=椭圆, event=菱形'),
    group: z.string().optional().describe('所属分组 ID'),
    importance: z.enum(['core', 'major', 'minor']).optional().describe('重要度决定尺寸：core 最大居中, major 中等, minor 最小'),
    annotation: z.string().optional().describe('节点注释'),
  })).describe('节点列表'),
  edges: z.array(z.object({
    from: z.string().describe('起始节点 ID'),
    to: z.string().describe('目标节点 ID'),
    label: z.string().optional().describe('关系描述'),
    type: z.enum(['hierarchy', 'causal', 'comparison', 'temporal', 'association']).optional().describe('关系类型决定线型：causal=粗实线, comparison=虚线, temporal=点线, hierarchy=实线, association=细线'),
    direction: z.enum(['directed', 'undirected', 'bidirectional']).optional().describe('方向：directed 单箭头, undirected 无箭头, bidirectional 双箭头'),
  })).describe('边列表'),
}).describe('知识图谱数据 (diagramType=knowledge_graph 时使用)');

export const createExcalidrawToolDefinition: ToolFactory = (ctx: ToolContext) =>
  tool(
    async (args) => {
      return createExcalidrawTool().execute(args, ctx);
    },
    {
      name: 'excalidraw',
      description: `创建 Excalidraw 图表。
支持操作: create(创建空白文件), mindmap(简单思维导图), knowledge_graph(简单知识图谱), draw(专业图表，支持丰富语义), check(检查插件状态)。

推荐使用 draw 操作，它支持更丰富的数据结构：
- 思维导图：分支自动着色，支持注释、重要性标注、三级嵌套
- 知识图谱：节点类型决定形状，重要度决定尺寸，分组容器，边类型决定线型`,
      schema: z.object({
        action: z.enum(['create', 'mindmap', 'knowledge_graph', 'draw', 'check']).describe('操作类型'),
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
        diagramType: z.enum(['mindmap', 'knowledge_graph']).describe('图表类型 (draw)'),
        data: z.union([mindmapDataSchema, knowledgeGraphDataSchema]).describe('图表语义数据 (draw)'),
        style: z.enum(['precise', 'handdrawn', 'sketch']).optional().describe('绘图风格：precise=精确, handdrawn=手绘(默认), sketch=草图'),
      }),
    },
  );
