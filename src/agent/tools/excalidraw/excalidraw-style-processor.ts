/**
 * 视觉风格处理器。
 *
 * 把 LLM 输出的语义化元素（带 semanticColor）转换为具体视觉属性：
 * - 节点：低饱和度柔色彩色板 + solid 实填充 + 细描边
 * - 连线/箭头：统一柔灰色，降低视觉噪音
 * - 背景：冷灰/深蓝黑
 *
 * 入口：applyDiagramStyle
 */

import { type ElementDef, type DiagramLayoutType } from './excalidraw-types.js';
import {
  type ObsidianTheme,
  type SemanticColor,
  PALETTE,
  BACKGROUNDS,
  CONNECTOR_COLORS,
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
      result.push({
        ...el,
        strokeColor: col.stroke,
        backgroundColor: col.fill,
        roughness: col.roughness,
        strokeWidth: col.strokeWidth,
        fillStyle: 'solid',
      });
    } else if (isText) {
      result.push({ ...el });
    }
  }
  return result;
}

// 辅助方法：设置连线和箭头的样式（统一颜色，不再从起点继承颜色以降低噪音）
function styleConnectors(
  elements: ElementDef[],
  theme: ObsidianTheme
): ElementDef[] {
  const result: ElementDef[] = [];
  const connStyle = CONNECTOR_COLORS[theme];

  for (const el of elements) {
    const isArrow = el.type === 'arrow';
    const isLine = el.type === 'line';
    if (!isArrow && !isLine) continue;

    result.push({
      ...el,
      strokeColor: connStyle.stroke,
      strokeWidth: connStyle.strokeWidth,
      roughness: 0,
      opacity: el.opacity ?? 90,
    });
  }
  return result;
}

export function applyDiagramStyle(input: StyleProcessorInput): StyleProcessorOutput {
  const { elements, theme } = input;

  // 1. 处理形状和普通文本
  const styledNodes = styleNodes(elements, theme);

  // 2. 处理连线/箭头
  const styledConnectors = styleConnectors(elements, theme);

  return {
    elements: [...styledConnectors, ...styledNodes],
    viewBackgroundColor: BACKGROUNDS[theme],
  };
}
