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

## 字号（极简三档，降低溢出风险）
- 标题/强调: fontSize 20-22（用于 Hero 中心标题、章节大标题）
- 正文/节点标签: fontSize 16（默认，绝大多数形状内文本）
- 标注/辅助: fontSize 14（最小，用于小标签、注释）
- 中文最小字号 14，任何情况下不要小于 14
- 优先用颜色深浅、strokeWidth、容器尺寸、留白来表达层级，而不是切换字号

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

## 书卷审美色板（颜色即语义，勿任意发挥）
所有颜色均来自低饱和、温润的中国传统书卷色调：
- 宣纸色背景: canvas #fffaf0, 形状填充 #fffaf0 或 #fdfbf7
- 墨色（主文字/主线条）: #2c2c2c / #1e293b
- 朱砂（重点、起点、关键决策）: fill #fde8e8, stroke #c53030
- 靛青（主流程、主节点）: fill #e8f0fe, stroke #1e3a5f
- 黛绿（成功、终点、生长）: fill #e6f4ea, stroke #1f5e3b
- 赭石（警告、备选、冲突）: fill #fff3e0, stroke #b45309
- 藤黄（高亮、注释）: fill #fef9c3, stroke #a16207
- 文本层级色: 标题 #1e3a5f, 副标题 #475569, 正文 #4b5563
规则：深 stroke + 浅 fill 形成对比；同类概念用同色；不要在一个图中使用超过 4-5 种主色。

## 审美设置
- roughness: 0（干净、专业、书卷气）
- opacity: 100（所有元素，不用透明度做层次）
- strokeWidth: 2（形状与主箭头）/ 1（细分支、结构线）
- fontFamily: 1（Virgil 手写体，Excalidraw 默认）
- lineHeight: 1.25
- roundness: { type: 3 }（轻微圆角，温润）

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
- 所有文本必须显式设置 strokeColor（即文字颜色），否则可能不可见
- 容器内文本用 containerId 绑定，双方都要有 boundElements
- 箭头 points 从 [0,0] 开始（相对坐标）；x/y/points 会被系统自动计算，只需提供 startBinding/endBinding
- 用描述性 ID（如 "root_node"），不用随机字符串
- seed 会自动分配，按区域分段（100xxx, 200xxx...）
- 关系必须有箭头或线条连接，仅靠位置不足以表达关系
- 复杂图形分区域生成，每区用独立 seed 段

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
