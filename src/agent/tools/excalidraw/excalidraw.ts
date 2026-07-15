/**
 * Excalidraw 工具执行器
 *
 * 接收 LLM 生成的元素 JSON，构建 .excalidraw 文件并通过 Vault API 写入。
 * 包含碰撞检测和语义验证，返回警告供 LLM 修正。
 */

import { log } from '../../../utils/logger.js';
import { calculateViewport, edgeIntersection } from './excalidraw-geometry.js';
import type { ToolExecutor, ToolContext } from '../types.js';
import { type ElementDef, type DiagramLayoutType, FREE_TEXT_BG_SUFFIX } from './excalidraw-types.js';

import { arrangeWithFallback } from './excalidraw-layout.js';
import { applyDiagramStyle } from './excalidraw-style-processor.js';
import { PALETTE, TEXT_COLORS } from './excalidraw-organic-palette.js';
import { buildExcalidrawMd } from './excalidraw-md.js';
import { processIcons, type ProcessedIcon } from './excalidraw-icon-processor.js';

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
  // freedraw/organic specific
  pressures?: number[];
  simulatePressure?: boolean;
  customData?: Record<string, any> | null;
  // image specific
  fileId?: string;
  scale?: [number, number];
  status?: string;
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
 * 解析当前 Obsidian 主题（'light' | 'dark'）。
 *
 * 优先读 vault.getConfig('theme')，再读 body 的 CSS class 作为兜底；
 * 两者都拿不到时返回 'light'（安全默认）。
 */
function resolveObsidianTheme(context?: ToolContext): 'light' | 'dark' {
  const app = context?.vault?.app ?? (typeof window !== 'undefined' ? (window as any).app : undefined);
  if (app?.vault) {
    try {
      const vaultTheme = (app.vault as any).getConfig?.('theme');
      if (vaultTheme === 'dark' || vaultTheme === 'light') {
        return vaultTheme;
      }
    } catch {
      // Ignore config reading errors
    }
  }
  if (typeof document !== 'undefined' && document.body) {
    if (document.body.classList.contains('theme-dark')) return 'dark';
    if (document.body.classList.contains('theme-light')) return 'light';
  }
  return 'light';
}

/**
 * 计算 ExcalidrawElement 的渲染层级：
 * -1 = 有机连线（freedraw + isOrganicConnector 标记），最底层，避免覆盖文字
 *  0 = 形状（rectangle/ellipse/diamond）
 *  1 = 普通连线/箭头/手绘（line/arrow/非 organic 的 freedraw）
 *  2 = 文本（最顶层）
 */
function getZOrder(el: ExcalidrawElement): number {
  if (el.type === 'rectangle' || el.type === 'ellipse' || el.type === 'diamond') return 0;
  if (el.type === 'line' || el.type === 'arrow' || el.type === 'freedraw' || el.type === 'image') return 1;
  if (el.type === 'text') return 2;
  return 0;
}

/**
 * 容器内文字 padding（Excalidraw 默认容器文字留白）。
 * text 子元素的 width/height 已在 buildExcalidrawJSON 里减去 20px（每边 10），
 * 这里再留少量内边距，避免文字顶到容器边缘。
 */
const CONTAINER_TEXT_PADDING = 6;

/**
 * 默认箭头与绑定形状边缘的间隙 (px)
 */
const DEFAULT_ARROW_GAP = 8;

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

  // 遍历四种字号从大到小测试，哪档装得下就用哪档
  for (const fs of [36, 28, 20, 16]) {
    const charsPerLine = Math.floor(availW / (fs * CHAR_WIDTH_RATIO));
    if (charsPerLine < 1) continue; // 单行一个字都放不下，跳过该档位
    const lineCount = Math.ceil(totalChars / charsPerLine);
    if (lineCount * fs * 1.25 <= availH) {
      return { fontSize: fs, wrappedText: wrapText(text, charsPerLine) };
    }
  }

  // 均装不下 → 兜底用最小字号 S(16)，系统后续 preprocess 阶段会自动拉高容器
  const charsPerLine = Math.max(1, Math.floor(availW / (16 * CHAR_WIDTH_RATIO)));
  return { fontSize: 16, wrappedText: wrapText(text, charsPerLine) };
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

