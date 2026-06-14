/**
 * Excalidraw 工具执行器
 *
 * 接收 LLM 生成的元素 JSON，构建 .excalidraw 文件并通过 Vault API 写入。
 * 包含碰撞检测和语义验证，返回警告供 LLM 修正。
 */

import { log } from '../../utils/logger.js';
import { calculateViewport, edgeIntersection, resolveOverlaps } from './excalidraw-geometry.js';
import type { ToolExecutor, ToolContext } from './types.js';

/** LLM 输入的元素定义（简化版，工具负责补齐完整字段） */
interface ElementDef {
  id: string;
  type: 'rectangle' | 'ellipse' | 'diamond' | 'arrow' | 'line' | 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: 'solid' | 'hachure' | 'cross-hatch';
  strokeWidth?: number;
  roughness?: number;
  opacity?: number;
  fontSize?: number;
  textAlign?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  points?: [number, number][];
  startBinding?: { elementId: string; gap: number; focus: number };
  endBinding?: { elementId: string; gap: number; focus: number };
  startArrowHead?: string | null;
  endArrowHead?: string | null;
  containerId?: string;
  boundElements?: Array<{ id: string; type: 'text' | 'arrow' }>;
  groupIds?: string[];
}

/** 完整的 .excalidraw JSON 结构 */
interface ExcalidrawFile {
  type: 'excalidraw';
  version: number;
  source: string;
  elements: ExcalidrawElement[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

/** Excalidraw 完整元素结构 */
interface ExcalidrawElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: string;
  strokeWidth: number;
  strokeStyle: string;
  roughness: number;
  opacity: number;
  groupIds: string[];
  frameId: string | null;
  roundness: null | { type: number };
  seed: number;
  version: number;
  versionNonce: number;
  isDeleted: boolean;
  boundElements: Array<{ id: string; type: string }> | null;
  updated: number;
  link: string | null;
  locked: boolean;
  // text specific
  text?: string;
  originalText?: string;
  fontSize?: number;
  fontFamily?: number;
  textAlign?: string;
  verticalAlign?: string;
  lineHeight?: number;
  containerId?: string | null;
  // arrow specific
  points?: [number, number][];
  startBinding?: { elementId: string; gap: number; focus: number } | null;
  endBinding?: { elementId: string; gap: number; focus: number } | null;
  startArrowhead?: string | null;
  endArrowhead?: string | null;
  lastCommittedPoint?: null;
}

/**
 * Detect overlaps involving free-floating text elements.
 */
function detectTextOverlaps(elements: ElementDef[]): string[] {
  const freeTexts = elements.filter(e =>
    e.type === 'text' && !e.containerId
  );
  if (freeTexts.length > 100) return ['自由文本元素超过 100 个，跳过碰撞检测'];

  const shapes = elements.filter(e =>
    ['rectangle', 'ellipse', 'diamond'].includes(e.type)
  );
  const warnings: string[] = [];

  // text vs shape
  for (const text of freeTexts) {
    for (const shape of shapes) {
      const xOv = Math.max(0, Math.min(text.x + text.width, shape.x + shape.width) - Math.max(text.x, shape.x));
      const yOv = Math.max(0, Math.min(text.y + text.height, shape.y + shape.height) - Math.max(text.y, shape.y));
      const area = xOv * yOv;
      if (area > 1000) {
        warnings.push(`自由文本 "${text.id}" 和 "${shape.id}" 重叠 ${Math.round(area)}px²`);
      }
    }
  }

  // text vs text
  for (let i = 0; i < freeTexts.length; i++) {
    for (let j = i + 1; j < freeTexts.length; j++) {
      const a = freeTexts[i];
      const b = freeTexts[j];
      const xOv = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
      const yOv = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
      if (xOv * yOv > 100) {
        warnings.push(`文本 "${a.id}" 和 "${b.id}" 重叠`);
      }
    }
  }

  return warnings;
}

function nextSeed(): number {
  return (Math.random() * 2147483647) | 0;
}

function now(): number {
  return Date.now();
}

/**
 * 容器内文字 padding（Excalidraw 默认容器文字留白）。
 * text 子元素的 width/height 已在 buildExcalidrawJSON 里减去 20px（每边 10），
 * 这里再留少量内边距，避免文字顶到容器边缘。
 */
const CONTAINER_TEXT_PADDING = 6;

/**
 * 估算中文字符显示宽度系数（相对 fontSize）。
 * Excalidraw fontFamily 5 中文约等于 1.0 × fontSize 每字，
 * 英文/数字约 0.6 × fontSize。这里用 1.0 偏保守，保证不溢出。
 */
const CHAR_WIDTH_RATIO = 1.0;

/**
 * 根据容器尺寸 + 文本内容，主动计算能撑满容器又不溢出的最大字号。
 *
 * 旧逻辑：fontSize = Math.min(LLM给的值 || 16, 容器档位上限)
 *   问题：LLM 倾向给保守的 16，长文本被压到 16 显得字小框空。
 *
 * 新逻辑：遍历可能的每行字数，找到"横向不溢出 + 纵向不溢出"的最大字号。
 * 自动换行让长文本也能用上更大字号。
 *
 * @returns { fontSize, wrappedText } — 最优字号 + 换行后的文本
 */
function computeOptimalFontSize(
  text: string,
  containerWidth: number,
  containerHeight: number,
): { fontSize: number; wrappedText: string } {
  const availW = Math.max(20, containerWidth - CONTAINER_TEXT_PADDING * 2);
  const availH = Math.max(20, containerHeight - CONTAINER_TEXT_PADDING * 2);

  // 用户已经手动换行 → 尊重原有断行，按最长行算
  const userLines = text.split('\n');
  const hasManualWrap = userLines.length > 1;

  if (hasManualWrap) {
    const maxChars = Math.max(...userLines.map(l => effectiveCharCount(l)));
    const lineCount = userLines.length;
    const byWidth = availW / (maxChars * CHAR_WIDTH_RATIO);
    const byHeight = availH / (lineCount * 1.25);
    const fontSize = clampFontSize(Math.min(byWidth, byHeight));
    return { fontSize, wrappedText: text };
  }

  // 无手动换行 → 尝试不同每行字数，找最大字号
  const totalChars = effectiveCharCount(text);
  let best = { fontSize: MIN_FONT_SIZE, wrappedText: text };

  // 每行字数从 1 到 totalChars 遍历；字数越多行数越少但横向越紧
  for (let charsPerLine = totalChars; charsPerLine >= 1; charsPerLine--) {
    const lineCount = Math.ceil(totalChars / charsPerLine);
    const byWidth = availW / (charsPerLine * CHAR_WIDTH_RATIO);
    const byHeight = availH / (lineCount * 1.25);
    const fontSize = clampFontSize(Math.min(byWidth, byHeight));
    if (fontSize > best.fontSize) {
      best = { fontSize, wrappedText: wrapText(text, charsPerLine) };
    }
  }
  return best;
}

/**
 * 字号四档（S/M/L/XL）：图表文字只从这四档里选，离散可控，视觉统一。
 * 取值参考书卷审美——大号为主、疏朗大气（每档差距递增）。
 * 由 computeOptimalFontSize 算出"不溢出容器的最大理想字号"后，向下取到最近的档位。
 */
const FONT_SIZE_TIERS: readonly number[] = [16, 20, 28, 36]; // S, M, L, XL
const MIN_FONT_SIZE = FONT_SIZE_TIERS[0];  // 16 (S)

/**
 * 把理想字号钳制到四档之一：取不超过 fs 的最大档位（向下取档，保证不溢出容器）。
 * fs 小于最小档 S 时用 S 兜底（宁可略挤也不用更小字号，保持可读性）。
 */
function clampFontSize(fs: number): number {
  // 从大到小找第一个 ≤ fs 的档位
  for (let i = FONT_SIZE_TIERS.length - 1; i >= 0; i--) {
    if (fs >= FONT_SIZE_TIERS[i]) return FONT_SIZE_TIERS[i];
  }
  return MIN_FONT_SIZE; // fs < 16，用 S 兜底
}

/**
 * 估算文本"等效字数"——中文按 1 计，英文/数字/标点按 0.6 计。
 * 用于换行计算（中文一个字占的宽度比英文字母大）。
 */
function effectiveCharCount(text: string): number {
  let count = 0;
  for (const ch of text) {
    count += /[一-鿿　-〿＀-￯]/.test(ch) ? 1 : 0.6;
  }
  return Math.max(1, count);
}

/**
 * 按指定字数把文本断行（中文按字符，尽量均匀）。
 */
function wrapText(text: string, charsPerLine: number): string {
  if (charsPerLine >= text.length) return text;
  const lines: string[] = [];
  for (let i = 0; i < text.length; i += charsPerLine) {
    lines.push(text.slice(i, i + charsPerLine));
  }
  return lines.join('\n');
}

function toExcalidrawElement(el: ElementDef): ExcalidrawElement {
  const isText = el.type === 'text';
  const isArrow = el.type === 'arrow';
  const isLine = el.type === 'line';
  const base: ExcalidrawElement = {
    id: el.id,
    type: el.type,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    angle: 0,
    strokeColor: el.strokeColor ?? '#1e293b',
    backgroundColor: el.backgroundColor ?? 'transparent',
    fillStyle: el.fillStyle ?? 'solid',
    strokeWidth: el.strokeWidth ?? (isLine || isArrow ? 1 : 2),
    strokeStyle: 'solid',
    roughness: el.roughness ?? 0,
    opacity: el.opacity ?? 100,
    groupIds: el.groupIds ?? [],
    frameId: null,
    roundness: ['rectangle', 'ellipse', 'diamond'].includes(el.type) ? { type: 3 } : null,
    seed: nextSeed(),
    version: 1,
    versionNonce: now(),
    isDeleted: false,
    boundElements: el.boundElements?.length ? el.boundElements : null,
    updated: now(),
    link: null,
    locked: false,
  };

  if (isText) {
    base.text = el.text ?? '';
    base.originalText = el.text ?? '';
    // 所有 text 字号统一钳到四档（S16/M20/L28/XL36），保证视觉统一离散可控。
    // LLM 给的 fontSize 仅作参考（取不小于它的... 实际取不超过它的最大档，避免溢出容器）。
    base.fontSize = clampFontSize(el.fontSize ?? 16);
    base.fontFamily = 5;
    base.textAlign = el.textAlign ?? 'center';
    base.verticalAlign = el.verticalAlign ?? 'middle';
    base.containerId = el.containerId ?? null;
    base.lineHeight = 1.25;
    // 文本元素需要有高度计算
    if (!el.height || el.height === 0) {
      const lines = (el.text ?? '').split('\n').length;
      base.height = Math.max(25, lines * (base.fontSize * 1.25));
    }
  }

  if (isArrow || isLine) {
    base.startBinding = el.startBinding ?? null;
    base.endBinding = el.endBinding ?? null;
    base.startArrowhead = isArrow ? (el.startArrowHead ?? null) : undefined;
    base.endArrowhead = isArrow ? (el.endArrowHead ?? 'arrow') : undefined;
    base.lastCommittedPoint = null;
    base.width = 0;
    base.height = 0;

    // Auto-calculate points when missing but bindings exist
    if (el.points && el.points.length >= 2) {
      base.points = el.points;
    } else if (el.startBinding || el.endBinding) {
      base.points = [[0, 0], [1, 0]];
    } else {
      base.points = el.points ?? [[0, 0]];
    }
  }

  return base;
}

function buildExcalidrawJSON(elements: ElementDef[]): ExcalidrawFile {
  // Deterministic collision resolution before building
  const resolved = resolveOverlaps(elements);

  // Build element lookup for auto-calculating arrow positions
  const elMap = new Map<string, ElementDef>();
  for (const el of resolved) {
    elMap.set(el.id, el);
  }

  // 去重说明：LLM 有时对同一节点既给 shape.text 又给独立 text 元素（containerId 指向 shape）。
  // 这种独立 text 在主循环里通过 isRedundantBoundText 判断跳过，由 shape.text 自动创建接管，
  // 统一字号优化，避免两个 text 重叠。

  const result: ExcalidrawElement[] = [];

  for (const el of resolved) {
    const isContainer = ['rectangle', 'ellipse', 'diamond'].includes(el.type);
    const isText = el.type === 'text';
    // shape 有 text 属性 → 自动创建绑定 text（即使 LLM 同时给了独立 text，也以 shape.text 为准）
    const needsAutoText = isContainer && el.text && !isText;
    const isArrowOrLine = el.type === 'arrow' || el.type === 'line';
    // 独立 text 元素：若它绑定到的容器自己有 text 属性，则跳过（已被自动创建接管）
    const isRedundantBoundText =
      isText && !!el.containerId && !!elMap.get(el.containerId!)?.text;

    // 冗余 text：LLM 给的独立 text 指向"自身有 text 属性的容器"，
    // 由 shape.text 自动创建接管，跳过避免重复。
    if (isRedundantBoundText) continue;

    if (needsAutoText) {
      // 形状有 text → 自动创建绑定的 text 子元素
      const textId = `${el.id}_text`;
      const shapeEl = toExcalidrawElement(el);
      // shape 不放 text 属性，但加 boundElements 指向 text
      shapeEl.boundElements = [{ id: textId, type: 'text' }];
      result.push(shapeEl);

      // 主动计算最优字号 + 自动换行：撑满容器又不溢出
      // 替代旧的 Math.min(LLM值, 档位上限) —— 那会让长文本被压到 16
      const { fontSize: optimalFontSize, wrappedText } = computeOptimalFontSize(
        el.text!,
        el.width,
        el.height,
      );
      const textEl = toExcalidrawElement({
        ...el,
        id: textId,
        type: 'text',
        text: wrappedText,
        x: el.x + 10,
        y: el.y + 10,
        width: Math.max(20, el.width - 20),
        height: Math.max(20, el.height - 20),
        containerId: el.id,
        strokeColor: el.strokeColor || '#1e293b',
        fontSize: optimalFontSize,
      });
      textEl.containerId = el.id;
      result.push(textEl);
    } else if (isArrowOrLine && (el.startBinding || el.endBinding)) {
      // Auto-calculate arrow position and points from bindings
      const arrowEl = toExcalidrawElement(el);

      const startEl = el.startBinding ? elMap.get(el.startBinding.elementId) : null;
      const endEl = el.endBinding ? elMap.get(el.endBinding.elementId) : null;

      if (startEl && endEl) {
        const gap = 2;
        const startCx = startEl.x + startEl.width / 2;
        const startCy = startEl.y + startEl.height / 2;
        const endCx = endEl.x + endEl.width / 2;
        const endCy = endEl.y + endEl.height / 2;

        const [sx, sy] = edgeIntersection(startEl, endCx, endCy, gap);
        const [ex, ey] = edgeIntersection(endEl, startCx, startCy, gap);

        arrowEl.x = sx;
        arrowEl.y = sy;
        arrowEl.points = [[0, 0], [ex - sx, ey - sy]];
      } else if (startEl) {
        const gap = 2;
        const cx = startEl.x + startEl.width / 2;
        const cy = startEl.y + startEl.height / 2;
        const targetCy = cy - startEl.height / 2 - gap;
        const [sx, sy] = edgeIntersection(startEl, cx, targetCy, gap);
        arrowEl.x = sx;
        arrowEl.y = sy;
        // 只有起点绑定时给一段默认向上延伸的箭头，避免残留 [0,0]→[1,0] 的微小箭头
        arrowEl.points = [[0, 0], [0, -80]];
      }

      result.push(arrowEl);
    } else {
      result.push(toExcalidrawElement(el));
    }
  }

  // Z-index: shapes → arrows/lines → text (later = on top)
  const Z_ORDER: Record<string, number> = {
    rectangle: 0, ellipse: 0, diamond: 0,
    line: 1, arrow: 1,
    text: 2,
  };
  result.sort((a, b) => (Z_ORDER[a.type] ?? 0) - (Z_ORDER[b.type] ?? 0));

  const viewport = calculateViewport(result);

  return {
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements: result,
    appState: {
      viewBackgroundColor: '#ffffff',
      gridSize: 20,
      scrollX: viewport.scrollX,
      scrollY: viewport.scrollY,
      zoom: viewport.zoom,
    },
    files: {},
  };
}

function detectOverlaps(elements: ElementDef[]): string[] {
  const shapes = elements.filter(e =>
    ['rectangle', 'ellipse', 'diamond'].includes(e.type)
  );
  if (shapes.length > 100) {
    return ['形状元素超过 100 个，跳过碰撞检测'];
  }
  const warnings: string[] = [];

  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i];
      const b = shapes[j];
      const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
      const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
      const overlapArea = xOverlap * yOverlap;
      if (overlapArea > 100) {
        warnings.push(
          `"${a.id}" 和 "${b.id}" 重叠 ${Math.round(overlapArea)}px²` +
          ` (x重叠${Math.round(xOverlap)}px, y重叠${Math.round(yOverlap)}px)`
        );
      }
    }
  }
  return warnings;
}

