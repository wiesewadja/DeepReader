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
import { excalidrawTool, writeExcalidrawJson, buildExcalidrawJSON } from '../../tools/excalidraw.js';
import type { ElementDef, DiagramLayoutType } from '../../tools/excalidraw-types.js';
import type { ToolContext } from '../../tools/types.js';
import { SHARED_DIAGRAM_PROMPT } from '../../tools/excalidraw-prompts.js';

const DIAGRAM_INTENT_RE = /思维导图|脑图|流程图|概念图|画.{0,6}图|可视化展示|可视化|导图|示意图|infographic|图表|知识图谱/;
const DIAGRAM_SYSTEM_PROMPT = SHARED_DIAGRAM_PROMPT;

/**
 * analysisContent 安全长度上限（字符）。
 *
 * 依据：GLM-4 / DeepSeek 等模型 context window 通常 8K-32K tokens，
 * 扣除 system prompt（约 2K tokens）+ 用户 query + 输出 JSON 元素（200 个元素约 4K tokens），
 * 留给 analysisContent 的安全上限约 5000 tokens，按中文 1 字 ≈ 0.6 token 估算约 8000 字符。
 * 超过此阈值会导致 LLM 输出截断或质量崩塌。
 */
const ANALYSIS_CONTENT_MAX_CHARS = 8000;

/**
 * 截断 analysisContent 到安全长度，防止 LLM context 溢出。
 * 截断后追加显式标记，让 LLM 知道内容被截断。
 */
function truncateAnalysisContent(content: string): string {
  if (content.length <= ANALYSIS_CONTENT_MAX_CHARS) return content;
  log(`[DiagramHelper] analysisContent length ${content.length} exceeds ${ANALYSIS_CONTENT_MAX_CHARS}, truncating...`);
  return content.slice(0, ANALYSIS_CONTENT_MAX_CHARS) + '\n\n[...内容过长已截断...]';
}

// ==================== 渐进式分节生成 ====================

/** 分节大纲最大节数（中心 + 主分支），超出由 LLM 合并 */
const MAX_SECTIONS = 5;

/**
 * 生成唯一后缀（HHMMSS）：用于绘图文件名，保证多次绘图不撞名。
 * 一次对话里 S1/S2/S3 可能各画一张，不加后缀会覆盖同名文件。
 */