/**
 * 判断容器的语义颜色是否属于深色/高饱和度填充类型（需要白色文字以保证对比度）。
 */
function toExcalidrawElement(el: ElementDef, theme: 'light' | 'dark', elMap?: Map<string, ElementDef>): ExcalidrawElement {
  const isText = el.type === 'text';
  const isArrow = el.type === 'arrow';
  const isLine = el.type === 'line';
  const isFreedraw = el.type === 'freedraw';

  // Resolve stroke color with theme/semantic mapping
  let strokeColor = el.strokeColor;
  if (!strokeColor) {
    if (isText) {
      if (el.containerId && elMap) {
        const container = elMap.get(el.containerId);
        const containerSemantic = container?.semanticColor;
        if (containerSemantic && PALETTE[theme][containerSemantic]) {
          strokeColor = PALETTE[theme][containerSemantic].textColor;
        } else {
          strokeColor = TEXT_COLORS[theme];
        }
      } else if (el.semanticColor && PALETTE[theme][el.semanticColor]) {
        strokeColor = PALETTE[theme][el.semanticColor].textColor;
      } else {
        strokeColor = TEXT_COLORS[theme];
      }
    } else if (el.semanticColor && PALETTE[theme][el.semanticColor]) {
      strokeColor = PALETTE[theme][el.semanticColor].stroke;
    } else {
      strokeColor = TEXT_COLORS[theme];
    }
  }

  // Resolve background color with theme/semantic mapping
  let backgroundColor = el.backgroundColor;
  if (!backgroundColor) {
    if (el.semanticColor) {
      backgroundColor = PALETTE[theme][el.semanticColor].fill;
    } else {
      backgroundColor = 'transparent';
    }
  }

  const base: ExcalidrawElement = {
    id: el.id,
    type: el.type,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    angle: 0,
    strokeColor,
    backgroundColor,
    fillStyle: el.fillStyle ?? 'solid',
    strokeWidth: el.strokeWidth ?? (isLine || isArrow ? 2 : 2),
    strokeStyle: el.strokeStyle ?? 'solid',
    roughness: el.roughness ?? 1,
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
    customData: el.customData ?? null,
  };

  if (isText) {
    base.text = el.text ?? '';
    base.originalText = el.text ?? '';
    // 所有 text 字号统一钳到四档（S16/M20/L28/XL36），保证视觉统一离散可控。
    // LLM 给的 fontSize 仅作参考（取不小于它的... 实际取不超过它的最大档，避免溢出容器）。
    base.fontSize = clampFontSize(el.fontSize ?? 16);
    // fontFamily 5 = Excalidraw 内置中文友好字体，无需外部注册，渲染稳定。
    // 不选 4（Virgil/自定义字体位）是因为该 fontFamily 在当前 Excalidraw 插件里未注册，会报字体错误。
    base.fontFamily = 5;
    base.textAlign = el.textAlign ?? 'center';
    base.verticalAlign = el.verticalAlign ?? 'middle';
    base.containerId = el.containerId ?? null;
    base.lineHeight = 1.25;
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

    if (el.points && el.points.length >= 2) {
      base.points = el.points;
    } else if (el.startBinding || el.endBinding) {
      base.points = [[0, 0], [1, 0]];
    } else {
      base.points = el.points ?? [[0, 0]];
    }
  }

  if (isFreedraw) {
    base.points = el.points ?? [[0, 0]];
    base.pressures = el.customData?.pressures ?? [];
    base.simulatePressure = false;
    base.width = 0;
    base.height = 0;
    base.roundness = null;
    base.strokeWidth = el.strokeWidth ?? 2;
  }

  return base;
}