function validateSemantics(elements: ElementDef[]): string[] {
  const warnings: string[] = [];
  const idSet = new Set(elements.map(e => e.id));

  let containerTextCount = 0;
  let totalTextCount = 0;

  for (const el of elements) {
    if (el.type === 'text') {
      totalTextCount++;
      if (el.containerId) containerTextCount++;

      if (!el.strokeColor && !el.containerId) {
        warnings.push(`文本 "${el.id}" 缺少 strokeColor，可能不可见`);
      }
    }

    if (el.containerId && !idSet.has(el.containerId)) {
      warnings.push(`"${el.id}" 的 containerId "${el.containerId}" 不存在`);
    }

    if (el.containerId) {
      const target = elements.find(e => e.id === el.containerId);
      if (target && !target.boundElements?.some(b => b.id === el.id)) {
        warnings.push(
          `容器 "${target.id}" 的 boundElements 中缺少文本 "${el.id}"` +
          ` — 双向绑定需要双方都引用`
        );
      }
    }

    if (el.type === 'arrow') {
      if (el.startBinding && !idSet.has(el.startBinding.elementId)) {
        warnings.push(`箭头 "${el.id}" 的 startBinding 目标 "${el.startBinding.elementId}" 不存在`);
      }
      if (el.endBinding && !idSet.has(el.endBinding.elementId)) {
        warnings.push(`箭头 "${el.id}" 的 endBinding 目标 "${el.endBinding.elementId}" 不存在`);
      }
    }
  }

  if (totalTextCount > 0 && containerTextCount / totalTextCount > 0.3) {
    warnings.push(
      `容器内文本比例 ${(containerTextCount / totalTextCount * 100).toFixed(0)}% 超过 30%` +
      ` — 建议减少容器使用，多用自由文本`
    );
  }

  return warnings;
}