export function uniqueSuffix(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * 清洗 filename：去掉书名号《》、引号、斜杠、冒号等非法字符，只保留
 * 中文/字母/数字/空格/连字符/下划线。LLM 常把书名号带进 filename。
 *
 * @returns 清洗后的合法 filename；清洗后为空则返回 null
 */
export function sanitizeFilename(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  // 去常见包裹符号：书名号、引号、括号
  let s = raw.replace(/[《》""''()\[\]【】]/g, '');
  // 只保留合法字符（中文/字母/数字/空格/连字符/下划线）
  s = s.replace(/[^\w一-鿿\- ]/g, '');
  s = s.trim().replace(/\s+/g, ' '); // 折叠多空格
  // 校验：首字符不能是空格，长度 1-100
  if (!s || !/^[\w一-鿿\-][\w一-鿿\- ]{0,100}$/.test(s)) return null;
  return s;
}

/**
 * 一节的规划描述（由 planDiagramSections 解析 LLM 大纲得到）。
 * id 前缀约定 secN（N 为节序号，1-based），供跨节箭头绑定引用。
 */
interface DiagramSectionPlan {
  /** 节标题（如"中心主题"、"动力系统分支"） */
  title: string;
  /** 该节要表达的要点（来自分析内容） */
  content: string;
  /** 需箭头连接的其他节 title（跨节绑定），可选 */
  connectsTo?: string[];
  /** y 坐标区间 [min, max]，节内元素 y 落在此区间，避免节间重叠 */
  yBand: [number, number];
}

/** 大纲解析结果：filename + 节列表 */
interface DiagramPlan {
  filename: string;
  sections: DiagramSectionPlan[];
}

/**
 * 分节规划 prompt：让 LLM 看分析内容，输出分节大纲（≤5 节）。
 * 不生成具体元素，只规划"节结构"——每节标题/要点/连接/y 坐标区间。
 */
const DIAGRAM_PLAN_PROMPT = `你是 Excalidraw 图形架构师。根据分析内容，规划一张思维导图/概念图的**分节结构**（不生成具体元素）。

## 目标
把内容拆成最多 ${MAX_SECTIONS} 节，每节是图的一个视觉区域（如中心主题、各主分支）。后续会逐节生成元素，所以节的划分要：
- 每节内聚（一个完整的概念组）
- 节间有明确的连接关系（哪些节需要箭头相连）
- 节的 y 坐标区间不重叠（垂直分层布局）

## 分节原则
- 第 1 节通常是"中心主题"（图的视觉锚点，放中间）
- 后续每节是一个主分支或逻辑组
- 节数宁少勿多：3-5 节为宜，简单内容 2-3 节即可
- 不要为了凑数硬拆

## 布局约定（y 坐标区间，避免节间重叠）
- 中心主题节：yBand [280, 420]（垂直居中）
- 上方分支节：yBand [80, 240]
- 下方分支节：yBand [460, 620]
- 左侧/右侧分支：复用上/下区间，靠 x 坐标区分
- 每节元素 y 必须落在其 yBand 内

## 输出格式（严格 JSON，无其他文字）
{
  "filename": "图形名称（中文，不含扩展名；不要书名号《》、引号、斜杠、冒号等符号，只用中文/字母/数字/空格/连字符，如 '自卑与超越核心概念' 而非 '《自卑与超越》核心概念'）",
  "sections": [
    {
      "title": "节标题",
      "content": "该节要表达的核心要点（1-2 句，来自分析内容）",
      "connectsTo": ["其他节标题"],  // 该节需要箭头连接到的节；中心主题通常不需要 connectsTo；首节可省略此字段
      "yBand": [minY, maxY]
    }
  ]
}

## 约束
- sections 数量 1-${MAX_SECTIONS}
- 每个节必须有 title / content / yBand
- connectsTo 引用的 title 必须是其他节的真实 title
- yBand 区间不与其他节重叠（中心节除外，它可被分支"指向"）`;

/**
 * 规划分节大纲：1 次 invoke 让 LLM 输出节结构。
 *
 * @returns 大纲（filename + sections）；解析失败返回 null（调用方 fallback 到单次生成）
 */
export async function planDiagramSections(
  query: string,
  analysisContent: string,
  model: BaseChatModel,
  options?: { pdfName?: string; signal?: AbortSignal },
): Promise<DiagramPlan | null> {
  const userMessage = `用户问题：${query}

${options?.pdfName ? `书籍：${options.pdfName}\n` : ''}
分析内容：
${analysisContent}

请规划这张图的分节结构。`;

  try {
    const response = await model.invoke(
      [new SystemMessage(DIAGRAM_PLAN_PROMPT), new HumanMessage(userMessage)],
      options?.signal ? { signal: options.signal } : undefined,
    );

    const text = typeof response.content === 'string' ? response.content : '';
    const jsonText = extractJsonObject(text);
    if (!jsonText) {
      log('[DiagramHelper] planDiagramSections: LLM 未返回有效 JSON');
      return null;
    }

    let parsed: { filename?: string; sections?: unknown };
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      log('[DiagramHelper] planDiagramSections: JSON 解析失败');
      return null;
    }

    if (!parsed.filename || !Array.isArray(parsed.sections) || parsed.sections.length === 0) {
      log('[DiagramHelper] planDiagramSections: 缺少 filename 或 sections');
      return null;
    }

    // filename 清洗：LLM 可能带书名号《》、引号、斜杠等非法字符
    // 先 sanitize 再校验，避免合法意图被 LLM 输出格式问题误杀
    const filename = sanitizeFilename(parsed.filename);
    if (!filename) {
      log(`[DiagramHelper] planDiagramSections: filename 清洗后仍非法 "${parsed.filename}"`);
      return null;
    }

    // 校验 + 裁剪每节
    const sections: DiagramSectionPlan[] = [];
    for (const raw of parsed.sections) {
      if (sections.length >= MAX_SECTIONS) break;
      const s = raw as Record<string, unknown>;
      const title = typeof s.title === 'string' ? s.title.trim() : '';
      const content = typeof s.content === 'string' ? s.content.trim() : '';
      const yBand = Array.isArray(s.yBand) && s.yBand.length === 2
        ? [Number(s.yBand[0]), Number(s.yBand[1])] as [number, number]
        : null;
      if (!title || !content || !yBand || Number.isNaN(yBand[0]) || Number.isNaN(yBand[1])) {
        log(`[DiagramHelper] planDiagramSections: 节字段不完整，跳过 "${title}"`);
        continue;
      }
      const connectsTo = Array.isArray(s.connectsTo)
        ? s.connectsTo.filter((t): t is string => typeof t === 'string')
        : undefined;
      sections.push({ title, content, connectsTo, yBand });
    }

    if (sections.length === 0) {
      log('[DiagramHelper] planDiagramSections: 无有效节');
      return null;
    }

    log(`[DiagramHelper] planDiagramSections: 规划 ${sections.length} 节 [${sections.map(s => s.title).join(', ')}]`);
    // 追加唯一后缀，避免多次绘图同名覆盖（与单次 generateDiagram 一致）
    return { filename: `${filename}-${uniqueSuffix()}`, sections };
  } catch (err) {
    log('[DiagramHelper] planDiagramSections 异常:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** 导出类型供 B2/B3/测试使用 */
export type { DiagramSectionPlan, DiagramPlan };

/**
 * 单节生成 prompt：给定一节大纲 + 已有元素 id 清单（供跨节箭头引用），输出该节元素。
 * 复用 DIAGRAM_SYSTEM_PROMPT 的布局/色板/形状语义规则，只补充分节约束。
 */
const DIAGRAM_SECTION_PROMPT = `${DIAGRAM_SYSTEM_PROMPT}

## 本次任务（单节生成）
你只生成图中**某一节**的元素，不是整张图。其他节由后续步骤生成。

### 本节信息
- 节标题：<SECTION_TITLE>
- 节内容要点：<SECTION_CONTENT>
- 本节 y 坐标区间：<Y_BAND>（本节所有元素 y 必须落在此区间内）

### 已有元素（前序节生成的，供跨节箭头引用）
<EXISTING_IDS>
若本节需要箭头连接到前序节的元素，startBinding/endBinding 的 elementId 用上面的 id。
若 EXISTING_IDS 为空（说明这是第一节），本节元素内部自连接即可。

### ID 约定
本节元素 id 用前缀 <ID_PREFIX>_（如 <ID_PREFIX>_node1），避免与前序节冲突。

## 输出格式（严格 JSON）
{
  "elements": [
    { "id": "<ID_PREFIX>_xxx", "type": "...", ... }
  ]
}
不要输出 filename（filename 在规划阶段已确定）。不要输出其他文字。`;

/**
 * 生成一节的元素。
 *
 * @param section 本节大纲（title/content/yBand）
 * @param sectionIndex 节序号（1-based），用于生成 id 前缀 secN
 * @param existingIds 前序节已有的元素 id 清单（供跨节箭头引用）
 * @param model LLM
 * @returns 该节的 ElementDef[]；空数组表示生成失败
 */
export async function generateSection(
  section: DiagramSectionPlan,
  sectionIndex: number,
  existingIds: string[],
  model: BaseChatModel,
  options?: { signal?: AbortSignal },
): Promise<ElementDef[]> {
  const idPrefix = `sec${sectionIndex}`;
  const userMessage = `请生成本节元素。

本节标题：${section.title}
本节内容：${section.content}
本节 y 坐标区间：[${section.yBand[0]}, ${section.yBand[1]}]
已有元素 id（跨节箭头可引用）：${existingIds.length > 0 ? existingIds.join(', ') : '（无，本节是第一节）'}
本节 id 前缀：${idPrefix}`;

  try {
    const response = await model.invoke(
      [new SystemMessage(DIAGRAM_SECTION_PROMPT), new HumanMessage(userMessage)],
      options?.signal ? { signal: options.signal } : undefined,
    );

    const text = typeof response.content === 'string' ? response.content : '';
    const jsonText = extractJsonObject(text);
    if (!jsonText) {
      log(`[DiagramHelper] generateSection[${idPrefix}]: LLM 未返回有效 JSON`);
      return [];
    }

    let parsed: { elements?: unknown };
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      log(`[DiagramHelper] generateSection[${idPrefix}]: JSON 解析失败`);
      return [];
    }

    if (!Array.isArray(parsed.elements) || parsed.elements.length === 0) {
      log(`[DiagramHelper] generateSection[${idPrefix}]: 无 elements`);
      return [];
    }

    // 基本校验：必须是对象数组，有 type 字段
    const elements: ElementDef[] = [];
    for (const raw of parsed.elements) {
      const el = raw as Record<string, unknown>;
      if (el && typeof el === 'object' && typeof el.type === 'string') {
        elements.push(el as unknown as ElementDef);
      }
    }

    if (elements.length === 0) {
      log(`[DiagramHelper] generateSection[${idPrefix}]: 无有效元素`);
      return [];
    }

    log(`[DiagramHelper] generateSection[${idPrefix}]: 生成 ${elements.length} 元素`);
    return elements;
  } catch (err) {
    log(`[DiagramHelper] generateSection[${idPrefix}] 异常:`, err instanceof Error ? err.message : String(err));
    return [];
  }
}

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

// ==================== B3: 渐进生成主循环 ====================

/** 单节失败时的最大重试次数 */
const SECTION_MAX_RETRIES = 1;

/** generateDiagramProgressive 的回调 */
export interface ProgressiveCallbacks {
  /** 每节完成时触发：传入当前 embed（.excalidraw 中间态）、节序号、总节数 */
  onSectionReady?: (embed: string, sectionIndex: number, totalSections: number) => void;
  /** 单节失败时触发（重试耗尽后） */
  onSectionFailed?: (sectionIndex: number, reason: string) => void;
}

/**
 * 渐进式分节生成图表。
 *
 * @deprecated 已回退未接入。实测首图比单次更慢（plan+section 串行 invoke）、布局乱（分节盲画）、
 * 闪烁（embed 全量重渲染）、字体竞争。visualizer 已改回单次 generateDiagram。
 * 代码 + 测试保留，待未来找到"局部 DOM 更新不闪烁"方案后可重启。
 * 见 docs/specs/progressive-diagram-generation.md。
 *
 * 流程：
 * 1. planDiagramSections 规划分节大纲；失败 → fallback 到单次 generateDiagram
 * 2. 逐节 generateSection，累积元素到内存数组
 * 3. 每节完成：writeExcalidrawJson 落盘 .excalidraw + 触发 onSectionReady（前端渐进渲染）
 * 4. 全部完成：buildExcalidrawJSON + buildExcalidrawMd 转 .excalidraw.md + 删中间文件
 *
 * 健壮性：
 * - 单节失败重试 SECTION_MAX_RETRIES 次，仍失败则跳过（onSectionFailed）
 * - 每节检查 abortSignal
 * - 全部节都失败 → 返回 ''（调用方触发 onDiagramFailed）
 * - 大纲解析失败 → fallback 单次 generateDiagram
 *
 * @returns 最终 .excalidraw.md 的 embed；空串表示全失败
 */
export async function generateDiagramProgressive(
  query: string,
  analysisContent: string,
  model: BaseChatModel,
  toolContext: ToolContext,
  options: { pdfName?: string; signal?: AbortSignal },
  callbacks: ProgressiveCallbacks,
): Promise<string> {
  // 0. 截断 analysisContent 防止 LLM context 溢出（与 generateDiagram 保持一致）
  const safeContent = truncateAnalysisContent(analysisContent);

  // 1. 规划分节
  const plan = await planDiagramSections(query, safeContent, model, options);
  if (!plan) {
    log('[DiagramHelper] generateDiagramProgressive: 大纲解析失败，fallback 到单次生成');
    return generateDiagram(query, safeContent, model, toolContext, options);
  }

  const { filename, sections } = plan;
  const total = sections.length;
  const cumulative: ElementDef[] = [];
  let succeededSections = 0;

  // 2. 逐节生成
  for (let i = 0; i < sections.length; i++) {
    if (options.signal?.aborted) {
      log('[DiagramHelper] generateDiagramProgressive: abortSignal 已触发，停止后续节');
      break;
    }

    const sectionIndex = i + 1;
    const section = sections[i];
    const existingIds = cumulative.map(e => e.id);

    // 重试循环
    let sectionEls: ElementDef[] = [];
    let lastErr = '';
    for (let attempt = 0; attempt <= SECTION_MAX_RETRIES; attempt++) {
      if (options.signal?.aborted) break;
      sectionEls = await generateSection(section, sectionIndex, existingIds, model, options);
      if (sectionEls.length > 0) break;
      lastErr = `节 "${section.title}" 第 ${attempt + 1} 次生成无有效元素`;
      log(`[DiagramHelper] generateDiagramProgressive: ${lastErr}`);
    }

    if (sectionEls.length === 0) {
      // 重试耗尽，跳过该节
      callbacks.onSectionFailed?.(sectionIndex, lastErr || `节 "${section.title}" 生成失败`);
      continue;
    }

    // 3. 累积 + 落盘 .excalidraw 中间态
    cumulative.push(...sectionEls);
    succeededSections++;
    try {
      const filepath = await writeExcalidrawJson(filename, cumulative, toolContext);
      const embed = `![[${filepath}]]`;
      log(`[DiagramHelper] generateDiagramProgressive: 第 ${sectionIndex}/${total} 节完成，累积 ${cumulative.length} 元素`);
      callbacks.onSectionReady?.(embed, sectionIndex, total);
    } catch (err) {
      log('[DiagramHelper] generateDiagramProgressive: 落盘失败:', err instanceof Error ? err.message : String(err));
      callbacks.onSectionFailed?.(sectionIndex, `落盘失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 4. 全部节失败 → 返回空
  if (cumulative.length === 0 || succeededSections === 0) {
    log('[DiagramHelper] generateDiagramProgressive: 所有节均失败');
    return '';
  }

  // 5. 收尾：写入最终 .excalidraw（覆盖中间态）
  try {
    const excalidrawFile = buildExcalidrawJSON(cumulative, undefined, toolContext);

    const dir = 'Excalidraw';
    const adapter = toolContext.vault.app.vault.adapter;
    const filepath = `${dir}/${filename}.excalidraw`;
    await adapter.write(filepath, JSON.stringify(excalidrawFile, null, 2));

    log(`[DiagramHelper] generateDiagramProgressive: 收尾完成 ${filepath}（${cumulative.length} 元素，${succeededSections}/${total} 节）`);
    return `![[${filepath}]]`;
  } catch (err) {
    log('[DiagramHelper] generateDiagramProgressive: 收尾写入失败:', err instanceof Error ? err.message : String(err));
    // 写入失败但中间态可用，返回 .excalidraw embed
    return `![[Excalidraw/${filename}.excalidraw]]`;
  }
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
 *
 * 超时由调用方（visualizer 节点 + controller watchdog）保证，这里只透传 abortSignal。
 */
export async function generateDiagram(
  query: string,
  analysisContent: string,
  model: BaseChatModel,
  toolContext: ToolContext,
  options?: { pdfName?: string; signal?: AbortSignal },
): Promise<string> {
  let processedContent = analysisContent;
  processedContent = truncateAnalysisContent(processedContent);

  const userMessage = `用户问题：${query}

${options?.pdfName ? `书籍：${options.pdfName}\n` : ''}
分析内容：
${processedContent}

请根据以上内容生成 Excalidraw 图形。输出严格的 JSON 格式。`;

  try {
    const response = await model.invoke(
      [new SystemMessage(DIAGRAM_SYSTEM_PROMPT), new HumanMessage(userMessage)],
      options?.signal ? { signal: options.signal } : undefined,
    );

    const text = typeof response.content === 'string' ? response.content : '';

    // 提取 JSON（可能被 ```json 包裹）
    const jsonText = extractJsonObject(text);
    if (!jsonText) {
      log('[DiagramHelper] LLM 未返回有效 JSON，原始响应:', text.slice(0, 800));
      return '';
    }

    let parsed: { filename?: string; layout?: string; elements?: unknown[] };
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      log('[DiagramHelper] JSON 解析失败，提取到的文本:', jsonText.slice(0, 800));
      return '';
    }

    if (!parsed.filename || !Array.isArray(parsed.elements) || parsed.elements.length === 0) {
      log('[DiagramHelper] 缺少 filename 或 elements，parsed keys:', Object.keys(parsed).join(','));
      return '';
    }

    // filename 清洗（LLM 可能带书名号等非法字符）
    const baseFilename = sanitizeFilename(parsed.filename);
    if (!baseFilename) {
      log(`[DiagramHelper] filename 清洗后仍非法 "${parsed.filename}"`);
      return '';
    }
    // 追加唯一后缀（HHMMSS）：一次对话可能多次绘图（S1/S2/S3 各画一张），
    // 不加后缀会导致同名文件互相覆盖/并发写入冲突。
    const filename = `${baseFilename}-${uniqueSuffix()}`;

    const result = await excalidrawTool.execute(
      { filename, elements: parsed.elements, layout: parsed.layout as DiagramLayoutType | undefined },
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
      // warnings 是 agent 内部信号（用于 LLM 自验证/日志），不暴露给用户
      return parsedResult.embed;
    }

    return '';
  } catch (error) {
    log('[DiagramHelper] 生成失败:', error instanceof Error ? error.message : String(error));
    return '';
  }
}
