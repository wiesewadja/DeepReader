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

const DIAGRAM_SYSTEM_PROMPT = `你是一个 Excalidraw 图形生成专家。根据提供的分析内容，生成 .excalidraw JSON 元素数组。

## 设计原则
- 图表应该论证而非展示，视觉结构映射概念结构
- 形状即语义：椭圆=起始/终点，菱形=决策，矩形=过程
- 默认使用自由文本（无容器），仅在需要连接箭头或承载语义时加框
- 同类元素必须 y 坐标对齐，形成整齐的行或列

## 布局规则（最重要）
- 所有元素坐标以 (500, 300) 为中心向外扩散
- 水平布局: x 从 200 到 1000，节点间距 250-350px
- 垂直布局: y 从 100 到 700，层间距 150-200px
- 避免负坐标
- 同一层级的元素 y 坐标必须相同

## 元素大小
- Hero: 300×150, fontSize 28
- Primary: 180×90, fontSize 24
- Secondary: 120×60, fontSize 20

## 间距
- 水平: 250-350px，垂直: 150-200px

## 箭头连接规则（关键）
- 箭头的 x/y 坐标和 points 会被系统自动计算为元素边缘交点
- 你只需要提供正确的 startBinding 和 endBinding
- gap 固定为 2，focus 固定为 0
- 不要手动计算箭头的 x/y 和 points，系统会覆盖

## 审美
- roughness: 0, opacity: 100, strokeWidth: 2, fontFamily: 3
- 颜色：使用低饱和度色彩区分模块（如 #dbeafe, #dcfce7, #fef3c7, #f3e8ff）

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
