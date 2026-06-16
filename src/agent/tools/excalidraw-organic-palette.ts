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
export const PALETTE: Record<ObsidianTheme, Record<SemanticColor, { stroke: string; fill: string; textBg: string }>> = {
  light: {
    // 卡片式书卷风：填充色更饱和，文字背景色更淡，形成明确视觉隔离
    primary:   { stroke: '#1e3a5f', fill: '#c7d9f9', textBg: '#eef4ff' },
    emphasis:  { stroke: '#b91c1c', fill: '#f9c6c6', textBg: '#fff0f0' },
    success:   { stroke: '#166534', fill: '#c4ebd0', textBg: '#eefdf3' },
    warning:   { stroke: '#9a3412', fill: '#ffe4b5', textBg: '#fff9ed' },
    highlight: { stroke: '#854d0e', fill: '#fdee8a', textBg: '#fffce8' },
    neutral:   { stroke: '#292524', fill: '#efebe2', textBg: '#faf7f1' },
  },
  dark: {
    primary:   { stroke: '#93c5fd', fill: '#1e3a5f', textBg: '#0f1f33' },
    emphasis:  { stroke: '#fca5a5', fill: '#7f1d1d', textBg: '#331010' },
    success:   { stroke: '#86efac', fill: '#14532d', textBg: '#0a2915' },
    warning:   { stroke: '#fdba74', fill: '#7c2d12', textBg: '#331408' },
    highlight: { stroke: '#fde047', fill: '#713f12', textBg: '#2e1a06' },
    neutral:   { stroke: '#e5e5e5', fill: '#2a2721', textBg: '#1a1815' },
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