export const excalidrawTool: ToolExecutor = {
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const { filename, elements } = args as {
      filename: string;
      elements: ElementDef[];
    };

    if (!filename || !elements || !Array.isArray(elements) || elements.length === 0) {
      return '错误: 缺少 filename 或 elements 参数';
    }

    if (!/^[\w一-鿿\-][\w一-鿿\- ]{0,100}$/.test(filename)) {
      return '错误: filename 只能包含中文、字母、数字、空格、连字符和下划线，长度不超过100';
    }

    if (elements.length > 200) {
      return '错误: 元素数量超过 200 上限，请减少元素或分批生成';
    }

    const validTypes = new Set(['rectangle', 'ellipse', 'diamond', 'arrow', 'line', 'text']);
    const invalidEl = elements.find(e => !validTypes.has(e.type));
    if (invalidEl) {
      return `错误: 不支持的元素类型 "${invalidEl.type}"，允许的类型: rectangle, ellipse, diamond, arrow, line, text`;
    }

    try {
      // 碰撞检测 + 语义验证
      const warnings = detectOverlaps(elements);
      const textWarnings = detectTextOverlaps(elements);
      const semanticWarnings = validateSemantics(elements);

      // 构建 .excalidraw JSON
      const excalidrawFile = buildExcalidrawJSON(elements);

      // 确保 Excalidraw 目录存在，写入文件
      const dir = 'Excalidraw';
      const adapter = context.vault.app.vault.adapter;
      if (!(await adapter.exists(dir))) {
        await adapter.mkdir(dir);
      }

      // 写纯 JSON 到 .excalidraw（Excalidraw 插件 registerExtensions(["excalidraw"]) 原生支持）
      // 关键：Obsidian embed（![[...]]）只对 .excalidraw 后缀触发插件的图渲染；
      // .excalidraw.md 会被当普通 markdown 嵌入显示原始文本。故必须用 .excalidraw。
      // 点开 .excalidraw 文件插件自动用 Excalidraw 编辑视图打开。
      const filepath = `${dir}/${filename}.excalidraw`;
      await adapter.write(filepath, JSON.stringify(excalidrawFile, null, 2));

      log('info', `Excalidraw 图形已生成: ${filepath}`);

      const allWarnings = [...warnings, ...textWarnings, ...semanticWarnings];
      if (allWarnings.length > 0) {
        return JSON.stringify({
          success: true,
          filepath,
          embed: `![[${filepath}]]`,
          warnings: allWarnings,
          suggestion: '请根据 warnings 调整坐标/尺寸/绑定后重新调用',
        });
      }

      return JSON.stringify({ success: true, filepath, embed: `![[${filepath}]]` });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log('error', `生成 Excalidraw 图形失败: ${errorMessage}`);
      return `生成图形失败: ${errorMessage}`;
    }
  },
};