/**
 * 布局前置处理：根据文本行数与最优字号，校正容器的最小高度，
 * 保证在进行几何布局及防碰撞计算前，容器大小已完全适应文字，防止后续发生重叠。
 */
function preprocessElementSizes(elements: ElementDef[]): ElementDef[] {
  const result: ElementDef[] = [];

  for (const el of elements) {
    const isContainer = ['rectangle', 'ellipse', 'diamond'].includes(el.type);
    const isText = el.type === 'text';

    if (isContainer && el.text) {
      const { fontSize: optimalFontSize, wrappedText } = computeOptimalFontSize(
        el.text,
        el.width,
        el.height,
      );

      const lines = wrappedText.split('\n').length;
      const requiredHeight = lines * (optimalFontSize * 1.25) + CONTAINER_TEXT_PADDING * 2 + 10;

      let nextHeight = el.height;
      if (requiredHeight > el.height) {
        nextHeight = requiredHeight;
      }

      result.push({
        ...el,
        height: nextHeight,
        customData: {
          ...el.customData,
          preprocessedFontSize: optimalFontSize,
          preprocessedText: wrappedText,
        }
      });
    } else if (isText && !el.containerId) {
      // 自由文本：前置生成背景卡片，这样布局引擎能看到卡片的大小，避免重叠
      const bgId = `${el.id}${FREE_TEXT_BG_SUFFIX}`;
      const paddingX = 12;
      const paddingY = 8;

      const bg: ElementDef = {
        id: bgId,
        type: 'rectangle',
        x: el.x - paddingX,
        y: el.y - paddingY,
        width: el.width + paddingX * 2,
        height: el.height + paddingY * 2,
        semanticColor: el.semanticColor,
        boundElements: [{ id: el.id, type: 'text' }],
      };

      const boundText: ElementDef = {
        ...el,
        containerId: bgId,
      };

      result.push(bg);
      result.push(boundText);
    } else {
      result.push({ ...el });
    }
  }
  return result;
}

/**
 * 注入 MindMapBuilder 兼容的 customData 标记：
 * - 分支箭头：`{ isBranch: true }`
 * - 节点深度：`{ depth: N }`（BFS 从根节点计算）
 * - 根节点（无入边）：`{ isAdditionalRoot: true }`
 *
 * 在布局完成后、序列化前调用，不改变坐标。
 */
function injectCustomData(elements: ElementDef[]): ElementDef[] {
  // 收集所有节点 ID（排除 arrow/line/freedraw/text-with-container）
  const nodeIds = new Set<string>();
  for (const el of elements) {
    if (['rectangle', 'ellipse', 'diamond', 'text'].includes(el.type) && !el.containerId) {
      nodeIds.add(el.id);
    }
  }

  // 构建 parentMap（子→父）和 childrenMap（父→子）
  const parentMap = new Map<string, string>();
  const childrenMap = new Map<string, string[]>();
  for (const el of elements) {
    if (el.type === 'arrow' || el.type === 'line') {
      const start = el.startBinding?.elementId;
      const end = el.endBinding?.elementId;
      if (start && end && nodeIds.has(start) && nodeIds.has(end)) {
        if (!childrenMap.has(start)) childrenMap.set(start, []);
        childrenMap.get(start)!.push(end);
        if (!parentMap.has(end)) parentMap.set(end, start);
      }
    }
  }

  // BFS 计算每个节点的 depth
  const depthMap = new Map<string, number>();
  const roots = [...nodeIds].filter(id => !parentMap.has(id));
  const queue: Array<[string, number]> = roots.map(id => [id, 0]);
  while (queue.length > 0) {
    const [id, depth] = queue.shift()!;
    if (depthMap.has(id)) continue;
    depthMap.set(id, depth);
    for (const child of childrenMap.get(id) || []) {
      if (!depthMap.has(child)) queue.push([child, depth + 1]);
    }
  }

  // 注入 customData
  return elements.map(el => {
    // 分支箭头标记
    if (el.type === 'arrow' || el.type === 'line') {
      const start = el.startBinding?.elementId;
      const end = el.endBinding?.elementId;
      if (start && end && nodeIds.has(start) && nodeIds.has(end)) {
        return { ...el, customData: { ...el.customData, isBranch: true } };
      }
    }

    // 节点 depth + isAdditionalRoot
    if (nodeIds.has(el.id)) {
      const depth = depthMap.get(el.id) ?? 0;
      const isRoot = !parentMap.has(el.id);
      return {
        ...el,
        customData: {
          ...el.customData,
          depth,
          ...(isRoot ? { isAdditionalRoot: true } : {}),
        },
      };
    }

    return el;
  });
}

