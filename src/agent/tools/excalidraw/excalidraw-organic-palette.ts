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
  textColor: string; // 容器内文字的颜色，浅色主题下为同色系深色，深色主题下为同色系浅色
  fillStyle: 'solid' | 'hachure' | 'cross-hatch';
  strokeWidth: number;
  roughness: number;
}

// 现代丰富多彩色板：「雾霭柔彩」柔和配色方案
export const PALETTE: Record<ObsidianTheme, Record<SemanticColor, NodeStyle>> = {
  light: {
    // emphasis: 浅玫红填充 + 玫红描边 + 深玫红文字
    emphasis:  { stroke: '#ec4899', fill: '#fce7f3', textColor: '#9d174d', fillStyle: 'solid', strokeWidth: 1.5, roughness: 0 },
    // primary: 雾蓝填充 + 蔚蓝描边 + 深蓝文字
    primary:   { stroke: '#3b82f6', fill: '#dbeafe', textColor: '#1e40af', fillStyle: 'solid', strokeWidth: 1.5, roughness: 0 },
    // success: 薄荷绿填充 + 翡翠描边 + 深绿文字
    success:   { stroke: '#10b981', fill: '#d1fae5', textColor: '#065f46', fillStyle: 'solid', strokeWidth: 1.5, roughness: 0 },
    // warning: 淡鹅黄填充 + 琥珀描边 + 深琥珀文字
    warning:   { stroke: '#f59e0b', fill: '#fef3c7', textColor: '#92400e', fillStyle: 'solid', strokeWidth: 1.5, roughness: 0 },
    // highlight: 薰衣草填充 + 紫罗兰描边 + 深紫文字
    highlight: { stroke: '#8b5cf6', fill: '#ede9fe', textColor: '#5b21b6', fillStyle: 'solid', strokeWidth: 1.5, roughness: 0 },
    // neutral: 雾灰填充 + 银灰描边 + 炭灰文字
    neutral:   { stroke: '#94a3b8', fill: '#f1f5f9', textColor: '#334155', fillStyle: 'solid', strokeWidth: 1.5, roughness: 0 },
  },
  dark: {
    emphasis:  { stroke: '#f472b6', fill: '#4a1942', textColor: '#fce7f3', fillStyle: 'solid', strokeWidth: 1.5, roughness: 0 },
    primary:   { stroke: '#60a5fa', fill: '#1e3a5f', textColor: '#bfdbfe', fillStyle: 'solid', strokeWidth: 1.5, roughness: 0 },
    success:   { stroke: '#34d399', fill: '#064e3b', textColor: '#d1fae5', fillStyle: 'solid', strokeWidth: 1.5, roughness: 0 },
    warning:   { stroke: '#fbbf24', fill: '#451a03', textColor: '#fef3c7', fillStyle: 'solid', strokeWidth: 1.5, roughness: 0 },
    highlight: { stroke: '#a78bfa', fill: '#2e1065', textColor: '#ede9fe', fillStyle: 'solid', strokeWidth: 1.5, roughness: 0 },
    neutral:   { stroke: '#64748b', fill: '#1e293b', textColor: '#cbd5e1', fillStyle: 'solid', strokeWidth: 1.5, roughness: 0 },
  },
};

// 统一的连线属性定义
export const CONNECTOR_COLORS: Record<ObsidianTheme, { stroke: string; strokeWidth: number }> = {
  light: { stroke: '#94a3b8', strokeWidth: 1.5 },
  dark: { stroke: '#475569', strokeWidth: 1.5 },
};

// 背景色：现代冷灰/蓝黑
export const BACKGROUNDS: Record<ObsidianTheme, string> = {
  light: '#f8fafc',
  dark: '#0f172a',
};

// 文字色（当元素未指定 semanticColor 时的默认文字色）
export const TEXT_COLORS: Record<ObsidianTheme, string> = {
  light: '#1e293b',
  dark: '#f1f5f9',
};
