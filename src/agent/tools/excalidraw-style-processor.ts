/**
 * 视觉风格处理器。
 *
 * 把 LLM 输出的语义化元素（带 semanticColor）转换为具体视觉属性：
 * - 节点：高饱和度色板 + hachure/cross-hatch/solid 填充
 * - 连线/箭头：标准 Excalidraw arrow，继承起点的颜色与粗细
 * - 背景：冷灰/深蓝黑
 *
 * 入口：applyDiagramStyle
 */

import { type ElementDef, type DiagramLayoutType, isFreeTextBackground } from './excalidraw-types.js';
import {
  type ObsidianTheme,
  type SemanticColor,
  PALETTE,
  BACKGROUNDS,
  TEXT_COLORS,
} from './excalidraw-organic-palette.js';

export interface StyleProcessorInput {
  elements: ElementDef[];
  layout?: DiagramLayoutType;
  theme: ObsidianTheme;
}

export interface StyleProcessorOutput {
  elements: ElementDef[];
  viewBackgroundColor: string;
}

function resolveSemanticColor(theme: ObsidianTheme, color?: SemanticColor): SemanticColor {
  if (color && PALETTE[theme][color]) return color;
  return 'neutral';
}

// 辅助方法：处理节点样式映射
function styleNodes(elements: ElementDef[], theme: ObsidianTheme): ElementDef[] {
  const result: ElementDef[] = [];
  for (const el of elements) {
    const isShape = ['rectangle', 'ellipse', 'diamond'].includes(el.type);
    const isText = el.type === 'text';

    if (isShape) {
      const semantic = resolveSemanticColor(theme, el.semanticColor);
      const col = PALETTE[theme][semantic];
      const isTextBg = isFreeTextBackground(el.id);
      result.push({
        ...el,
        strokeColor: col.stroke,
        backgroundColor: isTextBg ? col.textBg : col.fill,
        roughness: col.roughness,
        strokeWidth: col.strokeWidth,
        fillStyle: isTextBg ? 'solid' : col.fillStyle,
      });
    } else if (isText) {
      result.push({ ...el });
    }
  }
  return result;
}

// 辅助方法：设置连线和箭头的样式（继承起点颜色）
function styleConnectors(
  elements: ElementDef[],
  elMap: Map<string, ElementDef>,
  theme: ObsidianTheme
): ElementDef[] {
  const result: ElementDef[] = [];
  for (const el of elements) {
    const isArrow = el.type === 'arrow';
    const isLine = el.type === 'line';
    if (!isArrow && !isLine) continue;

    // 优先取连线自身的颜色语义，否则寻找起点的颜色语义
    let semantic: SemanticColor = 'neutral';
    if (el.semanticColor) {
      semantic = resolveSemanticColor(theme, el.semanticColor);
    } else if (el.startBinding) {
      const startEl = elMap.get(el.startBinding.elementId);
      if (startEl && startEl.semanticColor) {
        semantic = resolveSemanticColor(theme, startEl.semanticColor);
      }
    }

    const col = PALETTE[theme][semantic];

    result.push({
      ...el,
      strokeColor: col.stroke,
      strokeWidth: col.strokeWidth,
      roughness: col.roughness,
      opacity: el.opacity ?? 90,
    });
  }
  return result;
}

export function applyDiagramStyle(input: StyleProcessorInput): StyleProcessorOutput {
  const { elements, theme } = input;

  const elMap = new Map<string, ElementDef>();
  for (const el of elements) {
    elMap.set(el.id, el);
  }

  // 1. 处理形状和普通文本
  const styledNodes = styleNodes(elements, theme);

  // 2. 处理连线/箭头（直接映射为原生 arrow/line，不再转为 freedraw）
  const styledConnectors = styleConnectors(elements, elMap, theme);

  return {
    elements: [...styledConnectors, ...styledNodes],
    viewBackgroundColor: BACKGROUNDS[theme],
  };
}
