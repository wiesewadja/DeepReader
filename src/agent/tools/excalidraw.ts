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

function toExcalidrawElement(el: ElementDef): ExcalidrawElement {
  const isText = el.type === 'text';
  const isArrow = el.type === 'arrow';
  const isLine = el.type === 'line';
  const isShape = ['rectangle', 'ellipse', 'diamond'].includes(el.type);
  const base: ExcalidrawElement = {
    id: el.id,
    type: el.type,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    angle: 0,
    strokeColor: el.strokeColor ?? '#1e293b',
    backgroundColor: el.backgroundColor ?? (isShape ? '#fffaf0' : 'transparent'),
    fillStyle: el.fillStyle ?? 'solid',
    strokeWidth: el.strokeWidth ?? (isLine || isArrow ? 1 : 2),
    strokeStyle: 'solid',
    roughness: el.roughness ?? 0,
    opacity: el.opacity ?? 100,
    groupIds: el.groupIds ?? [],
    frameId: null,
    roundness: isShape ? { type: 3 } : null,
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
    // Free text cap: 22px max; bound text uses the container's maxFontSize logic instead
    const freeTextCap = el.containerId ? (el.fontSize ?? 16) : Math.min(el.fontSize ?? 16, 22);
    base.fontSize = freeTextCap;
    base.fontFamily = 1;
    // 自由文本默认左对齐，容器内文本默认居中
    base.textAlign = el.textAlign ?? (el.containerId ? 'center' : 'left');
    base.verticalAlign = el.verticalAlign ?? (el.containerId ? 'middle' : 'top');
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

/**
 * 容器内文本字号上限（极简三档）。
 * 避免 LLM 给大容器配过大字号导致中文溢出。
 */
function getContainerMaxFontSize(containerWidth: number): number {
  if (containerWidth >= 240) return 22;
  if (containerWidth >= 140) return 16;
  return 14;
}

function buildExcalidrawJSON(elements: ElementDef[]): ExcalidrawFile {
  // Deterministic collision resolution before building
  const resolved = resolveOverlaps(elements);

  // Build element lookup for auto-calculating arrow positions
  const elMap = new Map<string, ElementDef>();
  for (const el of resolved) {
    elMap.set(el.id, el);
  }

  const result: ExcalidrawElement[] = [];

  for (let el of resolved) {
    const isContainer = ['rectangle', 'ellipse', 'diamond'].includes(el.type);
    const isText = el.type === 'text';
    const needsAutoText = isContainer && el.text && !isText;
    const isArrowOrLine = el.type === 'arrow' || el.type === 'line';

    // Normalize binding field names: LLM may emit {id} instead of {elementId}
    if (el.startBinding && !el.startBinding.elementId) {
      const b = el.startBinding as Record<string, unknown>;
      const eid = (b.id ?? b.targetId ?? b.element ?? b.target) as string | undefined;
      if (eid) el = { ...el, startBinding: { elementId: eid, gap: b.gap as number ?? 2, focus: b.focus as number ?? 0 } };
    }
    if (el.endBinding && !el.endBinding.elementId) {
      const b = el.endBinding as Record<string, unknown>;
      const eid = (b.id ?? b.targetId ?? b.element ?? b.target) as string | undefined;
      if (eid) el = { ...el, endBinding: { elementId: eid, gap: b.gap as number ?? 2, focus: b.focus as number ?? 0 } };
    }
    if (needsAutoText) {
      // 形状有 text → 自动创建绑定的 text 子元素
      const textId = `${el.id}_text`;
      const shapeEl = toExcalidrawElement(el);
      // shape 不放 text 属性，但加 boundElements 指向 text
      shapeEl.boundElements = [{ id: textId, type: 'text' }];
      result.push(shapeEl);

      // 创建 text 子元素 — fontSize 根据容器宽度自适应上限，避免中文溢出
      const maxFontSize = getContainerMaxFontSize(el.width);
      const paddingX = Math.max(24, el.width * 0.12);
      const paddingY = Math.max(18, el.height * 0.15);
      const textEl = toExcalidrawElement({
        ...el,
        id: textId,
        type: 'text',
        x: el.x + paddingX,
        y: el.y + paddingY,
        width: Math.max(20, el.width - paddingX * 2),
        height: Math.max(20, el.height - paddingY * 2),
        containerId: el.id,
        strokeColor: el.strokeColor || '#1e293b',
        fontSize: Math.min(el.fontSize || 16, maxFontSize),
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
        // 保留 LLM 提供的中间控制点，只修正起点和终点到形状边缘
        const provided = el.points && el.points.length >= 2 ? el.points : [[0, 0], [1, 0]];
        arrowEl.points = provided.map((p, i) => {
          if (i === 0) return [0, 0];
          if (i === provided.length - 1) return [ex - sx, ey - sy];
          return p as [number, number];
        });
      } else if (startEl) {
        const gap = 2;
        const cx = startEl.x + startEl.width / 2;
        const cy = startEl.y + startEl.height / 2;
        const targetCy = cy - startEl.height / 2 - gap;
        const [sx, sy] = edgeIntersection(startEl, cx, targetCy, gap);
        arrowEl.x = sx;
        arrowEl.y = sy;
        // 只有起点绑定时：优先保留 LLM 提供的 points 形态，否则默认向上延伸
        const provided = el.points && el.points.length >= 2 ? el.points : [[0, 0], [0, -80]];
        arrowEl.points = provided.map((p, i) => i === 0 ? [0, 0] : (p as [number, number]));
      }

      result.push(arrowEl);
    } else {
      let elDef = el;
      // Cap fontSize for text elements with containerId
      if (isText && el.containerId) {
        const container = elMap.get(el.containerId);
        if (container) {
          const maxFs = getContainerMaxFontSize(container.width);
          elDef = { ...el, fontSize: Math.min(el.fontSize ?? 16, maxFs) };
        }
      }
      result.push(toExcalidrawElement(elDef));
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
      viewBackgroundColor: '#fffaf0',
      gridSize: null,
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
export { buildExcalidrawJSON, detectOverlaps, detectTextOverlaps, validateSemantics };
export { calculateViewport, edgeIntersection, resolveOverlaps } from './excalidraw-geometry.js';
export type { ElementDef };
