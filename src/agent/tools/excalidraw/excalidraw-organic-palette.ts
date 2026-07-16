/**
 * 手绘风格色板与渲染预设。
 *
 * 参考 Sketch Your Mind Community 风格：
 * - 温暖米色背景
 * - 高对比度（黑色粗边框 + 鲜艳填充）
 * - 手绘粗糙感（roughness > 0）
 * - 青色主色 + 橙色强调
 */

export type ObsidianTheme = 'light' | 'dark';

export type SemanticColor =
  | 'primary'      // 主流程、主节点（青色）
  | 'emphasis'     // 重点、起点、关键决策（橙色）
  | 'success'      // 成功、终点、结论（绿色）
  | 'warning'      // 警告、备选、冲突（黄色）
  | 'highlight'    // 高亮、注释、特例（紫色）
  | 'neutral';     // 默认、普通节点（浅灰）

export interface NodeStyle {
  stroke: string;
  fill: string;
  textColor: string;
  fillStyle: 'solid' | 'hachure' | 'cross-hatch';
  strokeWidth: number;
  roughness: number;
}

/**
 * 手绘风格色板：温暖背景 + 高对比度 + 手绘感
 *
 * 设计理念：
 * - 浅色主题采用米色背景，模仿纸张质感
 * - 黑色/深色粗边框，增强手绘感
 * - 鲜艳的填充色，提高可读性和视觉吸引力
 * - roughness=1 保留手绘笔触质感
 */
export const PALETTE: Record<ObsidianTheme, Record<SemanticColor, NodeStyle>> = {
  light: {
    // primary: 青色/蓝绿 — 主流程、核心节点
    primary:   { stroke: '#0E7490', fill: '#CFFAFE', textColor: '#164E63', fillStyle: 'solid', strokeWidth: 2, roughness: 1 },
    // emphasis: 橙色/珊瑚 — 重点、起点、关键决策
    emphasis:  { stroke: '#C2410C', fill: '#FFEDD5', textColor: '#7C2D12', fillStyle: 'solid', strokeWidth: 2, roughness: 1 },
    // success: 绿色 — 成功、终点、结论
    success:   { stroke: '#15803D', fill: '#DCFCE7', textColor: '#14532D', fillStyle: 'solid', strokeWidth: 2, roughness: 1 },
    // warning: 黄色/琥珀 — 警告、备选、冲突
    warning:   { stroke: '#A16207', fill: '#FEF9C3', textColor: '#713F12', fillStyle: 'solid', strokeWidth: 2, roughness: 1 },
    // highlight: 紫色 — 高亮、注释、特例
    highlight: { stroke: '#7E22CE', fill: '#F3E8FF', textColor: '#581C87', fillStyle: 'solid', strokeWidth: 2, roughness: 1 },
    // neutral: 浅灰 — 默认、普通节点
    neutral:   { stroke: '#374151', fill: '#F3F4F6', textColor: '#1F2937', fillStyle: 'solid', strokeWidth: 2, roughness: 1 },
  },
  dark: {
    primary:   { stroke: '#22D3EE', fill: '#164E63', textColor: '#CFFAFE', fillStyle: 'solid', strokeWidth: 2, roughness: 1 },
    emphasis:  { stroke: '#FB923C', fill: '#7C2D12', textColor: '#FFEDD5', fillStyle: 'solid', strokeWidth: 2, roughness: 1 },
    success:   { stroke: '#4ADE80', fill: '#14532D', textColor: '#DCFCE7', fillStyle: 'solid', strokeWidth: 2, roughness: 1 },
    warning:   { stroke: '#FACC15', fill: '#713F12', textColor: '#FEF9C3', fillStyle: 'solid', strokeWidth: 2, roughness: 1 },
    highlight: { stroke: '#C084FC', fill: '#581C87', textColor: '#F3E8FF', fillStyle: 'solid', strokeWidth: 2, roughness: 1 },
    neutral:   { stroke: '#9CA3AF', fill: '#374151', textColor: '#F3F4F6', fillStyle: 'solid', strokeWidth: 2, roughness: 1 },
  },
};

// 连线颜色：深灰/黑色，手绘粗线条
export const CONNECTOR_COLORS: Record<ObsidianTheme, { stroke: string; strokeWidth: number }> = {
  light: { stroke: '#374151', strokeWidth: 2 },
  dark: { stroke: '#D1D5DB', strokeWidth: 2 },
};

// 背景色：温暖米色（浅色）/ 深蓝黑（深色）
export const BACKGROUNDS: Record<ObsidianTheme, string> = {
  light: '#FDF6E3',  // 温暖米色，模仿纸张质感
  dark: '#1E293B',
};

// 文字色
export const TEXT_COLORS: Record<ObsidianTheme, string> = {
  light: '#1F2937',
  dark: '#F9FAFB',
};
