/**
 * Diagram generation helper for nodes without a PlanExecute tool loop.
 *
 * Used by S1 Inspectional and S3 Syntopical to generate excalidraw diagrams
 * when diagram intent is detected in the user query.
 *
 * Design note: this helper calls excalidrawTool.execute directly because
 * S1/S3 run outside the ReAct/PlanExecute tool loop. The LangChain wrapper
 * (createExcalidrawTool) is still registered in createLangChainTools so that
 * S2 Analytical can invoke excalidraw via standard tool_calls when needed.
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { agentLog as log } from '../../../utils/logger.js';
import { excalidrawTool } from '../../tools/excalidraw.js';
import type { ToolContext } from '../../tools/types.js';

const DIAGRAM_INTENT_RE = /思维导图|脑图|流程图|概念图|画.{0,6}图|可视化展示|可视化|导图|示意图|infographic|图表|知识图谱/;

const DIAGRAM_SYSTEM_PROMPT = `你是一个 Excalidraw 图形生成专家。根据提供的分析内容，生成疏朗、大气、具有书卷审美的 .excalidraw JSON 元素数组。

## 设计原则
- 图表应该**论证而非展示**。视觉结构必须映射概念结构——去掉文字后，结构本身仍能说明关系。
- 形状即语义：椭圆=起始/终点，菱形=决策，矩形=过程/动作，自由文本=标注/标题。
- 默认使用自由文本（无容器），仅当容器承载语义时才加框。容器内文本比例应 <30%。
- 同类元素必须 y 坐标对齐，形成整齐的行或列。

## 布局规则（最重要）
- 所有元素坐标以 (500, 300) 为中心向外扩散
- 水平布局: x 从 200 到 1200，主节点间距 300-420px
- 垂直布局: y 从 100 到 800，层间距 160-240px
- 避免负坐标
- 同一层级的元素 y 坐标必须严格相同
- 中心/主题元素周围留白 250px+

## 元素大小与字号层级（书卷审美：疏朗、大气）
- Hero（视觉锚点/中心主题）: 320×160, fontSize 34-38
- Primary（主节点/部分标题）: 220×110, fontSize 26-28
- Secondary（子节点/章节）: 160×80, fontSize 20-22
- Tertiary（细节点/要点）: 120×60, fontSize 16-18
- Small（标注/标签）: 80×44, fontSize 14
- 自由文本标题: fontSize 24-32（无需容器）
- 自由文本正文: fontSize 16-20

## 文本宽度估算
- Latin: width = max(180, charCount × 9)
- CJK: width = max(180, charCount × 22)
- 混合: 逐字符估算求和
- 多行文本高度 = 行数 × fontSize × 1.25

## 书卷审美色板（颜色即语义，勿任意发挥）
- 宣纸白背景: canvas #ffffff, 形状填充 #fffaf0 或 #fdfbf7
- 墨色（主文字/主线条）: #2c2c2c / #1e293b
- 朱砂（重点、起点、关键决策）: fill #fde8e8, stroke #c53030
- 靛青（主流程、主节点）: fill #e8f0fe, stroke #1e3a5f
- 黛绿（成功、终点、生长）: fill #e6f4ea, stroke #1f5e3b
- 赭石（警告、备选、冲突）: fill #fff3e0, stroke #b45309
- 藤黄（高亮、注释）: fill #fef9c3, stroke #a16207
- 文本层级色: 标题 #1e3a5f, 副标题 #475569, 正文 #4b5563
规则：深 stroke + 浅 fill 形成对比；同类概念用同色；一图中主色不超过 4-5 种。

## 审美设置
- roughness: 0（干净、专业、书卷气）
- opacity: 100（所有元素，不用透明度做层次）
- strokeWidth: 2（形状与主箭头）/ 1（细分支、结构线）
- fontFamily: 3（等宽字体，中文清晰）
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

## 箭头连接规则（关键）
- 箭头的 x/y 坐标和 points 会被系统自动计算为元素边缘交点
- 你只需要提供正确的 startBinding 和 endBinding
- gap 固定为 2，focus 固定为 0
- 不要手动计算箭头的 x/y 和 points，系统会覆盖

## 输出格式
严格输出 JSON 对象，包含 filename 和 elements 字段。不要包含任何其他文字。
{
  "filename": "图形名称",
  "elements": [
    {
      "id": "描述性ID",
      "type": "rectangle|ellipse|diamond|arrow|line|text",
      "x": 数字,
      "y": 数字,
      "width": 数字,
      "height": 数字,
      "text": "文本内容（可选）",
      "strokeColor": "#颜色",
      "backgroundColor": "#颜色",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "roughness": 0,
      "opacity": 100,
      "fontSize": 20,
      "textAlign": "center",
      "verticalAlign": "middle",
      "lineHeight": 1.25,
      "containerId": null,
      "boundElements": [{"id": "子元素ID", "type": "text"}],
      "startBinding": {"elementId": "ID", "gap": 2, "focus": 0},
      "endBinding": {"elementId": "ID", "gap": 2, "focus": 0}
      // 注：箭头元素的 x/y/points 可省略，系统会根据 binding 自动计算
    }
  ]
}`;

/**
 * Extract the outermost balanced JSON object from text, ignoring strings.
 * Handles markdown code fences and ignores content outside the JSON.
 */
