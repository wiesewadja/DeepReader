/**
 * Excalidraw semantic layout types.
 */

export interface ElementDef {
  id: string;
  type: 'rectangle' | 'ellipse' | 'diamond' | 'arrow' | 'line' | 'text' | 'freedraw';
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: 'solid' | 'hachure' | 'cross-hatch';
  strokeWidth?: number;
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
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
  semanticColor?: 'primary' | 'emphasis' | 'success' | 'warning' | 'highlight' | 'neutral';
  customData?: Record<string, any>;
  /** 可选：圆角配置 */
  roundness?: null | { type: number };
}

export type DiagramLayoutType =
  | 'hierarchical-tree'
  | 'flow-horizontal'
  | 'timeline'
  | 'radial'
  | 'matrix'
  | 'mind-map';

export interface LayoutScore {
  totalOverlapArea: number;   // 总重叠面积
  overlapPairs: number;       // 重叠元素对数
  boundingArea: number;       // 整体包围盒面积（用于衡量稀疏度）
  edgeCrossings: number;      // 边交叉数；Phase 1 固定返回 0
}

/** 思维导图生长方向 */
export type GrowthMode =
  | 'Right-Left'
  | 'Right-facing'
  | 'Left-facing'
  | 'Radial'
  | 'Up-Down'
  | 'Up-facing'
  | 'Down-facing';

export interface LayoutOptions {
  columns?: number;                       // matrix: 列数
  direction?: 'horizontal' | 'vertical';  // flow / timeline
  spacing?: { x: number; y: number };     // 可选间距覆盖
  growthMode?: GrowthMode;                 // mind-map: 生长方向
}

export interface LayoutEngine {
  arrange(elements: ElementDef[], options?: LayoutOptions): ElementDef[];
}

export const FREE_TEXT_BG_SUFFIX = '_bg';

export function isFreeTextBackground(id: string): boolean {
  return id.endsWith(FREE_TEXT_BG_SUFFIX);
}
