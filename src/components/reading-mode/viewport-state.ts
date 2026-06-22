import { App } from 'obsidian';

/**
 * 判断当前 Obsidian 视口是否“完全展开”且无分屏。
 * 判定条件：
 * 1. rootSplit 只有 1 个子节点（即工作区未分屏）
 * 2. 左侧栏已收起
 * 3. 右侧栏已收起
 */
export function isViewportFullyExpanded(app: App): boolean {
	const workspace = app.workspace;
	if (!workspace) return false;

	const rootSplit = (workspace as any).rootSplit;
	const leftSplit = (workspace as any).leftSplit;
	const rightSplit = (workspace as any).rightSplit;

	if (!rootSplit || !leftSplit || !rightSplit) return false;

	// rootSplit.children 存在且长度为 1，且左右边栏的 collapsed 属性均为 true
	return (
		Array.isArray(rootSplit.children) &&
		rootSplit.children.length === 1 &&
		leftSplit.collapsed === true &&
		rightSplit.collapsed === true
	);
}

/**
 * 双页布局度量：基于 scrollView 的 computed style 计算列/屏步长。
 *
 * 集中此计算，避免翻页、计数、页码推导、resize、跳转等多处重复 getComputedStyle。
 * - colStep:    一列（单逻辑页）的步长 = 列宽 + 列间距
 * - spreadStep: 一屏（双页 spread）的滚动步长 = 2 × 列步长
 *
 * 注意：依赖 .deeppdf-dual-page 的 CSS（column-gap / padding），
 * 调整这些值时无需改动任何调用方。
 */
export interface DualPageMetrics {
	/** 左内边距（CSS padding-left） */
	paddingLeft: number;
	/** 右内边距（CSS padding-right） */
	paddingRight: number;
	/** 列间距（CSS column-gap） */
	columnGap: number;
	/** 列步长（单逻辑页）= 列宽 + 列间距 */
	colStep: number;
	/** 屏步长（spread，双页）= 2 × 列步长 */
	spreadStep: number;
}

export function getDualPageMetrics(scrollView: HTMLElement): DualPageMetrics {
	const style = window.getComputedStyle(scrollView);
	const paddingLeft = parseFloat(style.paddingLeft) || 0;
	const paddingRight = parseFloat(style.paddingRight) || 0;
	const columnGap = parseFloat(style.columnGap) || 0;

	// 内容区宽度（clientWidth 已含 padding，需扣除）
	const contentWidth = scrollView.clientWidth - paddingLeft - paddingRight;
	// 双列 + 单间距：contentWidth = 2 × colWidth + columnGap
	const colWidth = (contentWidth - columnGap) / 2;
	const colStep = colWidth + columnGap;

	return {
		paddingLeft,
		paddingRight,
		columnGap,
		colStep,
		spreadStep: colStep * 2,
	};
}
