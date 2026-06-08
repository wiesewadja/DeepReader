/**
 * 高亮颜色共享类型 — 用于阅读模式高亮和摘录服务
 */

export const HIGHLIGHT_COLORS = [
	{ id: 'yellow', label: '黄色', color: '#ffeb3b', bg: 'rgba(255, 235, 59, 0.4)' },
	{ id: 'green', label: '绿色', color: '#4caf50', bg: 'rgba(76, 175, 80, 0.4)' },
	{ id: 'blue', label: '蓝色', color: '#2196f3', bg: 'rgba(33, 150, 243, 0.4)' },
	{ id: 'pink', label: '粉色', color: '#e91e63', bg: 'rgba(233, 30, 99, 0.4)' },
	{ id: 'orange', label: '橙色', color: '#ff9800', bg: 'rgba(255, 152, 0, 0.4)' },
] as const;

export type HighlightColorId = typeof HIGHLIGHT_COLORS[number]['id'];