// 导出内部函数供测试使用
/**
 * 写纯 JSON 到 `Excalidraw/<filename>.excalidraw`（不带 .md 后缀）。
 *
 * 用于渐进式分节生成的中间态落盘：
 * - 每节完成时调用，累积元素写入纯 JSON（便于增量、可调试）
 * - 全部完成后由 generateDiagramProgressive 转换为 .excalidraw.md 并删除此中间文件
 *
 * 与 excalidrawTool.execute 的区别：
 * - execute 写 .excalidraw.md（插件格式，含压缩）→ 最终产物
 * - writeExcalidrawJson 写 .excalidraw（纯 JSON）→ 渐进中间态
 *
 * 元素同样经 buildExcalidrawJSON 处理（字号优化/去重/碰撞检测），保证中间态视觉质量。
 *
 * @returns 文件路径（如 "Excalidraw/xxx.excalidraw"），失败抛异常
 */
export async function writeExcalidrawJson(
  filename: string,
  elements: ElementDef[],
  context: ToolContext,
): Promise<string> {
  if (!filename || !elements || !Array.isArray(elements) || elements.length === 0) {
    throw new Error('writeExcalidrawJson: filename 或 elements 为空');
  }

  if (!/^[\w一-鿿\-][\w一-鿿\- ]{0,100}$/.test(filename)) {
    throw new Error(`writeExcalidrawJson: filename 非法 "${filename}"`);
  }

  const excalidrawFile = buildExcalidrawJSON(elements);

  const dir = 'Excalidraw';
  const adapter = context.vault.app.vault.adapter;
  if (!(await adapter.exists(dir))) {
    await adapter.mkdir(dir);
  }

  const filepath = `${dir}/${filename}.excalidraw`;
  await adapter.write(filepath, JSON.stringify(excalidrawFile, null, 2));

  log('info', `Excalidraw JSON 中间态已写入: ${filepath}（${elements.length} 元素）`);
  return filepath;
}

// 导出内部函数供测试使用
export { buildExcalidrawJSON, detectOverlaps, detectTextOverlaps, validateSemantics, computeOptimalFontSize };
export { calculateViewport, edgeIntersection, resolveOverlaps } from './excalidraw-geometry.js';
export type { ElementDef };
