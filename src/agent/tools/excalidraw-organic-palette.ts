/**
 * 现代丰富多彩色板与渲染预设。
 *
 * 这些常量集中管理，便于主题切换和视觉一致性调整。
 */

export type ObsidianTheme = 'light' | 'dark';

export type SemanticColor =
  | 'primary'      // 主流程、主节点
  | 'emphasis'     // 重点、起点、关键决策
  | 'success'      // 成功、终点、生长
  | 'warning'      // 警告、备选、冲突
  | 'highlight'    // 高亮、注释
  | 'neutral';     // 默认

export interface NodeStyle {
  stroke: string;
  fill: string;
  textBg: string; // 回归卡片文字背景，避免空洞
  fillStyle: 'solid' | 'hachure' | 'cross-hatch';
  strokeWidth: number;
  roughness: number;
}

// 现代丰富多彩色板
export const PALETTE: Record<ObsidianTheme, Record<SemanticColor, NodeStyle>> = {
  light: {
    // emphasis: 朱砂红（实底 + 3px描边）
    emphasis:  { stroke: '#9b1d1d', fill: '#e53e3e', textBg: '#fff0f0', fillStyle: 'solid',       strokeWidth: 3, roughness: 0 },
    // primary: 靛青蓝（实底）
    primary:   { stroke: '#1a4a8a', fill: '#3b82f6', textBg: '#eef4ff', fillStyle: 'solid',       strokeWidth: 2, roughness: 0 },
    // success: 黛绿（实底）
    success:   { stroke: '#166534', fill: '#22c55e', textBg: '#eefdf3', fillStyle: 'solid',       strokeWidth: 2, roughness: 0 },
    // warning: 橙黄（条纹填充）
    warning:   { stroke: '#92400e', fill: '#f59e0b', textBg: '#fff9ed', fillStyle: 'hachure',     strokeWidth: 2, roughness: 1 },
    // highlight: 亮紫（交叉纹）
    highlight: { stroke: '#6b21a8', fill: '#a855f7', textBg: '#fffce8', fillStyle: 'cross-hatch', strokeWidth: 2, roughness: 1 },
    // neutral: 灰（轻条纹）
    neutral:   { stroke: '#374151', fill: '#9ca3af', textBg: '#faf7f1', fillStyle: 'hachure',     strokeWidth: 1, roughness: 1 },
  },
  dark: {
    emphasis:  { stroke: '#fca5a5', fill: '#dc2626', textBg: '#331010', fillStyle: 'solid',       strokeWidth: 3, roughness: 0 },
    primary:   { stroke: '#93c5fd', fill: '#2563eb', textBg: '#0f1f33', fillStyle: 'solid',       strokeWidth: 2, roughness: 0 },
    success:   { stroke: '#86efac', fill: '#16a34a', textBg: '#0a2915', fillStyle: 'solid',       strokeWidth: 2, roughness: 0 },
    warning:   { stroke: '#fde68a', fill: '#d97706', textBg: '#331408', fillStyle: 'hachure',     strokeWidth: 2, roughness: 1 },
    highlight: { stroke: '#e9d5ff', fill: '#9333ea', textBg: '#2e1a06', fillStyle: 'cross-hatch', strokeWidth: 2, roughness: 1 },
    neutral:   { stroke: '#d1d5db', fill: '#6b7280', textBg: '#1a1815', fillStyle: 'hachure',     strokeWidth: 1, roughness: 1 },
  },
};

// 背景色：现代冷灰/蓝黑
export const BACKGROUNDS: Record<ObsidianTheme, string> = {
  light: '#f8fafc',
  dark: '#0f172a',
};

// 文字色（当元素未指定 semanticColor 时的兜底）
export const TEXT_COLORS: Record<ObsidianTheme, string> = {
  light: '#1e293b',
  dark: '#f1f5f9',
};