/**
 * 构建完整的 Excalidraw JSON 文件内容。
 * 
 * @param elements 输入的元素定义数组
 * @param layout 可选的布局模式
 * @param context 工具上下文，用于解析主题
 * @param isAlreadyResolved 若为 true，则跳过 preprocess 尺寸自适应和 layout 布局阶段，直接用于渲染输出。主要配合 execute 中的前置布局使用，避免二次计算。
 * @returns 最终符合 Excalidraw 插件规范的 ExcalidrawFile 结构
 */
function buildExcalidrawJSON(
  elements: ElementDef[],
  layout?: DiagramLayoutType,
  context?: ToolContext,
  isAlreadyResolved = false,
  icons: ProcessedIcon[] = [],
  growthMode?: string,
): ExcalidrawFile {
  // 0. Preprocess element sizes for text fitting BEFORE running the layout engine.
  const preprocessed = isAlreadyResolved ? elements : preprocessElementSizes(elements);

  // Deterministic semantic layout and collision resolution
  const layoutOptions = growthMode ? { growthMode } : undefined;
  const resolved = isAlreadyResolved ? preprocessed : arrangeWithFallback(preprocessed, layout, layoutOptions);

  // 0.5 Inject MindMapBuilder-compatible customData markers (isBranch, depth, isAdditionalRoot)
  const enriched = injectCustomData(resolved);

  // 1. Resolve Obsidian theme
  const theme = resolveObsidianTheme(context);

  // 2. Apply style processor
  const { elements: styledElements, viewBackgroundColor } = applyDiagramStyle({
    elements: enriched,
    layout,
    theme,
  });

  // Build element lookup for auto-calculating arrow positions
  const elMap = new Map<string, ElementDef>();
  for (const el of styledElements) {
    elMap.set(el.id, el);
  }

  // Icon lookup (by parent element id) + Excalidraw files map for embedded SVGs
  const iconMap = new Map<string, ProcessedIcon>();
  for (const ic of icons) iconMap.set(ic.elementId, ic);
  const files: Record<string, unknown> = {};

  // Pre-scan for all arrows/lines to build bidirectional shape references
  const shapeArrowRefs = new Map<string, Array<{ id: string; type: 'arrow' }>>();
  for (const el of styledElements) {
    if (el.type === 'arrow' || el.type === 'line') {
      if (el.startBinding?.elementId) {
        const sid = el.startBinding.elementId;
        if (!shapeArrowRefs.has(sid)) shapeArrowRefs.set(sid, []);
        shapeArrowRefs.get(sid)!.push({ id: el.id, type: 'arrow' });
      }
      if (el.endBinding?.elementId) {
        const eid = el.endBinding.elementId;
        if (!shapeArrowRefs.has(eid)) shapeArrowRefs.set(eid, []);
        shapeArrowRefs.get(eid)!.push({ id: el.id, type: 'arrow' });
      }
    }
  }

  const result: ExcalidrawElement[] = [];

  for (let el of styledElements) {
    // Normalize binding field names: LLM may emit {id} instead of {elementId}
    if (el.startBinding && !el.startBinding.elementId) {
      const b = el.startBinding as Record<string, unknown>;
      const eid = (b.id ?? b.targetId ?? b.element ?? b.target) as string | undefined;
      if (eid) el = { ...el, startBinding: { elementId: eid, gap: b.gap as number ?? DEFAULT_ARROW_GAP, focus: b.focus as number ?? 0 } };
    }
    if (el.endBinding && !el.endBinding.elementId) {
      const b = el.endBinding as Record<string, unknown>;
      const eid = (b.id ?? b.targetId ?? b.element ?? b.target) as string | undefined;
      if (eid) el = { ...el, endBinding: { elementId: eid, gap: b.gap as number ?? DEFAULT_ARROW_GAP, focus: b.focus as number ?? 0 } };
    }

    const isContainer = ['rectangle', 'ellipse', 'diamond'].includes(el.type);
    const isText = el.type === 'text';
    const needsAutoText = isContainer && el.text && !isText;
    const isArrowOrLine = el.type === 'arrow' || el.type === 'line';
    const isRedundantBoundText =
      isText && !!el.containerId && !!elMap.get(el.containerId!)?.text;

    if (isRedundantBoundText) continue;

    if (needsAutoText) {
      // 形状有 text → 自动创建绑定的 text 子元素
      const textId = `${el.id}_text`;
      const shapeEl = toExcalidrawElement(el, theme, elMap);
      
      const arrowRefs = shapeArrowRefs.get(el.id) ?? [];
      shapeEl.boundElements = [
        { id: textId, type: 'text' },
        ...arrowRefs
      ];
      result.push(shapeEl);

      const optimalFontSize = el.customData?.preprocessedFontSize ?? 16;
      const wrappedText = el.customData?.preprocessedText ?? el.text!;
      
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
        strokeColor: el.strokeColor,
        fontSize: optimalFontSize,
      }, theme, elMap);
      textEl.containerId = el.id;
      result.push(textEl);
    } else if (isArrowOrLine && (el.startBinding || el.endBinding)) {
      const arrowEl = toExcalidrawElement(el, theme, elMap);

      const startEl = el.startBinding ? elMap.get(el.startBinding.elementId) : null;
      const endEl = el.endBinding ? elMap.get(el.endBinding.elementId) : null;

      if (startEl && endEl) {
        const startGap = el.startBinding?.gap ?? DEFAULT_ARROW_GAP;
        const endGap = el.endBinding?.gap ?? DEFAULT_ARROW_GAP;
        const startCx = startEl.x + startEl.width / 2;
        const startCy = startEl.y + startEl.height / 2;
        const endCx = endEl.x + endEl.width / 2;
        const endCy = endEl.y + endEl.height / 2;

        const [sx, sy] = edgeIntersection(startEl, endCx, endCy, startGap);
        const [ex, ey] = edgeIntersection(endEl, startCx, startCy, endGap);

        arrowEl.x = sx;
        arrowEl.y = sy;
        const provided = el.points && el.points.length >= 2 ? el.points : [[0, 0], [1, 0]];
        arrowEl.points = provided.map((p, i) => {
          if (i === 0) return [0, 0];
          if (i === provided.length - 1) return [ex - sx, ey - sy];
          return p as [number, number];
        });
      } else if (startEl) {
        const startGap = el.startBinding?.gap ?? DEFAULT_ARROW_GAP;
        const cx = startEl.x + startEl.width / 2;
        const cy = startEl.y + startEl.height / 2;
        const targetCy = cy - startEl.height / 2 - startGap;
        const [sx, sy] = edgeIntersection(startEl, cx, targetCy, startGap);
        arrowEl.x = sx;
        arrowEl.y = sy;
        const provided = el.points && el.points.length >= 2 ? el.points : [[0, 0], [0, -80]];
        arrowEl.points = provided.map((p, i) => i === 0 ? [0, 0] : (p as [number, number]));
      }

      result.push(arrowEl);
    } else {
      const shapeEl = toExcalidrawElement(el, theme, elMap);
      const arrowRefs = shapeArrowRefs.get(el.id) ?? [];
      if (arrowRefs.length > 0) {
        shapeEl.boundElements = [
          ...(shapeEl.boundElements ?? []),
          ...arrowRefs
        ];
      }
      result.push(shapeEl);
    }

    // Append icon as an Excalidraw `image` element (embedded SVG), if present.
    // Icons are added AFTER layout, so they never affect layout/collision math.
    const icon = iconMap.get(el.id);
    if (icon) {
      const fileId = `icon-${el.id}`;
      const coloredSvg = icon.svg.replace(/currentColor/g, icon.color ?? '#1f2937');
      const dataUrl = `data:image/svg+xml;base64,${toBase64(coloredSvg)}`;
      files[fileId] = {
        mimeType: 'image/svg+xml',
        id: fileId,
        dataURL: dataUrl,
        created: now(),
        lastRetrieved: now(),
      };
      result.push(toIconImageElement(el.id, icon, fileId));
    }
  }

  result.sort((a, b) => getZOrder(a) - getZOrder(b));

  const viewport = calculateViewport(result);

  return {
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements: result,
    appState: {
      viewBackgroundColor: viewBackgroundColor || '#ffffff',
      gridSize: 20,
      scrollX: viewport.scrollX,
      scrollY: viewport.scrollY,
      zoom: viewport.zoom,
    },
    files,
  };
}

