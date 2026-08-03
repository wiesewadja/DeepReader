/**
 * 视觉风格处理器。
 *
 * 把 LLM 输出的语义化元素（带 semanticColor）转换为具体视觉属性：
 * - 节点：手绘风格配色 + solid 实填充 + 粗描边 + 手绘粗糙感
 * - 连线/箭头：深灰色 + 粗线条 + 手绘感
 * - 背景：温暖米色（浅色）/ 深蓝黑（深色）
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
import { isContainer } from './excalidraw-geometry.js';

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
      // 复用 geometry 的单一事实源，避免 frame_/childIds-only 容器在此被漏判
      const container = isContainer(el);
      // 仅 depth===0 触发根节点强化；semanticColor 不参与描边强化（保持既有视觉语义）
      const isRoot = el.customData?.depth === 0;

      const semantic = resolveSemanticColor(theme, el.semanticColor);
      const col = PALETTE[theme][semantic];

      // 四分支穷尽赋值，无需 let 初始化（消除"初始化后被覆盖"的死代码）
      let strokeW: number;
      let rough: number;
      let fillSt: 'solid' | 'hachure' | 'cross-hatch';
      let op = el.opacity ?? 100;

      if (el.customData?.isBoundary) {
        strokeW = 1;
        rough = 1;
        fillSt = 'hachure';
      } else if (container) {
        strokeW = 1.5;
        rough = 1;
        fillSt = 'hachure';
        op = 40; // 容器半透明，不冲淡内部卡片
      } else if (isRoot) {
        strokeW = 2.5;
        rough = 2; // 强化根节点手绘质感
        fillSt = 'solid';
      } else {
        strokeW = col.strokeWidth;
        rough = col.roughness;
        fillSt = 'solid';
      }

      result.push({
        ...el,
        strokeColor: col.stroke,
        backgroundColor: col.fill,
        roughness: rough,
        strokeWidth: strokeW,
        fillStyle: fillSt,
        opacity: op,
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

    // crossLink 样式：虚线 + 细线 + 半透明
    if (el.customData?.isCrossLink) {
      result.push({
        ...el,
        strokeColor: connStyle.stroke,
        strokeWidth: 1,
        strokeStyle: 'dashed',
        roughness: 1,
        opacity: 60,
      });
    } else {
      result.push({
        ...el,
        strokeColor: connStyle.stroke,
        strokeWidth: connStyle.strokeWidth,
        roughness: 1,
        opacity: el.opacity ?? 90,
      });
    }
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
