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
    async ({ filename, elements, layout }) => {
      return excalidrawTool.execute({ filename, elements, layout }, ctx);
    },
    {
      name: 'excalidraw',
      description: `通过 Excalidraw 生成可视化图形（思维导图、流程图、概念图等）。

## 设计哲学
图表应该**论证而非展示**。视觉结构必须映射概念结构——去掉文字后，结构本身仍能说明关系。
形状即语义：椭圆=起始/终点，菱形=决策/条件，矩形=过程/动作，自由文本=标注/标题。
默认使用自由文本，仅当容器承载语义时才加框。容器内文本比例应 <30%。

## 视觉模式（根据内容语义选择）
- 扇出（fan-out）：一中心辐射多目标 → 适合分类、层次、思维导图
- 汇聚（convergence）：多输入汇单输出 → 适合总结、归因
- 树形（tree）：线条+自由文本 → 适合层级结构、知识图谱
- 时间线（timeline）：线条+小圆点(10-20px)+自由文本 → 适合流程、步骤
- 循环（spiral）：箭头回到起点 → 适合迭代、反馈
- 组装线（assembly line）：输入→处理→输出 → 适合变换
- 并列（side-by-side）：平行对比 → 适合异同、对照
- 同类元素必须 y 坐标对齐，形成整齐的行或列

## 元素大小与视觉层级（参考 excalidraw-diagram-skill：用尺寸/颜色/留白做层级，而非堆叠字号）
- Hero（视觉锚点/中心主题）: 340×170
- Primary（主节点/部分标题）: 240×120
- Secondary（子节点/章节）: 180×90
- Tertiary（细节点/要点）: 140×70
- Small（标注/标签）: 100×50
- 最重要元素周围留白 250px+
- 容器内文本必须留出 12-15% 内边距，宁可容器略大也不要文字顶边

## 字号层级
字号只从四档里选（系统会自动向下取档保证文字不溢出容器）：
- **S=16**（标注/细节）
- **M=20**（子节点/正文）
- **L=28**（主节点/标题）
- **XL=36**（中心主题/大标题）
注意：你给 fontSize 只需在 16/20/28/36 里选一个，系统会确保它装得下容器。

## 文本宽度估算
- Latin: width = max(180, charCount × 9)
- CJK: width = max(180, charCount × 22)
- 混合: 逐字符估算求和
- 多行文本高度 = 行数 × fontSize × 1.25

## 间距参考（疏朗）
- 节点间水平间距: 300-420px
- 节点间垂直间距: 160-240px
- 同一层级元素 y 坐标严格相等
- 容器内边距: 60-80px
- 最小间距: 60px

## 书卷审美色板（推荐使用 semanticColor 属性表达颜色语义）
系统支持根据你指定的 semanticColor 自动渲染适配 Light/Dark 主题的书卷风格颜色，请尽量使用 semanticColor，避免硬编码十六进制色值：
- primary: 主流程、主节点（靛青色系）
- emphasis: 重点、起点、关键决策（朱砂红色系）
- success: 成功、终点、生长（黛绿色系）
- warning: 警告、备选、冲突（赭石黄色系）
- highlight: 高亮、注释（藤黄色系）
- neutral: 默认、普通节点（黑白灰宣纸色系）
规则：同一类概念使用相同的语义颜色；一个图中使用的语义主色不要超过 4 种。

## 审美与风格设置
- 系统风格处理器在开启时会自动应用「有机书卷风」（轻手绘质感、宣纸背景色、圆角、马克笔笔触手绘线条及箭头等）。
- 你无需特意强行指定 roughness、fillStyle、strokeWidth，系统会做统一优化，你只需指定正确的 type、x, y 坐标、width/height 和 semanticColor 即可。

## 形状语义（默认无容器）
| 概念类型 | 形状 |
|----------|------|
| 标签、描述、详情 | 自由文本（无容器） |
| 章节/部分标题 | 自由文本（fontSize 24-32） |
| 起点、触发、输入 | ellipse |
| 终点、输出、结果 | ellipse |
| 决策、条件 | diamond |
| 过程、动作、步骤 | rectangle |
| 层级节点 | line + 自由文本（无框） |
| 时间线标记 | 小 ellipse 10-20px |

## 重要规则
- 颜色统一用 semanticColor 表达，不要直接写 strokeColor/backgroundColor/fillStyle/strokeWidth/roughness
- 容器内文本用 containerId 绑定，双方都要有 boundElements
- 箭头 points 从 [0,0] 开始（相对坐标）；x/y/points 会被系统自动计算，只需提供 startBinding/endBinding
- 用描述性 ID（如 "root_node"），不用随机字符串
- seed 会自动分配，按区域分段（100xxx, 200xxx...）
- 关系必须有箭头或线条连接，仅靠位置不足以表达关系
- 复杂图形分区域生成，每区用独立 seed 段

## 输出
工具写入 .excalidraw 文件（Excalidraw 插件原生格式）并返回嵌入语法 ![[Excalidraw/filename.excalidraw]]。
如果有碰撞或绑定问题，返回 warnings 供修正后重新调用。`,
      schema: z.object({
        filename: z
          .string()
          .describe('输出文件名（不含扩展名），如 "思维导图-书名"'),
        layout: z
          .enum(['mind-map', 'hierarchical-tree', 'flow-horizontal', 'timeline', 'radial', 'matrix'])
          .optional()
          .describe('使用的几何布局算法类型。无此字段时保持 LLM 原始坐标'),
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