/**
 * 将 SVG 字符串编码为 base64（浏览器 + Node 全局 btoa 均可用，
 * 避免直接 import Node 核心模块 Buffer，符合移动端约束）。
 */
function toBase64(svg: string): string {
  if (typeof btoa === 'function') {
    return btoa(unescape(encodeURIComponent(svg)));
  }
  // 兜底：逐字符手动 UTF-8 → base64 编码（无 btoa 环境）
  const bytes = new Uint8Array([...unescape(encodeURIComponent(svg))].map(c => c.charCodeAt(0)));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  // 同样使用 btoa 逻辑，但作为最终兜底若仍无 btoa 则用字符映射
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let i = 0; i < binary.length; i += 3) {
    const a = binary.charCodeAt(i);
    const b = i + 1 < binary.length ? binary.charCodeAt(i + 1) : 0;
    const c = i + 2 < binary.length ? binary.charCodeAt(i + 2) : 0;
    result += chars[a >> 2];
    result += chars[((a & 3) << 4) | (b >> 4)];
    result += i + 1 < binary.length ? chars[((b & 15) << 2) | (c >> 6)] : '=';
    result += i + 2 < binary.length ? chars[c & 63] : '=';
  }
  return result;
}

/**
 * 构建 Excalidraw `image` 元素，嵌入图标 SVG（dataURL 已在父作用域写入 files）。
 */
