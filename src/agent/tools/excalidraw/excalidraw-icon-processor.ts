/**
 * Excalidraw 图标处理器
 *
 * 遍历带 icon 字段的元素，加载 SVG 图标并转换为 Excalidraw image 元素，
 * 位置根据 position 参数计算（不参与布局计算）。
 *
 * 说明：PRD 原型验证用了 ea.importSVG()，但本工具最终通过 Vault API
 * 写入 .excalidraw.md（而非在 ea 画布上构建），因此采用自包含方案：
 * 将 SVG 作为 data URL 嵌入 Excalidraw image 元素，直接写入文件。
 * 这样可在单元测试中验证、且图标加载失败时优雅降级。
 */

import { toolsLog } from '../../../utils/logger.js';
import { loadIcon } from './excalidraw-icon-library.js';
import { PALETTE } from './excalidraw-organic-palette.js';
import type { ElementDef, IconPosition } from './excalidraw-types.js';

/** 单个已处理图标的渲染信息 */
export interface ProcessedIcon {
  /** 父元素 id */
  elementId: string;
  /** 图标 SVG 内容 */
  svg: string;
  /** 图标左上角 x */
  x: number;
  /** 图标左上角 y */
  y: number;
  /** 图标颜色（继承父元素语义色，未提供则为 undefined） */
  color?: string;
  /** 图标尺寸（正方形，默认 24） */
  size: number;
}

/**
 * 计算图标尺寸
 *
 * inside 模式：节点高度的 40%，上限 56px，下限 28px（与文字协调）。
 * 其他模式：固定 48px（独立图标足够大）。
 */
function computeIconSize(position: IconPosition, element: ElementDef): number {
  if (position === 'inside') {
    const byHeight = Math.round(element.height * 0.4);
    return Math.min(56, Math.max(28, byHeight));
  }
  return 48;
}

/**
 * 计算图标位置
 *
 * @param position 放置位置类型
 * @param element 父元素
 * @param iconSize 图标尺寸（由 computeIconSize 提供）
 * @returns 图标坐标 { x, y }
 */
export function calculateIconPosition(
  position: IconPosition,
  element: ElementDef,
  iconSize: number,
): { x: number; y: number } {
  const padding = 12;

  switch (position) {
    case 'inside':
      // 节点内部左侧，垂直居中
      return {
        x: element.x + padding,
        y: element.y + (element.height - iconSize) / 2,
      };

    case 'left':
      // 节点左侧外部，垂直居中
      return {
        x: element.x - iconSize - padding,
        y: element.y + (element.height - iconSize) / 2,
      };

    case 'top-right':
      // 节点右上角
      return {
        x: element.x + element.width - iconSize - padding,
        y: element.y - iconSize - padding,
      };

    case 'above':
      // 节点上方，水平居中
      return {
        x: element.x + (element.width - iconSize) / 2,
        y: element.y - iconSize - padding,
      };

    default:
      // 默认：inside
      return {
        x: element.x + padding,
        y: element.y + (element.height - iconSize) / 2,
      };
  }
}

/**
 * 处理图标
 *
 * 遍历带 icon 字段的元素，加载 SVG 内容并计算放置位置。
 * 返回的结果交由 buildExcalidrawJSON 转换为 Excalidraw image 元素写入文件。
 *
 * 图标加载失败时静默跳过（优雅降级），不阻塞图表生成。
 *
 * @param elements 已布局的元素列表
 * @param theme 当前主题（用于解析图标继承的语义色）
 * @returns 已成功加载的图标渲染信息列表
 */
export async function processIcons(
  elements: ElementDef[],
  theme: 'light' | 'dark' = 'light',
): Promise<ProcessedIcon[]> {
  const results: ProcessedIcon[] = [];

  const elementsWithIcon = elements.filter(el => el.icon && el.icon.name);
  if (elementsWithIcon.length === 0) {
    return results;
  }

  toolsLog('info', `[excalidraw-icons] Processing ${elementsWithIcon.length} icons`);

  // 并行加载所有图标（单个超时 5s，不互相阻塞）
  const loadResults = await Promise.all(
    elementsWithIcon.map(async (element) => {
      if (!element.icon) return null;
      const { name, position } = element.icon;

      const svg = await loadIcon(name);
      if (!svg) {
        toolsLog('warn', `[excalidraw-icons] Icon "${name}" load failed for element "${element.id}", skipping`);
        return null;
      }

      let color = element.strokeColor;
      if (!color && element.semanticColor && PALETTE[theme][element.semanticColor]) {
        color = PALETTE[theme][element.semanticColor].stroke;
      }

      const size = computeIconSize(position || 'inside', element);
      const pos = calculateIconPosition(position || 'inside', element, size);
      toolsLog('info', `[excalidraw-icons] Icon "${name}" prepared for element "${element.id}" at (${pos.x}, ${pos.y})`);

      return {
        elementId: element.id,
        svg,
        x: pos.x,
        y: pos.y,
        color,
        size,
      } as ProcessedIcon;
    }),
  );

  return results.concat(loadResults.filter((r): r is ProcessedIcon => r !== null));
}

/**
 * 批量处理图标（同步版本，用于测试）
 *
 * @testOnly 生产管线使用异步 `processIcons`，此函数仅用于单元测试中的位置计算验证。
 * 注意：此函数不加载图标，仅计算位置。
 */
export function processIconsSync(
  elements: ElementDef[],
): { element: ElementDef; iconPosition: { x: number; y: number } }[] {
  const results: { element: ElementDef; iconPosition: { x: number; y: number } }[] = [];

  for (const element of elements) {
    if (!element.icon) continue;

    const position = element.icon.position || 'inside';
    const size = computeIconSize(position, element);
    const iconPos = calculateIconPosition(position, element, size);
    results.push({ element, iconPosition: iconPos });
  }

  return results;
}