function extractJsonObject(text: string): string | null {
  // Strip markdown code fences if present
  const cleaned = text.replace(/```(?:json)?\s*([\s\S]*?)\s*```/g, '$1').trim();

  let start = -1;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
    } else {
      if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          return cleaned.slice(start, i + 1);
        }
      }
    }
  }
  return null;
}

/**
 * Detect diagram intent from the user query.
 */
export function hasDiagramIntent(query: string): boolean {
  return DIAGRAM_INTENT_RE.test(query);
}

/**
 * Generate an excalidraw diagram from analysis context.
 *
 * Returns the embed code (e.g. "![[Excalidraw/xxx.excalidraw]]")
 * or an empty string if generation failed.
 */
export async function generateDiagram(
  query: string,
  analysisContent: string,
  model: BaseChatModel,
  toolContext: ToolContext,
  options?: { pdfName?: string },
): Promise<string> {
  const userMessage = `用户问题：${query}

${options?.pdfName ? `书籍：${options.pdfName}\n` : ''}
分析内容：
${analysisContent}

请根据以上内容生成 Excalidraw 图形。输出严格的 JSON 格式。`;

  try {
    const response = await model.invoke([
      new SystemMessage(DIAGRAM_SYSTEM_PROMPT),
      new HumanMessage(userMessage),
    ]);

    const text = typeof response.content === 'string' ? response.content : '';

    // 提取 JSON（可能被 ```json 包裹）
    const jsonText = extractJsonObject(text);
    if (!jsonText) {
      log('[DiagramHelper] LLM 未返回有效 JSON');
      return '';
    }

    let parsed: { filename?: string; elements?: unknown[] };
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      log('[DiagramHelper] JSON 解析失败');
      return '';
    }

    if (!parsed.filename || !Array.isArray(parsed.elements) || parsed.elements.length === 0) {
      log('[DiagramHelper] 缺少 filename 或 elements');
      return '';
    }

    const result = await excalidrawTool.execute(
      { filename: parsed.filename, elements: parsed.elements },
      toolContext,
    );

    let parsedResult: { success?: boolean; embed?: string; warnings?: string[] };
    try {
      parsedResult = JSON.parse(result);
    } catch {
      log('[DiagramHelper] 工具返回非 JSON:', result.slice(0, 100));
      return '';
    }

    if (parsedResult.success && parsedResult.embed) {
      const warningsNote = parsedResult.warnings?.length
        ? `\n\n> 图形有 ${parsedResult.warnings.length} 个布局警告，可能需要调整`
        : '';
      return parsedResult.embed + warningsNote;
    }

    return '';
  } catch (error) {
    log('[DiagramHelper] 生成失败:', error instanceof Error ? error.message : String(error));
    return '';
  }
}