function toIconImageElement(
  parentId: string,
  icon: ProcessedIcon,
  fileId: string,
): ExcalidrawElement {
  return {
    id: `${parentId}_icon`,
    type: 'image',
    x: icon.x,
    y: icon.y,
    width: icon.size,
    height: icon.size,
    angle: 0,
    strokeColor: 'transparent',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: nextSeed(),
    version: 1,
    versionNonce: now(),
    isDeleted: false,
    boundElements: null,
    updated: now(),
    link: null,
    locked: false,
    status: 'saved',
    fileId,
    scale: [1, 1],
    customData: null,
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

function ccw(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
  return (cy - ay) * (bx - ax) > (by - ay) * (cx - ax);
}

function segmentsIntersect(
  x1: number, y1: number, x2: number, y2: number,
  x3: number, y3: number, x4: number, y4: number
): boolean {
  return (
    ccw(x1, y1, x3, y3, x4, y4) !== ccw(x2, y2, x3, y3, x4, y4) &&
    ccw(x1, y1, x2, y2, x3, y3) !== ccw(x1, y1, x2, y2, x4, y4)
  );
}

function detectConnectorNodeOverlaps(elements: ElementDef[]): string[] {
  const shapes = elements.filter(e =>
    ['rectangle', 'ellipse', 'diamond'].includes(e.type)
  );
  const connectors = elements.filter(e => e.type === 'arrow' || e.type === 'line');
  const warnings: string[] = [];

  const nodeMap = new Map(elements.map(e => [e.id, e]));

  for (const conn of connectors) {
    const startId = conn.startBinding?.elementId;
    const endId = conn.endBinding?.elementId;
    const startEl = startId ? nodeMap.get(startId) : null;
    const endEl = endId ? nodeMap.get(endId) : null;

    // 构造连线的完整绝对坐标路径：
    // 起点（startEl 中心或 points[0]）→ 中间控制点（points[1..n-1]）→ 终点（endEl 中心或 points[last]）
    // 支持 multi-segment 折线/贝塞尔，避免漏检 L 形/Z 形连线穿过节点的情况
    const path: [number, number][] = [];
    if (startEl) {
      path.push([startEl.x + startEl.width / 2, startEl.y + startEl.height / 2]);
    } else if (conn.points && conn.points.length > 0) {
      path.push([conn.x + conn.points[0][0], conn.y + conn.points[0][1]]);
    }
    // 中间控制点：仅当 points ≥ 3 个时才视为真实折线（LLM 默认占位 [[0,0],[1,0]] 长度=2）
    if (conn.points && conn.points.length >= 3) {
      for (let i = 1; i < conn.points.length - 1; i++) {
        path.push([conn.x + conn.points[i][0], conn.y + conn.points[i][1]]);
      }
    }
    if (endEl) {
      path.push([endEl.x + endEl.width / 2, endEl.y + endEl.height / 2]);
    } else if (conn.points && conn.points.length >= 2) {
      const last = conn.points[conn.points.length - 1];
      path.push([conn.x + last[0], conn.y + last[1]]);
    }

    // 路径点不足 2 个，无法构成线段
    if (path.length < 2) continue;

    // 对每个无关 shape，遍历 path 相邻段做相交检测
    for (const shape of shapes) {
      if (shape.id === startId || shape.id === endId) continue;

      const minX = shape.x;
      const maxX = shape.x + shape.width;
      const minY = shape.y;
      const maxY = shape.y + shape.height;
      const inside = (x: number, y: number) => x > minX && x < maxX && y > minY && y < maxY;

      let intersects = false;
      for (let i = 0; i < path.length - 1; i++) {
        const [x1, y1] = path[i];
        const [x2, y2] = path[i + 1];
        if (
          inside(x1, y1) ||
          inside(x2, y2) ||
          segmentsIntersect(x1, y1, x2, y2, minX, minY, minX, maxY) ||
          segmentsIntersect(x1, y1, x2, y2, maxX, minY, maxX, maxY) ||
          segmentsIntersect(x1, y1, x2, y2, minX, minY, maxX, minY) ||
          segmentsIntersect(x1, y1, x2, y2, minX, maxY, maxX, maxY)
        ) {
          intersects = true;
          break;
        }
      }

      if (intersects) {
        warnings.push(`连线 "${conn.id}" 穿过了无关节点 "${shape.id}"，请调整节点位置或连线路径以避免遮挡`);
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

/**
 * 保存 Excalidraw 文件。
 *
 * 统一输出为 `.excalidraw.md` 格式（Excalidraw 插件原生 Markdown 包装格式，包含 lz-string 压缩）。
 *
 * @param filename 导出的文件名（不带后缀）
 * @param elements 图形元素数组
 * @param layout 选用的几何布局类型
 * @param context 工具上下文
 * @param isAlreadyResolved 若为 true，则在构建 JSON 时不重新计算 preprocess 与 layout 步骤（避免 execute 等前置调用处的重复耗时计算）
 * @param icons 图标处理结果
 * @param growthMode 思维导图生长方向
 * @returns 最终 `.excalidraw.md` 文件的路径和嵌入语法
 */
export async function saveExcalidrawFile(
  filename: string,
  elements: ElementDef[],
  layout: DiagramLayoutType | undefined,
  context: ToolContext,
  isAlreadyResolved = false,
  icons: ProcessedIcon[] = [],
  growthMode?: string,
): Promise<{ filepath: string; embed: string }> {
  // 1. 构建完整 JSON（含图标 image 元素）
  const excalidrawFile = buildExcalidrawJSON(elements, layout, context, isAlreadyResolved, icons, growthMode);

  // 2. 写入文件系统
  const dir = 'Excalidraw';
  const adapter = context.vault.app.vault.adapter;
  if (!(await adapter.exists(dir))) {
    await adapter.mkdir(dir);
  }

  const filepath = `${dir}/${filename}.excalidraw.md`;
  await adapter.write(filepath, buildExcalidrawMd(excalidrawFile));
  return {
    filepath,
    embed: `![[${filepath}]]`,
  };
}

export const excalidrawTool: ToolExecutor = {
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const { filename, elements, layout, growthMode } = args as {
      filename: string;
      elements: ElementDef[];
      layout?: DiagramLayoutType;
      growthMode?: string;
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
      // 0. 前置执行大小适配与布局引擎，确保诊断运行在最终坐标/尺寸上
      const preprocessed = preprocessElementSizes(elements);
      const layoutOptions = growthMode ? { growthMode } : undefined;
      const resolved = arrangeWithFallback(preprocessed, layout, layoutOptions);

      // 1. 碰撞检测 + 语义验证
      const warnings = detectOverlaps(resolved);
      const textWarnings = detectTextOverlaps(resolved);
      const connectorWarnings = detectConnectorNodeOverlaps(resolved);
      const semanticWarnings = validateSemantics(resolved);

      // 1.5 图标处理：加载 SVG 并计算位置（异步，依赖 CDN；
      //     加载失败的元素静默跳过，不影响其余图表生成）
      const iconDefs = await processIcons(resolved, resolveObsidianTheme(context));
      if (iconDefs.length > 0) {
        log('info', `[excalidraw] ${iconDefs.length} icons prepared`);
      }

      // 2. 写入文件（透传 isAlreadyResolved = true，避免重复计算布局）
      const { filepath, embed } = await saveExcalidrawFile(filename, resolved, layout, context, true, iconDefs, growthMode);
      log('info', `Excalidraw 图形已生成: ${filepath}`);

      const allWarnings = [...warnings, ...textWarnings, ...connectorWarnings, ...semanticWarnings];
      if (allWarnings.length > 0) {
        return JSON.stringify({
          success: true,
          filepath,
          embed,
          warnings: allWarnings,
          suggestion: '请根据 warnings 调整坐标/尺寸/绑定后重新调用',
        });
      }

      return JSON.stringify({ success: true, filepath, embed });
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
  layout?: DiagramLayoutType,
): Promise<string> {
  if (!filename || !elements || !Array.isArray(elements) || elements.length === 0) {
    throw new Error('writeExcalidrawJson: filename 或 elements 为空');
  }

  if (!/^[\w一-鿿\-][\w一-鿿\- ]{0,100}$/.test(filename)) {
    throw new Error(`writeExcalidrawJson: filename 非法 "${filename}"`);
  }

  const excalidrawFile = buildExcalidrawJSON(elements, layout, context);

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
export { buildExcalidrawJSON, detectOverlaps, detectTextOverlaps, detectConnectorNodeOverlaps, validateSemantics, computeOptimalFontSize };
export { calculateViewport, edgeIntersection, resolveOverlaps } from './excalidraw-geometry.js';
export type { ElementDef };
