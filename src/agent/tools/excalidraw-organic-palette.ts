/**
 * 有机书卷风格的色板与渲染预设。
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

// 宣纸书卷色板
export const PALETTE: Record<ObsidianTheme, Record<SemanticColor, { stroke: string; fill: string }>> = {
  light: {
    primary:   { stroke: '#1e3a5f', fill: '#e8f0fe' },
    emphasis:  { stroke: '#c53030', fill: '#fde8e8' },
    success:   { stroke: '#1f5e3b', fill: '#e6f4ea' },
    warning:   { stroke: '#b45309', fill: '#fff3e0' },
    highlight: { stroke: '#a16207', fill: '#fef9c3' },
    neutral:   { stroke: '#2c2c2c', fill: '#fdfbf7' },
  },
  dark: {
    primary:   { stroke: '#93c5fd', fill: '#1e3a5f' },
    emphasis:  { stroke: '#fca5a5', fill: '#7f1d1d' },
    success:   { stroke: '#86efac', fill: '#14532d' },
    warning:   { stroke: '#fdba74', fill: '#7c2d12' },
    highlight: { stroke: '#fde047', fill: '#713f12' },
    neutral:   { stroke: '#e5e5e5', fill: '#2a2721' },
  },
};

// 背景色
export const BACKGROUNDS: Record<ObsidianTheme, string> = {
  light: '#fffce8',
  dark: '#1f1d19',
};

// 文字色（当元素未指定 semanticColor 时的兜底）
export const TEXT_COLORS: Record<ObsidianTheme, string> = {
  light: '#1e293b',
  dark: '#f5f5f0',
};

// 有机线渲染参数预设
export const ORGANIC_LINE_PRESET = {
  simulatePressure: false,
  options: {
    thinning: 2,
    smoothing: 0.5,
    streamline: 0.6,
    easing: 'linear',
    start: { taper: true, easing: 'linear', cap: true },
    end: { taper: true, easing: 'linear', cap: false },
  },
};
