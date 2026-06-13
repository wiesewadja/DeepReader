/**
 * Excalidraw LangChain tool wrapper
 *
 * 提供详细的设计哲学和布局参考信息，指导 LLM 生成高质量图形 JSON。
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { excalidrawTool } from '../excalidraw.js';
import type { ToolContext } from '../types.js';
import type { ToolFactory } from './types.js';

export const createExcalidrawTool: ToolFactory = (ctx: ToolContext) =>
  tool(
    async ({ filename, elements }) => {
      return excalidrawTool.execute({ filename, elements }, ctx);
    },
    {
      name: 'excalidraw',
      description: `通过 Excalidraw 生成可视化图形（思维导图、流程图、概念图等）。

## 设计哲学
图表应该**论证而非展示**。视觉结构应映射概念结构。
形状即语义：椭圆=起始/终点，菱形=决策/条件，矩形=过程/动作，自由文本=标注/标题。
默认使用自由文本，仅当容器承载语义时才加框。

## 视觉模式（根据内容语义选择）
- 扇出（fan-out）：一中心辐射多目标 → 适合分类、层次
- 汇聚（convergence）：多输入汇单输出 → 适合总结、归因
- 树形（tree）：线条+自由文本 → 适合层级结构
- 时间线（timeline）：线条+小圆点+自由文本 → 适合流程、步骤
- 循环（spiral）：箭头回到起点 → 适合迭代、反馈
- 组装线（assembly line）：输入→处理→输出 → 适合变换
- 并列（side-by-side）：平行对比 → 适合异同
- 同类元素 y 坐标对齐，形成整齐的行或列

## 元素大小参考
- Hero（视觉锚点）: 300×150, fontSize 28
- Primary（主节点）: 180×90, fontSize 24
- Secondary（子节点）: 120×60, fontSize 20
- Small（标注/标签）: 60×40, fontSize 16
- 最重要元素周围留最多空白（200px+）

## 文本宽度估算
- Latin: width = max(160, charCount × 9)
- CJK: width = max(160, charCount × 18)
- 混合: 逐字符估算求和

## 间距参考
- 节点间水平间距: 200-300px
- 节点间垂直间距: 100-150px
- 容器内边距: 50-60px
- 最小间距: 40px

## 审美设置
- roughness: 0（干净/专业，除非用户要求手绘风格）
- opacity: 100（所有元素）
- strokeWidth: 1-2（线条1，形状2）
- fontFamily: 3（monospace）

## 重要规则
- 所有文本必须显式设置 strokeColor（即文字颜色），否则可能不可见
- 容器内文本用 containerId 绑定，双方都要有 boundElements
- 箭头 points 从 [0,0] 开始（相对坐标）
- 用描述性 ID（如 "root_node"），不用随机字符串
- seed 会自动分配，按区域分段（100xxx, 200xxx...）
- 关系必须有箭头或线条连接，仅靠位置不足以表达关系

## 输出
工具写入 .excalidraw 文件并返回嵌入语法 ![[Excalidraw/filename.excalidraw]]。
如果有碰撞或绑定问题，返回 warnings 供修正后重新调用。`,
      schema: z.object({
        filename: z
          .string()
          .describe('输出文件名（不含扩展名），如 "思维导图-书名"'),
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
              strokeColor: z.string().optional().describe('线条/文字颜色'),
              backgroundColor: z.string().optional().describe('填充颜色'),
              fillStyle: z
                .enum(['solid', 'hachure', 'cross-hatch'])
                .optional()
                .describe('填充样式'),
              strokeWidth: z.number().optional().describe('线条宽度 (1-3)'),
              roughness: z.number().optional().describe('粗糙度 0=干净 1=手绘'),
              opacity: z.number().optional().describe('透明度 (推荐 100)'),
              fontSize: z.number().optional().describe('字号 (14-28)'),
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
            })
          )
          .describe('Excalidraw 元素数组，包含形状、文本、箭头等'),
      }),
    },
  );
