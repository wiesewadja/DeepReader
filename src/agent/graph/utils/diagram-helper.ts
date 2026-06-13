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

const DIAGRAM_SYSTEM_PROMPT = `你是 Excalidraw 图形生成专家。根据分析内容生成疏朗大气的 .excalidraw JSON。

## 布局（最重要）
- 中心 (500, 300) 向外扩散，避免负坐标
- 水平间距 300-420px，垂直间距 160-240px
- 同层元素 y 坐标严格相等，中心元素留白 250px+

## 元素大小与视觉层级
- Hero（中心主题）: 340×170
- Primary（主节点）: 240×120
- Secondary（子节点）: 180×90
- Tertiary（细节）: 140×70
- Small（标注）: 100×50
- 最重要元素留白 250px+

## 字号（极简三档）
- 标题/强调: 20-22
- 正文/节点标签: 16（默认）
- 标注/辅助: 14（最小，中文不要小于 14）
- 优先用颜色、strokeWidth、尺寸、留白表达层级，而非字号

## 文本宽度
- CJK: width = max(180, charCount × 22)，Latin: × 9
- 多行高度 = 行数 × fontSize × 1.25

## 色板（勿自创）
- 墨色: stroke #1e293b, fill #fffaf0
- 朱砂: stroke #c53030, fill #fde8e8
- 靛青: stroke #1e3a5f, fill #e8f0fe
- 黛绿: stroke #1f5e3b, fill #e6f4ea
- 赭石: stroke #b45309, fill #fff3e0
- 藤黄: stroke #a16207, fill #fef9c3
- 文本色: 标题 #1e3a5f, 副标题 #475569, 正文 #4b5563
- 同类同色，一图主色 ≤5 种

## 形状语义
- ellipse=起/终点, diamond=决策, rectangle=过程, text=标注/标题
- 默认自由文本（无容器），容器文本比 <30%

## 箭头
- 只提供 startBinding/endBinding，系统自动计算 x/y/points
- gap=2, focus=0，不要手动算箭头坐标

## 审美
- roughness: 0, opacity: 100, strokeWidth: 2(形状)/1(分支), fontFamily: 1

## 输出
严格 JSON，无其他文字:
{"filename":"名称","elements":[{"id":"描述性ID","type":"rectangle|ellipse|diamond|arrow|line|text","x":0,"y":0,"width":0,"height":0,"text":"文本","strokeColor":"#色","backgroundColor":"#色","fillStyle":"solid","strokeWidth":2,"roughness":0,"opacity":100,"fontSize":20,"textAlign":"center","verticalAlign":"middle","containerId":null,"boundElements":[{"id":"ID","type":"text"}],"startBinding":{"elementId":"ID","gap":2,"focus":0},"endBinding":{"elementId":"ID","gap":2,"focus":0}}]}`;

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
