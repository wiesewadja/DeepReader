/**
 * Excalidraw LangChain tool wrapper
 *
 * 提供详细的设计哲学和布局参考信息，指导 LLM 生成高质量图形 JSON。
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { excalidrawTool } from '../excalidraw/excalidraw.js';
import type { ToolContext } from '../types.js';
import type { ToolFactory } from './types.js';
import { SHARED_DIAGRAM_PROMPT } from '../excalidraw/excalidraw-prompts.js';

export const createExcalidrawTool: ToolFactory = (ctx: ToolContext) =>
  tool(
    async ({ filename, elements, layout }) => {
      return excalidrawTool.execute({ filename, elements, layout }, ctx);
    },
    {
      name: 'excalidraw',
      description: SHARED_DIAGRAM_PROMPT,
      schema: z.object({
        filename: z
          .string()
          .describe('输出文件名（不含扩展名），如 "思维导图-书名"'),
        layout: z
          .enum(['mind-map', 'hierarchical-tree', 'flow-horizontal', 'timeline', 'radial', 'matrix'])
          .describe('使用的几何布局算法类型，必填。系统会根据此类型重新计算所有节点坐标'),
        elements: z
          .array(
            z.object({
              id: z.string().describe('描述性 ID，如 "root_node", "arrow_to_child"'),
              type: z
                .enum(['rectangle', 'ellipse', 'diamond', 'arrow', 'line', 'text'])
                .describe('元素类型'),
              x: z.number().describe('X 坐标'),
              y: z.number().describe('Y 坐标'),
              width: z.number().describe('宽度'),
              height: z.number().describe('高度（箭头/线条可设 0）'),
              text: z.string().optional().describe('文本内容'),
              opacity: z.number().optional().describe('透明度 (推荐 100)'),
              fontSize: z.number().optional().describe('字号 (16, 20, 28, 36)'),
              textAlign: z
                .enum(['left', 'center', 'right'])
                .optional()
                .describe('文本对齐'),
              verticalAlign: z
                .enum(['top', 'middle', 'bottom'])
                .optional()
                .describe('垂直对齐'),
              points: z
                .array(z.tuple([z.number(), z.number()]))
                .optional()
                .describe('箭头/线条路径点（相对坐标，从 [0,0] 开始）'),
              startBinding: z
                .object({ elementId: z.string(), gap: z.number(), focus: z.number() })
                .optional()
                .describe('箭头起始绑定'),
              endBinding: z
                .object({ elementId: z.string(), gap: z.number(), focus: z.number() })
                .optional()
                .describe('箭头终止绑定'),
              startArrowHead: z
                .enum(['arrow', 'triangle', 'dot', 'bar'])
                .nullable()
                .optional()
                .describe('起始箭头类型'),
              endArrowHead: z
                .enum(['arrow', 'triangle', 'dot', 'bar'])
                .nullable()
                .optional()
                .describe('终止箭头类型'),
              containerId: z
                .string()
                .optional()
                .describe('文本绑定的容器元素 ID'),
              boundElements: z
                .array(
                  z.object({
                    id: z.string(),
                    type: z.enum(['text', 'arrow']),
                  })
                )
                .optional()
                .describe('绑定到此元素的子元素'),
              groupIds: z
                .array(z.string())
                .optional()
                .describe('分组 ID'),
              semanticColor: z
                .enum(['primary', 'emphasis', 'success', 'warning', 'highlight', 'neutral'])
                .optional()
                .describe('节点的语义颜色角色，系统会根据当前主题映射到具体书卷风格色值'),
            })
          )
          .describe('Excalidraw 元素数组，包含形状、文本、箭头等'),
      }),
    },
  );
